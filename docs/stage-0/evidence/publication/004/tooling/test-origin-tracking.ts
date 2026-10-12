import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { assert, canonicalBranches, selectSourceRefs, validateTrackingRefs } from './audit.ts';

const originalOid = '1'.repeat(40);
const publicOid = '2'.repeat(40);
const heads = Object.fromEntries(canonicalBranches.map((branch) => [`refs/heads/${branch}`, originalOid]));
const tracking = Object.fromEntries(canonicalBranches.map((branch) => [`refs/remotes/origin/${branch}`, publicOid]));
const published = Object.fromEntries(canonicalBranches.map((branch) => [`refs/heads/${branch}`, publicOid]));
const cases: { name: string; passed: boolean; diagnostic: string }[] = [];

function check(name: string, shouldPass: boolean, source: Record<string, string>, remote = published) {
  let accepted = false;
  let diagnostic = '';
  try {
    const selected = selectSourceRefs(source);
    validateTrackingRefs(selected.excludedTrackingRefs, remote);
    assert(JSON.stringify(selected.heads) === JSON.stringify(heads), 'Canonical heads changed');
    accepted = true;
  } catch (error) {
    diagnostic = error instanceof Error ? error.message : 'Non-Error rejection';
  }
  cases.push({ name, passed: accepted === shouldPass, diagnostic });
  assert(accepted === shouldPass, `Unexpected result: ${name}`);
}

check('original canonical heads without tracking refs', true, heads);
check('all five matching publication tracking refs', true, { ...heads, ...tracking });
check('a subset of matching permitted tracking refs', true, { ...heads, 'refs/remotes/origin/main': publicOid });
for (const name of [
  'refs/heads/unreviewed',
  'refs/remotes/origin/unreviewed',
  'refs/remotes/origin/HEAD',
  'refs/remotes/other/main',
  'refs/tags/v1',
  'refs/notes/commits',
  'refs/replace/1111111111111111111111111111111111111111',
  'refs/stash',
]) check(`reject ${name}`, false, { ...heads, [name]: publicOid });
check('stale tracking target rejected', false, { ...heads, ...tracking, 'refs/remotes/origin/main': originalOid });
const { 'refs/heads/main': _missingPublic, ...missingPublic } = published;
check('missing tracked public branch rejected', false, { ...heads, ...tracking }, missingPublic);
const { 'refs/heads/main': _missingHead, ...missingHead } = heads;
check('missing canonical source head rejected', false, missingHead);
check('invalid target identifier rejected', false, { ...heads, 'refs/remotes/origin/main': 'not-an-object-id' });

await writeFile(resolve(import.meta.dir, 'origin-tracking-test-results.json'), `${JSON.stringify({
  testedAt: new Date().toISOString(),
  scope: 'Pure ref selection and validation; no network, repositories or original refs changed.',
  cases,
}, null, 2)}\n`);
console.log(`${cases.length} origin-tracking policy scenarios passed.`);
