# Local platform probes

These are bounded experiments for the [platform spike](../../../../docs/spikes/platform.md). These commands execute local checks. The owner later authorized Stage 0 and bounded hosted checks; hosted execution has separate prerequisites and evidence. See the [result report](../../../../docs/spikes/evidence/platform/report.md) for measured results, retained failures and outstanding gates.

- [Alchemy agent and storage](alchemy-agent/README.md): the native Yielded adapter from PR 557, privately packaged for Effect 4.0.3 with a recorded four-call Crypto patch. Runtime and types resolve compiled archives. Durable callback admission, restart/idempotency, and Alchemy DO/D1 migrations and transactions run in the strict consumer package.
- [Launch construction and crypto](kit/README.md): Kit 8 with two generated Meteora instructions, native bigint arithmetic, Doppler `/evm` calldata, Effect HTTP and browser Web Crypto. This is an isolated package with its own pinned lockfile and synthetic inputs.

At the repository root, run `bun install --frozen-lockfile`, `bun run spike:prepare`, `bun run format:check`, `bun run typecheck`, `bun run lint`, `bun run build` and `bun run test`. The build gate uses Alchemy's supported local harness to bundle and check the real Worker, then destroy local resources. It is not a hosted deployment. The restart test intentionally retains local resource identity between two processes and destroys it afterward. Read each fixture's README before replaying; use a new evidence attempt for new results.

Alchemy's local test state is a scoped testing choice. Production/deployed state, the Alchemy profile, browser containment, Privy, live inference, plates and verified hosted teardown remain outstanding. There is no active Wrangler configuration and no production architecture or CI claim.

The earlier raw-runtime experiments are recoverable at commit `181bd364ecd64b3e73e64a508d035eac958d668a`, including their README, driver and dependencies. Their immutable evidence remains labelled historical; the current scripts do not run them.
