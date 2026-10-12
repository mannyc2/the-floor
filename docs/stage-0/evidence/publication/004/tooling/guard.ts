import { resolve } from 'node:path';
import { assert, auditClosure, destinations, git, lines } from './audit.ts';

interface Policy {
  readonly approvedRefs: Readonly<Record<string, string>>;
  readonly forbiddenBlobs: ReadonlySet<string>;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function policy(value: unknown): Policy {
  assert(record(value) && record(value.approvedRefs) && Array.isArray(value.forbiddenBlobs), 'Invalid publication policy');
  const approvedRefs: Record<string, string> = {};
  for (const [ref, oid] of Object.entries(value.approvedRefs)) {
    assert(ref.startsWith('refs/heads/') && typeof oid === 'string' && /^[0-9a-f]{40}$/.test(oid), 'Invalid approved ref');
    approvedRefs[ref] = oid;
  }
  const forbiddenBlobs = new Set<string>();
  for (const oid of value.forbiddenBlobs) {
    assert(typeof oid === 'string' && /^[0-9a-f]{40}$/.test(oid), 'Invalid forbidden blob');
    forbiddenBlobs.add(oid);
  }
  assert(forbiddenBlobs.size > 0, 'Missing reference-blob exclusion inventory');
  return { approvedRefs, forbiddenBlobs };
}

try {
  const cwd = process.cwd();
  const destination = process.argv[3];
  assert(destinations.some((allowed) => allowed === destination), 'Publication destination is not allowlisted');
  const gitDir = git(cwd, 'rev-parse', '--absolute-git-dir').trim();
  const parsed: unknown = JSON.parse(await Bun.file(resolve(gitDir, 'floor-publication-policy.json')).text());
  const approved = policy(parsed);
  const updates = lines(await Bun.stdin.text());
  assert(updates.length > 0, 'No explicit branch updates supplied');
  const tips: string[] = [];
  for (const update of updates) {
    const parts = update.split(' ');
    assert(parts.length === 4, 'Malformed pre-push update');
    const [, localOid, remoteRef] = parts;
    assert(localOid !== undefined && remoteRef !== undefined && /^[0-9a-f]{40}$/.test(localOid), 'Invalid outgoing object');
    assert(localOid !== '0'.repeat(40), 'Branch deletions are outside the publication approval');
    assert(approved.approvedRefs[remoteRef] === localOid, `Unreviewed publication update for ${remoteRef}`);
    assert(git(cwd, 'cat-file', '-t', localOid).trim() === 'commit', 'Outgoing object is not a commit');
    tips.push(localOid);
  }
  // Outbound history and every local ref are checked together so fetching an
  // original branch cannot silently contaminate the publication checkout.
  const result = auditClosure(cwd, ['--all', ...tips], approved.forbiddenBlobs);
  console.error(`Publication guard passed: ${updates.length} reviewed refs; ${result.commits} clean commits.`);
} catch (error) {
  console.error(`Publication blocked: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
