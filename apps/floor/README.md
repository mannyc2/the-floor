# Floor Worker

`@floor/app-floor/worker` exports `makeFloorWorker({ assets?, env?, devPort? })`. The root stack binds the web assets to this Worker. `POST /api/rpc` serves public health, `/mcp` exposes it as a read-only tool, and `/api/world` streams public world snapshots and deliveries through HTTP NDJSON RPC. The MCP transport uses stateless `McpProtocol.v2026_07_28`; streaming RPCs receive no tool. Production exposes no model, submission or mutation endpoint. Owner operations wait for the Privy device-token check. Health, world reads, MCP and static assets start without provider credentials.

The native Alchemy Worker binds `FLOOR_THREADS`, `FLOOR_MAILBOXES` and `FLOOR_WORLDS`. The original agent, definition digest, submission ledger, alarm execution and record storage use the pinned Yielded packages. A mailbox schedules admission through Alchemy's native callback, then the Yielded alarm completes a schema-checked question-and-answer turn without a polling request. Each world object atomically journals its events and snapshots in native SQL, preserving chain checkpoints and an independent resume sequence.

The bounded `FirstAgent` composition reads a Solana pool, submits a trade through the isolated signer, publishes its causal receipt and returns to idle. Its `FLOOR_TRADERS` runtime is composed by the local first-trade test Worker; the production Worker has no trade route. `bun run test:first-trade` owns the disposable fork, signer and native test, while `bun run dev:first-trade` serves that local composition. The local model is explicitly scripted and the signer uses a fork-only key. Neither establishes live inference, Privy enforcement or the Stage 0 design gate.

## Providers

The agent reads these explicit Worker environment bindings when its Durable Object activates:

| Binding | Meaning |
| --- | --- |
| `FLOOR_MODEL_NAME` | Exact owner-selected OpenAI model identifier |
| `OPENAI_API_KEY` | Required for OpenAI inference and the Decisions API |

Bind credentials as Alchemy `Redacted` environment values. There is no inferred model alias, provider fallback or production scripted mode. The Floor infers through OpenAI only; the `OpenAiClient`/`OpenAiLanguageModel` Layer comes from the installed 4.0.3 package, and another provider would be a separate `AgentModel` Layer. Request defaults bound output to 3000 tokens; the original question-and-answer agent's policy bounds a run to one turn and 20 seconds. The first-trade mandate permits three turns and two tool calls within 30 seconds. Provider access, spend and successful live inference remain unverified.

The dedicated Decisions adapter uses `POST https://api.openai.com/v1/decisions`, model `gpt-6-luna`, through Effect HttpClient and the provider-neutral `DecisionModel`. It implements named predicate probabilities only: 1–16 questions, at most two inline base64 PNG/JPEG/WebP images, bounded evidence and instruction sizes, exact answer-name matching, and refusal/error handling. It rejects other decision kinds and custom outcome criteria. Choice/rating support and live calibration are still open. It never substitutes Responses structured output for Decisions. Unreported token usage remains unknown.

Sources checked: [OpenAI Decisions documentation](https://developers.openai.com/api/docs/guides/decisions), installed Effect 4.0.3 `DecisionModel`, and the installed OpenAI provider source. The first build's Responses-based probability adapter was inspected but was not promoted as the Decisions implementation.

## Local checks

Run from the repository root after installing with Bun and building `apps/web/dist`:

```sh
bun node_modules/typescript/bin/tsc --noEmit -p apps/floor/tsconfig.json
bun node_modules/oxlint/bin/oxlint --deny-warnings --config .oxlintrc.json apps/floor/src apps/floor/test
CI=true ALCHEMY_TELEMETRY_DISABLED=1 bun test --preload ./apps/floor/test/local-only.ts ./apps/floor/test/decisions.test.ts
CI=true ALCHEMY_TELEMETRY_DISABLED=1 bun test --preload ./apps/floor/test/local-only.ts ./apps/floor/test/build.test.ts
sh apps/floor/test/run.sh
```

Scripted models and their injection live under `test/`, including the admission Worker and the first-trade composition. Admission and restart tests still execute the production `Agents`, mailbox and ThreadObject services. Their DO/D1 rollback, compare-and-swap and migration probes are test-only infrastructure fixtures. They do not claim a production D1 application repository exists.

The local transport preload denies all non-loopback requests. The Decisions tests replace Fetch at the Effect transport boundary, validate the wire request, and never contact OpenAI. The production build test uses the real Worker and assets, checks typed health, rejects undeclared API routes and verifies private source maps/manifest content is not served. Admission and restart run in separate processes on port 19732, retaining then destroying their local state. Reports are written under `work/stage-0-checks`.

For the production shell flow, run:

```sh
CI=true ALCHEMY_TELEMETRY_DISABLED=1 bun --preload ./apps/floor/test/local-only.ts ./apps/floor/test/serve-local.ts
```

This serves the actual Worker and `apps/web/dist` on port 19740 by default; `FLOOR_WORKER_PORT` selects another validated local port when a checkout already owns it. The process holds the Alchemy scope open and destroys its local resources on SIGTERM. The shared Playwright config uses the same override for readiness and its default shell target, alongside `FLOOR_RENDERER_PORT` for the workbench. No authentication or model service is stubbed for shell health.

The private Yielded build and its four Effect Crypto call adaptations retain their [package provenance](../../vendor/yielded/0adbcff-effect-4.0.3/provenance.json). The promoted application is checked against those compiled package exports, with no source clone, replay or TypeScript path aliases.

## Bounded hosted check

A bounded hosted check proved native alarm execution with the testing model, DO/D1 rollback and conditional updates, storage persistence after a forced storage-object reset, Web Crypto and stage cleanup. It predates the RPC and live-world additions and does not prove live model calls or hosted agent eviction. The current native suite also checks the secret gate and world stream locally; hosted verification remains open.
