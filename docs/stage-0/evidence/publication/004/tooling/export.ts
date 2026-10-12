import { chmod, copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { assert, auditClosure, canonicalBranches, command, commits, destinations, excluded, excludedPrefix, git, hash, lines, refs, selectSourceRefs, tree, validateTrackingRefs } from './audit.ts';

const source = '/Users/chriscarroll/Documents/Codex/2026-10-12/set/outputs/the-floor';
const publicationRoot = '/Users/chriscarroll/Documents/Codex/2026-10-12/set/work/publication';
const [expectedStage, runName] = process.argv.slice(2);
assert(expectedStage !== undefined && /^[0-9a-f]{40}$/.test(expectedStage), 'Supply the exact reviewed source stage-0 commit');
assert(runName !== undefined && /^[a-z0-9][a-z0-9-]*$/.test(runName), 'Supply a new lowercase run directory name');
const run = resolve(publicationRoot, runName);
const mirror = resolve(run, 'filtered.git');
const checkout = resolve(run, 'publish');

try {
  await stat(run);
  throw new Error(`Run directory already exists: ${run}`);
} catch (error) {
  assert(error instanceof Error && 'code' in error && error.code === 'ENOENT', 'Run directory must not already exist');
}

const beforeRefs = refs(source);
assert(beforeRefs['refs/heads/stage-0'] === expectedStage, 'stage-0 moved before export; obtain the final commit again');
const { heads: sourceHeads, excludedTrackingRefs } = selectSourceRefs(beforeRefs);
const publicationUrl = destinations[0];
const publishedHeads: Record<string, string> = {};
if (Object.keys(excludedTrackingRefs).length > 0) {
  const origin = git(source, 'remote', 'get-url', 'origin').trim();
  assert(destinations.some((destination) => destination === origin), 'Source origin is not the reviewed publication destination');
  for (const line of lines(git(publicationRoot, 'ls-remote', '--heads', publicationUrl, ...canonicalBranches.map((branch) => `refs/heads/${branch}`)))) {
    const [oid, name] = line.split(/\s+/);
    assert(name !== undefined && oid !== undefined && /^[0-9a-f]{40}$/.test(oid), 'Malformed published branch observation');
    assert(Object.hasOwn(sourceHeads, name) && !Object.hasOwn(publishedHeads, name), 'Unexpected or duplicate published branch observation');
    publishedHeads[name] = oid;
  }
  validateTrackingRefs(excludedTrackingRefs, publishedHeads);
}
const trackingRefValidation = {
  destination: publicationUrl,
  observedAt: new Date().toISOString(),
  performed: Object.keys(excludedTrackingRefs).length > 0,
  publishedHeads,
};
const beforeWorktrees = git(source, 'worktree', 'list', '--porcelain');
// Published tracking history has already been filtered. Mixing it with original
// ancestry would change the rewrite domain and invalidate the prior commit map.
const sourceCommits = commits(source, Object.values(sourceHeads));
const beforeConfig = await readFile(resolve(source, '.git/config'));
const forbiddenBlobs = new Set<string>();
for (const commit of sourceCommits) {
  for (const entry of tree(source, commit)) {
    if (excluded(entry.path) && entry.type === 'blob') forbiddenBlobs.add(entry.oid);
  }
}
assert(forbiddenBlobs.size > 0, 'No excluded source snapshot found');

await mkdir(run);
const tooling = resolve(run, 'tooling');
await mkdir(tooling);
const toolHashes: Record<string, string> = {};
for (const name of ['audit.ts', 'guard.ts', 'export.ts']) {
  const bytes = await readFile(resolve(publicationRoot, name));
  await writeFile(resolve(tooling, name), bytes);
  toolHashes[name] = hash(bytes);
}
await writeFile(resolve(run, 'source-refs.json'), `${JSON.stringify(beforeRefs, null, 2)}\n`);
await writeFile(resolve(run, 'excluded-origin-tracking-refs.json'), `${JSON.stringify({ excludedTrackingRefs, validation: trackingRefValidation }, null, 2)}\n`);
await writeFile(resolve(run, 'source-worktrees.txt'), beforeWorktrees);
await writeFile(resolve(run, 'forbidden-blobs.txt'), `${[...forbiddenBlobs].sort().join('\n')}\n`);
const cloneLog = command(publicationRoot, ['git', 'clone', '--mirror', '--no-local', '--no-hardlinks', source, mirror]);
await writeFile(resolve(run, 'clone.log'), cloneLog);
assert(JSON.stringify(refs(mirror)) === JSON.stringify(beforeRefs), 'Source refs changed during clone; discard this run');
// Only this isolated clone drops the already validated tracking refs. Every
// original ref remains covered by the final source-integrity comparison.
for (const [ref, oid] of Object.entries(excludedTrackingRefs)) git(mirror, 'update-ref', '-d', ref, oid);
assert(JSON.stringify(refs(mirror)) === JSON.stringify(sourceHeads), 'Isolated mirror contains noncanonical refs');

// A full rewrite avoids mixed original/filtered ancestry. Empty commits and
// message bytes stay intact so the omitted snapshot is the only content loss.
const filterArgs = ['filter-repo', '--invert-paths', '--path', `${excludedPrefix}/`,
  '--prune-empty', 'never', '--prune-degenerate', 'never', '--preserve-commit-hashes',
  '--preserve-commit-encoding', '--replace-refs', 'delete-no-add'];
await writeFile(resolve(run, 'filter.log'), git(mirror, ...filterArgs));
assert(git(mirror, 'remote').trim() === '', 'Filtered mirror still has a source remote');
await copyFile(resolve(mirror, 'filter-repo/commit-map'), resolve(run, 'commit-map.txt'));
const commitMap = new Map(lines(await Bun.file(resolve(run, 'commit-map.txt')).text()).slice(1).map((line) => {
  const [oldOid, newOid] = line.split(/\s+/);
  assert(oldOid !== undefined && newOid !== undefined && /^[0-9a-f]{40}$/.test(newOid), 'Invalid filter commit map');
  return [oldOid, newOid];
}));
assert(commitMap.size === sourceCommits.length, 'Commit mapping does not cover the complete original history');
let comparedEntries = 0;
for (const oldOid of sourceCommits) {
  const newOid = commitMap.get(oldOid);
  assert(newOid !== undefined && newOid !== '0'.repeat(40), `Original commit was pruned: ${oldOid}`);
  const expected = tree(source, oldOid).filter((entry) => !excluded(entry.path));
  const actual = tree(mirror, newOid);
  assert(JSON.stringify(expected) === JSON.stringify(actual), `Unexpected tree change for ${oldOid}`);
  const oldCommit = git(source, 'cat-file', 'commit', oldOid);
  const newCommit = git(mirror, 'cat-file', 'commit', newOid);
  const metadata = (value: string) => {
    const boundary = value.indexOf('\n\n');
    assert(boundary > 0, 'Commit header is incomplete');
    return value.slice(0, boundary).split('\n').filter((line) => !line.startsWith('tree ') && !line.startsWith('parent ')).join('\n') + value.slice(boundary);
  };
  assert(metadata(oldCommit) === metadata(newCommit), `Commit author/message metadata changed for ${oldOid}`);
  const parents = (value: string) => value.split('\n\n')[0]?.split('\n').filter((line) => line.startsWith('parent ')).map((line) => line.slice(7)) ?? [];
  assert(JSON.stringify(parents(oldCommit).map((parent) => commitMap.get(parent))) === JSON.stringify(parents(newCommit)), `Parent topology changed for ${oldOid}`);
  comparedEntries += expected.length;
}
const filteredRefs = refs(mirror);
for (const [ref, oldOid] of Object.entries(sourceHeads)) {
  assert(filteredRefs[ref] === commitMap.get(oldOid), `Filtered branch points at an unexpected commit: ${ref}`);
}
assert(Object.keys(filteredRefs).length === Object.keys(sourceHeads).length, 'Filtered ref count changed');
const closure = auditClosure(mirror, ['--all'], forbiddenBlobs);
assert(closure.commits === sourceCommits.length, 'Reachable history lost commits');
const lookB = beforeRefs['refs/heads/spike/look-b'];
assert(lookB !== undefined, 'Missing Look B history');
const originals = tree(source, lookB).filter((entry) => /^docs\/spikes\/evidence\/look\/references\/[^/]+\/001\/candidate-\d{2}\.png$/.test(entry.path));
assert(originals.length === 84, `Expected all 84 Look B originals; found ${originals.length}`);
await writeFile(resolve(run, 'look-b-originals.json'), `${JSON.stringify(originals, null, 2)}\n`);

git(publicationRoot, 'clone', '--no-local', '--no-hardlinks', '--branch', 'stage-0', mirror, checkout);
for (const [ref, oid] of Object.entries(filteredRefs)) {
  if (ref !== 'refs/heads/stage-0') git(checkout, 'update-ref', ref, oid);
}
git(checkout, 'remote', 'remove', 'origin');
// Hooks are deliberately installed in both independent repositories; git clone
// does not transfer hooks from the source repository.
const guardScript = resolve(tooling, 'guard.ts');
const hook = `#!/bin/sh\nexec '${process.execPath.replaceAll("'", "'\\''")}' '${guardScript.replaceAll("'", "'\\''")}' "$@"\n`;
for (const directory of [mirror, resolve(checkout, '.git')]) {
  await mkdir(resolve(directory, 'hooks'), { recursive: true });
  await writeFile(resolve(directory, 'hooks/pre-push'), hook);
  await chmod(resolve(directory, 'hooks/pre-push'), 0o755);
  await writeFile(resolve(directory, 'floor-publication-policy.json'), `${JSON.stringify({ approvedRefs: {}, forbiddenBlobs: [...forbiddenBlobs].sort() }, null, 2)}\n`);
}
assert(JSON.stringify(refs(source)) === JSON.stringify(beforeRefs), 'Original refs changed while exporting; review concurrent edits before publishing');
assert(git(source, 'worktree', 'list', '--porcelain') === beforeWorktrees, 'Original worktree heads changed while exporting');
assert(hash(await readFile(resolve(source, '.git/config'))) === hash(beforeConfig), 'Original repository configuration changed while exporting');
const filteredStage = commitMap.get(expectedStage);
const result = {
  status: 'verified-unpublished',
  sourceStage: expectedStage,
  filteredStage,
  generatedAt: new Date().toISOString(),
  toolHashes,
  omission: excludedPrefix,
  filterVersion: git(publicationRoot, 'filter-repo', '--version').trim(),
  filterArgs,
  sourceRefs: beforeRefs,
  sourceHeads,
  excludedTrackingRefs,
  trackingRefValidation,
  filteredRefs,
  originalCommits: sourceCommits.length,
  mappedCommits: commitMap.size,
  comparedEntries,
  closure,
  forbiddenBlobCount: forbiddenBlobs.size,
  lookBOriginalCount: originals.length,
  originalRefsWorktreesAndConfigUnchanged: true,
  guard: 'Installed in mirror and checkout; all pushes blocked until exact target refs are reviewed and listed in their local policy.',
  files: { mirror, checkout, commitMap: resolve(run, 'commit-map.txt') },
};
await writeFile(resolve(run, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
