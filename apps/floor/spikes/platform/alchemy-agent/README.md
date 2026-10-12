# Native Alchemy agent and storage probe

This local spike consumes the private Yielded build derived from commit
`0adbcff4c7d4b1a32a3edb1fe1bc92e245a01968`, Alchemy
`2.0.0-beta.80`, and Effect `4.0.3`. Its four-line Crypto API compatibility
patch, exact upstream Alchemy patch, package archives, build lock and hashes
are retained under `vendor/yielded/0adbcff-effect-4.0.3`. It is not a production package.

From the repository root:

```sh
bun install --frozen-lockfile
bun run spike:prepare
bun run typecheck
bun run lint
bun run build
bun run test
bun run format:check
```

`spike:prepare` verifies the six private archive hashes and compiled exports,
installs this package's frozen graph, and prepares the separate Kit package.
It does not deploy cloud resources. The root checks cover this fixture and the
Kit package; the root test runs this fixture's admission and restart processes.
The root build bundles and boots both Alchemy fixtures locally, checks readiness,
then destroys their local resources.

The current runner imports the private archives directly; it does not clone an
upstream checkout or install source-path aliases. Runtime exports resolve
compiled JavaScript and consumer checks resolve compiled declarations. Every
Floor compiler and lint rule still applies to authored code. Effect 4.0.3's
FileSystem and Path module families are explicitly reviewed for the test driver's
artifact writes. Historical Effect 4.0.0 results retain their exact original
source archives; they are not relabelled as 4.0.3 results.

The harness is Alchemy's `Test.make({ dev: true, sidecar: false })` with local
state and CI's local account fallback. A preload rejects non-loopback calls
through the host process's native fetch transport, and telemetry is disabled.
The fixture uses a synthetic model, no tools, and no outgoing Worker requests.
This guard is not operating-system network containment.

The Worker binds to `127.0.0.1:19732`. Its declared compatibility date is
`2026-08-18` and its declared flags are empty; Alchemy's default Node
compatibility remains in effect. These results do not establish a bare runtime.

The test proves the following locally:

- A native Alchemy callback submits work to a native Yielded ThreadObject. Its
  alarm produces the fixed model result and a completed settlement during a
  measured three-second interval without polling.
- Six canonical records and the callback row survive a separate process
  restart. Re-delivering the same submission key adds no records after another
  measured request-free interval.
- Native Durable Object SQL migrations and Alchemy D1 migrations each create
  the two-file schema. D1 queries use Alchemy's `SQL.D1` Effect SQL client.
- An intentional Durable Object transaction failure and a D1 duplicate-key
  batch failure both preserve the original row. Sixteen concurrent conditional
  updates produce exactly one winner in each store.
- Rows and migration hashes survive the separate process restart. Reapplying
  captured Durable Object migrations leaves its two history entries unchanged.

The first process retains local resource identity and closes its runtime
scope; the second process reads that state, checks duplicate delivery, and
destroys local resources. Alchemy's D1 provider can leave simulator files in
the ignored `.alchemy` directory after the resource state is removed.

The committed evidence contains exact as-run source archives, dependency
digests, results, logs, limitations, and review:

- [Agent callback and restart](../../../../../docs/spikes/evidence/platform/alchemy-native-agent/001/findings.md)
- [Durable Object and D1 storage](../../../../../docs/spikes/evidence/platform/alchemy-native-storage/001/findings.md)
- [Exact Alchemy patch compatibility](../../../../../docs/spikes/evidence/platform/alchemy-patch-compatibility/001/findings.md)

The original machine's cached `workerd` executable was corrupt. It was replaced
only inside the affected local installation with the same official
`@cloudflare/workerd-darwin-arm64@1.20260918.1` artifact after checking its
registry SHA-512 integrity. This is recorded as an environment repair, not an
Alchemy source change. The runner does not silently repair a corrupt cache.

The isolated harness has 11 explained directive sites covering 13 individual
rule exemptions: native fetch
interception/delegation; Alchemy-owned setup/teardown hooks; two measured
request-free waits; and the native Worker dependency boundary. There are no
new global rule disablements, type assertions, or `any` types in this fixture.

Hosted deployment, remote state, real model/provider calls, sidecar mode,
mid-flight termination, migration upgrades of pre-existing schemas, failed
migration recovery, and distributed contention remain untested. Local
synthetic success is not Stage 0 acceptance.
