# Pinned Yielded build for Effect 4.0.3

These six private package archives derive from Yielded PR 557 commit
`0adbcff4c7d4b1a32a3edb1fe1bc92e245a01968`. They retain the upstream MIT
license and source. The private version is `0.1.0-beta.166-floor.0adbcff.403.2`.
They have not been published to a registry.

The owner accepted Effect 4.0.3 for every active runtime. Four upstream calls
treated `Crypto.randomUUIDv4/v7` as Effect values; 4.0.3 exposes methods.
`effect-4.0.3-crypto.patch` adds the required invocation at those four sites.
The initial unpatched build passed bundling but failed during a real Durable
Object alarm. The corrected build passes the local agent, alarm, storage and
separate-process restart checks. This is a patched derivative of the recorded
commit, not its unchanged implementation.

`provenance.json` records archive hashes, original and adapted manifest hashes,
each source-file hash, the four changed files' before/after hashes, and the
standalone patch hash. Runtime exports use compiled `.mjs`; TypeScript uses
compiled `.d.mts`. The conversion follows the upstream
`scripts/release-publish.ts` implementation. No runtime export points to source
TypeScript. Exact private interdependencies, Effect 4.0.3, and Alchemy beta.80
are pinned in the packaged manifests.

Consumers must declare all six `file:` archives in both `dependencies` and
`overrides`. Bun otherwise queries the public registry for unpublished
transitive versions. The root `package.json` is the active example.
The Alchemy `patchedDependencies` entry references the repository's
`patches/alchemy@2.0.0-beta.80.patch`, byte-identical to the upstream PR's patch.
The legacy Cloudflare package still declares `effect-cf` as a peer; active
Floor code imports the native Alchemy adapter. Installation alone does not prove
which modules enter a Worker bundle.

## Rebuild

From the repository root, choose a fresh ignored checkout and run:

```sh
git clone https://github.com/yielded-dev/agent.git work/yielded-rebuild
git -C work/yielded-rebuild checkout --detach 0adbcff4c7d4b1a32a3edb1fe1bc92e245a01968
cp vendor/yielded/0adbcff-effect-4.0.3/build.package.json work/yielded-rebuild/package.json
cp vendor/yielded/0adbcff-effect-4.0.3/build.bun.lock work/yielded-rebuild/bun.lock
git -C work/yielded-rebuild apply ../../vendor/yielded/0adbcff-effect-4.0.3/effect-4.0.3-crypto.patch
cd work/yielded-rebuild
bun install --frozen-lockfile --ignore-scripts --filter @yielded/agent-platform-alchemy-cloudflare --filter @yielded/agent-testing
for package in effect-agent storage-sql storage-cloudflare platform-cloudflare platform-alchemy-cloudflare testing; do
  (cd "packages/$package" && bun run build)
done
cd ../..
bun vendor/yielded/0adbcff-effect-4.0.3/pack.archive.mjs work/yielded-rebuild
bun install --frozen-lockfile
bun run typecheck
bun run lint
bun run build
bun run test
```

The six publishable source trees also pass TypeScript under the upstream strict
settings. Four package-wide upstream checks pass. The upstream
`storage-cloudflare` and `testing` checks still include unrelated stale test
fixtures, missing root development dependencies, and SQLite adapter type errors;
this build does not claim those broader suites pass. Floor's own consumer checks
retain strict indexed access, exact optional properties, all 91 Effect diagnostic
errors, and its lint rules.

The archives are committed so the Floor consumes this exact build without
cloning or rebuilding an upstream workspace. `provenance.json` records the
hashes of what is used.

`pack.archive.mjs` is the packer that built the archives, kept for regeneration. It is not loaded by active builds or checks. `bun install --frozen-lockfile` verifies the archives against the sha512 integrity values in `bun.lock`.
