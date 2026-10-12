# Local platform probes

These bounded examples support the platform spike. They are not product applications or Stage 0. The [result report](../../../../docs/spikes/evidence/platform/report.md) distinguishes local results from deferred hosted checks. No route signs or broadcasts a transaction, calls an inference provider, or starts a hosted browser.

From the repository root:

```sh
bun install --frozen-lockfile
bun run format:check
bun run typecheck
bun run lint
bun run build
bun run build:bare
bun run dev
```

Both builds use Wrangler `deploy --dry-run`; they create local bundles only. Both development commands explicitly use local bindings. `dev:bare` isolates SQL and Web Crypto without Node compatibility. `dev` additionally includes the launch SDKs and native Yielded agent, with `nodejs_compat`. The compatibility date matches the installed workerd release, 2026-10-06. The D1 identifier is a dummy local identifier, not a hosted database.

Use `bun run dev --persist-to work/spikes/platform/<new-attempt>-state` for a fresh experiment, or `dev:bare` with the same override. Keep the same state directory across a stop/restart check. Use a new state directory and new evidence attempt for another run; initialization and reservation deliberately mutate the fixture.

| Route | Bounded behavior |
| --- | --- |
| `/crypto` | Web Crypto SHA-256 vectors, UUIDv4 sample invariants, negative random-byte size failure |
| `/journal/rollback`, `/journal/nested` | Intentional outer and nested SQLite rollback through the Effect adapter |
| `/journal/reserve`, `/journal/read` | Atomic conditional update and readback; race twenty requests against a fresh fixture |
| `/journal/dispose` | Explicitly release the local managed runtime; do not reuse that instance afterward |
| `/d1/initialize`, `/d1/batch`, `/d1/read`, `/d1/migrate` | Initialization, failing atomic batch, explicit unsupported interactive transaction, readback and versioned schema upgrade |
| `/alarm/schedule`, `/alarm/read` | Separate native alarm prerequisite; reading does not schedule work |
| `/launch` | Two deterministic Meteora and Doppler constructions each, with synthetic data and rejecting network transports |
| `POST /agent/submit?thread=<new-id>&key=<new-key>` | Accept a synthetic Yielded agent turn inside a native Durable Object |
| `/agent/snapshot?thread=<id>`, `/agent/read?thread=<id>` | Read persisted alarm timestamps and canonical records |

The synthetic model waits 1.5 seconds before yielding fixed text. The probe sets `dispatchAfterEvent: false` so a native alarm must advance the accepted work. Wait at least five seconds without requests, then compare the persisted alarm/settlement timestamps to the first subsequent request. This proves local scheduler integration; it is not an inference-provider or hosted durability test. Restart and interrupted-turn procedures are retained in their evidence records.

`Journal` and `History` expose different semantics intentionally: the DO driver supports transactions and nested rollback; D1 supports atomic batches and explicitly rejects interactive transactions. The D1 schema migration is a single-runner probe, not a production migration coordinator. The launch fixture supplies only the quote-mint account information needed for construction; it establishes no chain checkpoint or launch correctness.

The strict native compiler options, 91 Effect diagnostics and Effect lint presets remain enabled. Runtime types live at this app boundary. The obsolete custom Floor fence plugin is not activated; Stage 0 must adapt and test those fences. The spike has **11 single-line suppressions**: eight standalone request/entrypoint Layer provisions and three native SDK/Worker Promise boundaries, each with a reason beside it. No broad file or rule suppression, application unstable-API allowlist, `any`, type cast or non-null assertion is introduced.

Secrets, generated bundles, raw results and local SQLite files belong in ignored scratch, never in this directory or evidence. The immutable `reference/` snapshot is excluded from all checks and bundles.
