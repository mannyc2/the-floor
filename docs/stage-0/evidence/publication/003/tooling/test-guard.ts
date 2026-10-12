import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { assert, decoder, git } from './audit.ts';

const root = resolve(import.meta.dir, 'guard-fixture');
await mkdir(root);
git(root, 'init', '--template=');
git(root, 'config', 'user.name', 'Publication guard fixture');
git(root, 'config', 'user.email', 'fixture@example.invalid');
const inputCommand = (args: string[], input: string) => {
  const result = Bun.spawnSync(args, { cwd: root, stdin: Buffer.from(input), stdout: 'pipe', stderr: 'pipe' });
  assert(result.exitCode === 0, decoder.decode(result.stderr));
  return decoder.decode(result.stdout).trim();
};
const safeBlob = inputCommand(['git', 'hash-object', '-w', '--stdin'], 'A safe publication fixture.\n');
const forbiddenBlob = inputCommand(['git', 'hash-object', '-w', '--stdin'], 'Synthetic unlicensed fixture content.\n');
const baseTree = inputCommand(['git', 'mktree'], `100644 blob ${safeBlob}\tREADME.txt\n`);
const base = inputCommand(['git', 'commit-tree', baseTree], 'Safe root\n');
git(root, 'update-ref', 'refs/heads/main', base);
const aliasTree = inputCommand(['git', 'mktree'], `100644 blob ${forbiddenBlob}\trename.txt\n`);
const alias = inputCommand(['git', 'commit-tree', aliasTree], 'Forbidden blob under an alias\n');
const cafeTree = inputCommand(['git', 'mktree'], `100644 blob ${safeBlob}\tindex.txt\n`);
const referenceTree = inputCommand(['git', 'mktree'], `040000 tree ${cafeTree}\tcafe-reference\n`);
const excludedTree = inputCommand(['git', 'mktree'], `040000 tree ${referenceTree}\treference\n`);
const excluded = inputCommand(['git', 'commit-tree', excludedTree], 'Excluded pathname with otherwise safe bytes\n');
const cases: { name: string; passed: boolean; diagnostic: string }[] = [];

async function check(name: string, shouldPass: boolean, approvedRefs: Record<string, string>, oid = base, ref = 'refs/heads/main', destination = 'https://github.com/mannyc2/the-floor.git') {
  await writeFile(resolve(root, '.git/floor-publication-policy.json'), JSON.stringify({ approvedRefs, forbiddenBlobs: [forbiddenBlob] }));
  const result = Bun.spawnSync([process.execPath, resolve(import.meta.dir, 'guard.ts'), 'publish', destination], {
    cwd: root,
    stdin: Buffer.from(`refs/heads/main ${oid} ${ref} ${'0'.repeat(40)}\n`),
    stdout: 'pipe', stderr: 'pipe',
  });
  const passed = (result.exitCode === 0) === shouldPass;
  cases.push({ name, passed, diagnostic: decoder.decode(result.stderr).trim() });
  assert(passed, `Unexpected guard result: ${name}`);
}

await check('default policy rejects all pushes', false, {});
await check('exact reviewed clean branch passes', true, { 'refs/heads/main': base });
await check('different target branch rejected', false, { 'refs/heads/main': base }, base, 'refs/heads/unreviewed');
await check('different destination rejected', false, { 'refs/heads/main': base }, base, 'refs/heads/main', 'https://github.com/mannyc2/other.git');
await check('branch deletion rejected', false, { 'refs/heads/main': '0'.repeat(40) }, '0'.repeat(40));
await check('tag publication rejected', false, { 'refs/tags/v1': base }, base, 'refs/tags/v1');
await check('excluded path rejected', false, { 'refs/heads/main': excluded }, excluded);
await check('excluded blob alias rejected', false, { 'refs/heads/main': alias }, alias);
git(root, 'update-ref', 'refs/heads/contaminated', excluded);
await check('contamination in another local ref rejected', false, { 'refs/heads/main': base });
git(root, 'update-ref', '-d', 'refs/heads/contaminated');
await check('clean state restored passes', true, { 'refs/heads/main': base });
await writeFile(resolve(import.meta.dir, 'guard-test-results.json'), `${JSON.stringify({ testedAt: new Date().toISOString(), cases }, null, 2)}\n`);
console.log(`${cases.length} publication guard scenarios passed; no network or original-repository mutations.`);
