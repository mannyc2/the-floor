# The Floor: Effect 4 cookbook

Oct 12, 2026

These are Effect 4 patterns the first build got working, checked against the installed packages on 12 October 2026 (effect 4.0.0, `@effect/*` 4.0.x, `@yielded/agent` 0.1.0-beta.166, effect-browser 0.3.0-beta.14, Foldkit 0.168.0). The first build's logs show many of its failures came from guessing APIs that don't exist, so this belongs in the new repo's docs beside `AGENTS.md`. It doesn't replace reading `node_modules/effect/AGENTS.md` and the installed source: re-check every entry when a version changes.

Paths point into the first build, which stays available as a reference.

## Module layout

Effect 4.0.0 has no `effect/unstable/*` paths. The modules are `effect`, `effect/schema`, `effect/ai`, `effect/http`, `effect/http-api`, `effect/rpc`, `effect/sql`, `effect/workflow`, `effect/encoding`, `effect/process`, `effect/cli`, `effect/socket`, `effect/testing` and so on. "Unstable" is a `@stability unstable` doc tag on exports such as `HttpApi` and the AI module, and the `apiStabilityLeak` diagnostic, driven by `allowedUnstableApis` in `tsconfig.json`, stops the Floor's own exports from re-exposing them.

## Patterns

1. **Errors.**
   - Write `class E extends Schema.TaggedError<E>()("Tag", fields, { httpApiStatus })` (`packages/surfaces/src/index.ts:177`). There is no `TaggedErrorClass`.
   - An error that wraps a foreign failure carries `cause: Schema.Defect()`, as `node_modules/effect/AGENTS.md` shows. No file in the first build does this; the new one must.
2. **Services.**
   - Write `class X extends Context.Service<X, Shape>()("floor/X") { static layer = Layer.effect(X, make) }` (`packages/signing/src/execution.ts:12-30`). It is `Context.Service`, not `ServiceMap`.
   - Layers that depend on config use `Layer.unwrap` (`packages/agents/src/runtime.ts:450`).
3. **Functions.** Write `Effect.fn("name")(function* () { … }, Effect.timeout(…), Effect.mapError(…))`, with pipeables trailing the generator (`packages/signing/src/scoped-accounts/accounts.ts:108`).
4. **Schema.**
   - `Schema.Literals`, and `Schema.TemplateLiteral(…).check(Schema.isPattern(…))` (`packages/contract/src/index.ts:3-22`).
   - `Schema.Finite.check(Schema.isGreaterThanOrEqualTo(…))`, never `Schema.Number`.
   - `Schema.suspend` for recursive types (`:359`).
   - `mapFields(Struct.pick(…))` for projections (`:86-94`).
   - `Schema.DateTimeUtcFromString` and `Schema.OptionFromNullOr` at the boundary (`packages/signing/src/scoped-accounts/protocol.ts:29,57`).
   - `withDecodingDefaultKey` for defaults (`scripts/bundle-budget/model.ts:5`).
   - `Schema.toEquivalence` (`packages/renderer/src/incremental.ts:14`).
   - `Schema.fromJsonString(Schema.toCodecJson(X))` to carry an `Option` through JSON (`packages/renderer/src/plate.ts`).
5. **HTTP API.**
   - Endpoints are `HttpApiEndpoint.get(name, path, { query, success, error })`.
   - Groups are `HttpApiGroup.make(…).add(…).middleware(M)`, and the API is `HttpApi.make(…).add(…).prefix(…)` (`packages/surfaces/src/index.ts:190-221`).
   - Middleware is `HttpApiMiddleware.Service<S, { provides }>()` (`:185`).
   - Handlers are `HttpApiBuilder.group(Api, "g", Effect.fn(function* (h) { return h.handleAll({ … }) }))` with `HttpApiBuilder.layer` (`packages/server/src/application.ts:670-723`).
6. **RPC streams.**
   - On the server, `RpcGroup.make(Rpc.make("watch", { success, stream: true }))` runs with `RpcServer.layerHttp({ group, path, protocol: "websocket" })` and `RpcSerialization.layerNdjson` (`packages/server/src/application.ts:724-735`).
   - On the client, `RpcClient.layerProtocolSocket()` runs with `Socket.layerWebSocket(url)` and `Socket.layerWebSocketConstructorGlobal` (`packages/frontend/src/entry.ts:23-26`).
7. **SQL.**
   - Models are `Model.Class` with `Model.BooleanSqlite` and `Model.Field`; repositories are `SqlModel.makeRepository`; queries use `SqlSchema.findOneOption` and `SqlSchema.void` (`packages/server/src/store.ts:9-139`).
   - Migrations are `SqliteMigrator.layer({ loader: fromRecord(…) })` (`packages/server/src/sqlite-store.ts:96`).
   - For Workers, `@effect/sql-sqlite-do` (Durable Object storage) and `@effect/sql-d1` exist at 4.0.3 but are unverified; the platform spike checks them.
8. **Streams, caches and fibres.**
   - `PubSub.sliding({ capacity, replay: 1 })` with `Stream.fromPubSub` (`packages/server/src/atlas.ts:34`).
   - `Cache.makeWith(lookup, { timeToLive: (exit) => Exit.isSuccess(exit) ? "15 seconds" : "0 seconds" })` keeps only successes (`packages/markets/src/runtime.ts:97`).
   - `FiberMap.run(map, key, effect, { onlyIfMissing: true })` gives one run per key (`packages/server/src/agent-runner.ts:300`).
