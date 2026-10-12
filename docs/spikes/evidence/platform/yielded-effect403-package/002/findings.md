# Effect 4.0.3 packed consumer: local pass

Six private Yielded packages now export compiled JavaScript and declarations,
with the upstream source and MIT license retained. They derive from PR 557
commit `0adbcff4c7d4b1a32a3edb1fe1bc92e245a01968` and apply the separately
hashed four-line Crypto API patch. The private version is
`0.1.0-beta.166-floor.0adbcff.403.2`. Every active Effect runtime package in
the measured bundle resolves to 4.0.3. Alchemy remains beta.80 with the exact
upstream patch.

The real local Alchemy Worker passes 33 assertions across two separate Bun and
workerd processes: native callback admission, alarm completion without request
polling, completed records surviving restart, idempotent re-admission, native
DO/D1 migrations, transactional rollback, one winner among sixteen conditional
updates per store, and row/migration persistence. This does not add hosted
eviction, in-flight recovery, populated-schema upgrade or distributed
contention claims.

The root format, typecheck, lint and build checks pass. The native build boots
and destroys its local Worker; the separate Kit build also passes its 18
assertions. Root checks now consume the exact private archives directly without
source-path aliases or an upstream checkout. All 91 Effect diagnostic
severities remain errors. The existing artifact-writing test driver additionally
reviews the external FileSystem and Path module families.

The six published source trees pass TypeScript under upstream strict settings.
Four complete upstream package checks pass. Two broad upstream checks remain
failed: storage-cloudflare includes stale test fixtures with removed ledger
interfaces; testing includes missing root development dependencies and SQLite
adapter type errors outside this package set. Their failures are retained here;
this record does not report the full upstream repository green.

The current reachable bundle has 10 JavaScript files, 9 source maps and 431
mapped source entries. All mapped source files resolve; both authored runtime
fixtures match the frozen source manifest. No `effect-cf` package, mapped path,
external import or emitted marker appears in that graph. Literal imports are
parsed and traversed; computed imports are outside the audit. Node externals
remain, so this is not evidence for a bare runtime.

`vendor/yielded/0adbcff-effect-4.0.3/provenance.json` records archive identities,
all packaged source hashes, manifest conversion, both patches and original/
adapted hashes of the four changed source files. The typed `scripts/vendor/verify.ts` validates archive
hashes, compiled exports, package identity and included licenses. All six file
dependencies also need file overrides for Bun to resolve unpublished transitives.

The known corrupt cached workerd binary was replaced only in this new local
installation, after unlinking its shared-cache hardlink. Its verified SHA-256 is
`5e8b50b74431e8ff1341583f647fc9ecbca5486b5ca9c8b1ecdbcb10b10336a5`.
There were no hosted resources or paid-provider operations. Local stage
resources were destroyed after the checks; simulator files may remain on disk.

The active verifier uses Effect Schema at both JSON boundaries and is included in root strict checks. A copied-license corruption control fails with the expected typed hash-mismatch error; active vendor bytes are unchanged. Its single explained suppression covers two rules at the finite Bun command boundary. The as-run untyped packer and first verifier remain historical artifacts, outside active checks.
