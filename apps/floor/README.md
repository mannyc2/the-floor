# Floor Worker

`@floor/app-floor/worker` exports `makeFloorWorker({ assets?, env? })`. The root stack binds the web assets to this Worker. `GET /api/health` implements `@floor/api/http`; no model, submission or inspection endpoint is public in Stage 0. Health and static assets start without provider credentials.

The native Alchemy Worker binds `FLOOR_THREADS` and `FLOOR_MAILBOXES`. The agent, definition digest, submission ledger, alarm execution and record storage use the pinned Yielded packages. A mailbox schedules admission through Alchemy's native callback, then the Yielded alarm completes the agent without a polling request. The internal agent currently answers a supplied question with a schema-checked answer and has no tools. This is the Stage 0 runtime foundation, not the later trading agent or design gate.

## Providers

The agent reads these explicit Worker environment bindings when its Durable Object activates:

| Binding | Meaning |
| --- | --- |
| `FLOOR_MODEL_PROVIDER` | `anthropic` or `openai` |
| `FLOOR_MODEL_NAME` | Exact owner-selected provider model identifier |
| `ANTHROPIC_API_KEY` | Required for Anthropic |
| `OPENAI_API_KEY` | Required for OpenAI inference and the Decisions API |

Bind credentials as Alchemy `Redacted` environment values. There is no inferred model alias, provider fallback or production scripted mode. The actual `AnthropicClient`/`AnthropicLanguageModel` and `OpenAiClient`/`OpenAiLanguageModel` Layers come from the installed 4.0.3 packages. Request defaults bound output to 3000 tokens; the agent policy bounds a run to one turn and 20 seconds. Provider access, spend and successful live inference remain unverified.

The dedicated Decisions adapter uses `POST https://api.openai.com/v1/decisions`, model `gpt-6-luna`, through Effect HttpClient and the provider-neutral `DecisionModel`. It implements named predicate probabilities only: 1–16 questions, at most two inline base64 PNG/JPEG/WebP images, bounded evidence and instruction sizes, exact answer-name matching, and refusal/error handling. It rejects other decision kinds and custom outcome criteria. Choice/rating support and live calibration are still open. It never substitutes Responses structured output for Decisions. Unreported token usage remains unknown.

Sources checked: [OpenAI Decisions documentation](https://developers.openai.com/api/docs/guides/decisions), installed Effect 4.0.3 `DecisionModel`, and installed Anthropic/OpenAI provider source. The first build's Responses-based probability adapter was inspected but was not promoted as the Decisions implementation.

## Local checks

Run from the repository root after installing with Bun and building `apps/web/dist`:

```sh
bun node_modules/typescript/bin/tsc --noEmit -p apps/floor/tsconfig.json
bun node_modules/oxlint/bin/oxlint --deny-warnings --config .oxlintrc.json apps/floor/src apps/floor/test
CI=true ALCHEMY_TELEMETRY_DISABLED=1 bun test --preload ./apps/floor/test/local-only.ts ./apps/floor/test/decisions.test.ts
CI=true ALCHEMY_TELEMETRY_DISABLED=1 bun test --preload ./apps/floor/test/local-only.ts ./apps/floor/test/build.test.ts
sh apps/floor/test/run.sh
```

`@floor/app-floor/testing` is the only application export that includes `@yielded/agent-testing`. Its ScriptedModel replaces the production model at the native agent's injection boundary. Admission and restart tests still execute the production `Agents`, mailbox and ThreadObject services. Their DO/D1 rollback, compare-and-swap and migration probes are test-only infrastructure fixtures. They do not claim a production D1 application repository exists.

The local transport preload denies all non-loopback requests. The Decisions tests replace Fetch at the Effect transport boundary, validate the wire request, and never contact OpenAI. The production build test uses the real Worker and assets, checks typed health, rejects undeclared API routes and verifies private source maps/manifest content is not served. Admission and restart run in separate processes on port 19732, retaining then destroying their local state. Reports are written under `work/stage-0-checks`.

For the production shell flow, run:

```sh
CI=true ALCHEMY_TELEMETRY_DISABLED=1 bun --preload ./apps/floor/test/local-only.ts ./apps/floor/test/serve-local.ts
```

This serves the actual Worker and `apps/web/dist` on port 19740, holds the Alchemy scope open, and destroys its local resources on SIGTERM. No authentication or model service is stubbed for shell health.

The private Yielded build and its four Effect Crypto call adaptations retain their [package provenance](../../vendor/yielded/0adbcff-effect-4.0.3/provenance.json) and [earlier native runtime evidence](../../docs/spikes/evidence/platform/yielded-effect403-package/002/record.json). The promoted application is checked against those compiled package exports, with no source clone, replay or TypeScript path aliases.