9. **AI.**
   - Tools are `Tool.make(name, { parameters, success, failure, failureMode: "return" })`, then `Toolkit.make(…)` and `toolkit.toLayer(…)`.
   - MCP is `McpServer.layerHttp({ path, protocols: [McpProtocol.v2026_07_28] })` (`packages/server/src/public-surfaces.ts:21-168`).
   - Decisions use `Decision.make({ decisions: { key: Decision.probability(…) } })` with `model.decide(…)` (`packages/gate/src/review.ts:53-121`).
   - Stub a model with `DecisionModel.make({ decide })` and `Data.taggedEnum<DecisionModel.ProviderAnswer>().Probability` (`packages/gate/test/review.test.ts:15`).
   - `@effect/ai-openai` 4.0.0 has no Decisions provider, so the first build's own adapter (`packages/server/src/design-review.ts`) is the working wiring. No Anthropic provider is installed yet; add one and verify it before relying on the Claude defaults.
10. **Yielded Agent.**
    - Write `Agent.make(id, { input, output, toolkit, instructions, policy: { maxTurns, maxToolCalls, maxDuration, tokenBudget, costBudgetMicrousd, onExhaustion } })` and run it with `AgentRuntime.run` (`packages/agents/src/runtime.ts:124-159, 310-336`).
    - `DurableAgentRuntime` and `WakeScheduler` are exported but were never used; read them before building the agent Durable Object.
11. **Browsers.** The agent's browser is a provider Layer with three implementations:
    - **Cloudflare (the default).** Use Yielded Agent's browser capabilities ([guide](https://yielded.dev/agent/guide/browser/)):
      - Reading uses `WebCapture.make(name, { description, urls, actions, maxResponseBytes })` with `Toolkit.make(capture.tool)`. `urls` is a deny-by-default host list; `actions` are `"markdown"`, `"content"` and `"links"`.
      - Navigation uses interactive sessions governed by `InteractiveBrowserPolicy` (`network`: `ExactHosts`, `PublicWeb` or `Unrestricted`; `maxActions`; `maxElapsedMillis`; `maxReturnedBytes`).
      - The Cloudflare adapters (`CloudflareBrowser.layer(capture, { browser })` for a Worker binding, `CloudflareBrowserRest.layer` for REST) aren't exported by the installed `@yielded/agent` 0.1.0-beta.166. Find their package and version in the platform spike.
      - The Cloudflare adapter can't enforce `PublicWeb`.
    - **Browserbase (the alternative).** `Browserbase.open({ session, maxPages, guard })` returns `{ browser, release }`. Use `client.liveView` for takeover, and provide `BrowserbaseClient.layer` (`packages/agents/src/providers.ts:134-192`).
    - **Local Chromium (development and flows only).** effect-browser's `Chromium.open` needs Bun or Node, which suits tests and avoids paying for hosted sessions. effect-browser's Policy and Presentation were never used.
12. **Foldkit.**
    - The app is `Runtime.makeApplication({ …, resources: Layer.succeedContext(ctx) })`, with `Runtime.embed` inside `Effect.acquireRelease`, then `BrowserRuntime.runMain` (`packages/frontend/src/entry.ts:34-89`).
    - three.js is mounted through `Mount.defineStream` with `Stream.callback({ strategy: "sliding" })` and `Semaphore.withPermit` (`packages/frontend/src/scene.ts:35-86`).
13. **Processes and CLIs.**
    - Spawn with `ChildProcess.make(cmd, args, { stdout: "pipe", forceKillAfter })` and read `.stdout` and `.exitCode`. Signal readiness through a `Deferred`, and keep everything scoped (`testing/flows/_fixtures/anvil.ts:49-82`).
    - CLIs use `Command.make` with `Flag.*`, then `Command.run`, `BunServices.layer` and `BunRuntime.runMain` (`scripts/bundle-budget.ts`).
14. **Tests.**
    - Suites are `layer(L)("suite", (it) => …)` and `it.layer(L, { concurrent: false })` (`packages/signing/test/dispatch.test.ts:149`, `packages/agents/test/agents.test.ts:95`).
    - Time is `TestClock.setTime` and `TestClock.adjust` from `effect/testing` (`dispatch.test.ts:109-125`).
    - Fake an HTTP edge with `HttpClient.make(…)` returning `HttpClientResponse.fromWeb(request, new Response(…))` (`packages/signing/test/scoped-accounts.test.ts:12-33`).
    - Prove something is sent only once with `Deferred`, `Effect.forkScoped`, `Effect.all({ concurrency: 2 })` and `Ref` counters (`dispatch.test.ts:74-157`).
    - `it.effect.prop` and `Arbitrary` exist but were never used; the new contract's property tests use them.

## Don't

Each of these failed in the first build:

- `Data.struct`.
- `Schema.keyof`.
- `Option.fromNullable`; use `Option.fromNullishOr` or `Option.fromNullOr`.
- `import { Encoding } from "effect"`; use `effect/encoding`.
- `Schema.Number`; use `Schema.Finite`.
- `encodeSync`; use the Effect-returning encoders.
- `decodeUnknown*` on values that are already typed.
