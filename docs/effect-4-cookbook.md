# Effect 4 cookbook

Effect 4 patterns that work in this workspace, so nobody guesses at APIs that don't exist. They were first checked against Effect 4.0.0 and its family on 12 October 2026; the workspace now runs 4.0.3, so verify each API in the installed source before relying on it. This doesn't replace reading `node_modules/effect/AGENTS.md` in full. Where a pattern is used in this repository, the file is named.

## Module layout

Effect 4 has no `effect/unstable/*` paths. The modules are `effect`, `effect/schema`, `effect/ai`, `effect/http`, `effect/http-api`, `effect/rpc`, `effect/sql`, `effect/workflow`, `effect/encoding`, `effect/process`, `effect/cli`, `effect/socket`, `effect/testing` and so on. "Unstable" is a `@stability unstable` doc tag on exports such as `HttpApi` and the AI module. The `apiStabilityLeak` diagnostic, driven by `allowedUnstableApis` in `tsconfig.json`, stops the Floor's own exports from re-exposing them, with `@floor/api` as the one exception.

## Patterns

1. **Errors.**
   - Write `class E extends Schema.TaggedError<E>()("Tag", fields, { httpApiStatus })`. There is no `TaggedErrorClass`.
   - An error that wraps a foreign failure carries `cause: Schema.Defect()` (`packages/chains/src/error.ts`, `packages/wallets/src/privy/error.ts`).
2. **Services.**
   - Write `class X extends Context.Service<X, Shape>()("floor/X") { static layer = Layer.effect(X, make) }` (`apps/floor/src/agents/models.ts`). It is `Context.Service`, not `ServiceMap`.
   - Layers that depend on config use `Layer.unwrap` (`apps/floor/src/agents/runtime.ts`).
3. **Functions.** Write `Effect.fn("name")(function* () { … }, Effect.timeout(…), Effect.mapError(…))`, with pipeables trailing the generator. Use `Effect.fnUntraced` where a span on every call isn't a useful tracing boundary, such as small arithmetic helpers (`packages/chains/src/solana/math.ts`).
4. **Schema.**
   - `Schema.Literals`, and `Schema.TemplateLiteral(…).check(Schema.isPattern(…))`.
   - `Schema.Finite.check(Schema.isGreaterThanOrEqualTo(…))`, never `Schema.Number`.
   - `Schema.suspend` for recursive types, and `mapFields(Struct.pick(…))` for projections.
   - `Schema.DateTimeUtcFromString` and `Schema.OptionFromNullOr` at the boundary.
   - `withDecodingDefaultKey` for defaults (`scripts/bundle-budget/model.ts`).
   - `Schema.toEquivalence` to compare decoded values.
   - `Schema.fromJsonString(Schema.toCodecJson(X))` to carry an `Option` through JSON.
5. **HTTP API.**
   - Endpoints are `HttpApiEndpoint.get(name, path, { query, success, error })`; groups are `HttpApiGroup.make(…).add(…)`; the API is `HttpApi.make(…).add(…).prefix(…)` (`packages/api/src/http.ts`).
   - Middleware is `HttpApiMiddleware.Service<S, { provides }>()`.
   - Handlers are `HttpApiBuilder.group(Api, "g", Effect.fn(function* (h) { return h.handleAll({ … }) }))` with `HttpApiBuilder.layer`.
6. **RPC streams.**
   - On the server, `RpcGroup.make(Rpc.make("watch", { success, stream: true }))` runs with `RpcServer.layerHttp({ group, path, protocol: "websocket" })` and `RpcSerialization.layerNdjson`.
   - On the client, `RpcClient.layerProtocolSocket()` runs with `Socket.layerWebSocket(url)` and `Socket.layerWebSocketConstructorGlobal`.
7. **SQL.**
   - Models are `Model.Class` with `Model.BooleanSqlite` and `Model.Field`; repositories are `SqlModel.makeRepository`; queries use `SqlSchema.findOneOption` and `SqlSchema.void`.
   - On Workers, storage goes through Alchemy: Durable Object SQL with its migrations, and D1. Their transactions differ (see [the platform](platform.md#built-on-alchemy)).
8. **Streams, caches and fibres.**
   - `PubSub.sliding({ capacity, replay: 1 })` with `Stream.fromPubSub` for a live feed with the latest value.
   - `Cache.makeWith(lookup, { timeToLive: (exit) => Exit.isSuccess(exit) ? "15 seconds" : "0 seconds" })` keeps only successes.
   - `FiberMap.run(map, key, effect, { onlyIfMissing: true })` gives one run per key.
9. **AI.**
   - Tools are `Tool.make(name, { parameters, success, failure, failureMode: "return" })`, then `Toolkit.make(…)` and `toolkit.toLayer(…)`.
   - MCP is `McpServer.layerHttp({ path, protocols: [McpProtocol.v2026_07_28] })`.
   - Decisions use `Decision.make({ decisions: { key: Decision.probability(…) } })` with `model.decide(…)`. Stub a model with `DecisionModel.make({ decide })`.
   - `@effect/ai-openai` has no Decisions provider, so the Floor has its own predicate-only adapter (`apps/floor/src/agents/decisions.ts`). The Anthropic and OpenAI Layers are in `apps/floor/src/agents/models.ts`.
10. **Yielded Agent.**
    - Write `Agent.make(id, { input, output, toolkit, instructions, policy: { maxTurns, maxToolCalls, maxDuration, tokenBudget, costBudgetMicrousd, onExhaustion } })` and run it with `AgentRuntime.run` (`apps/floor/src/agents/runtime.ts`).
    - The agent's Durable Object uses Yielded's Alchemy platform, from the pinned build in `vendor/yielded/`.
11. **Browsers.** The agent's browser is a provider Layer with three implementations:
    - **Cloudflare (the default).** Use Yielded Agent's browser capabilities ([guide](https://yielded.dev/agent/guide/browser/)):
      - Reading uses `WebCapture.make(name, { description, urls, actions, maxResponseBytes })` with `Toolkit.make(capture.tool)`. `urls` is a deny-by-default host list; `actions` are `"markdown"`, `"content"` and `"links"`.
      - Navigation uses interactive sessions governed by `InteractiveBrowserPolicy` (`network`: `ExactHosts`, `PublicWeb` or `Unrestricted`; `maxActions`; `maxElapsedMillis`; `maxReturnedBytes`).
      - The Cloudflare adapters live in `@yielded/agent-platform-cloudflare`, not `@yielded/agent`; read its exports before wiring them. The adapter can't enforce `PublicWeb` (see [the platform](platform.md#the-agents-browser)).
    - **Browserbase (the alternative).** `Browserbase.open({ session, maxPages, guard })` returns `{ browser, release }`. Use `client.liveView` for takeover, and provide `BrowserbaseClient.layer`.
    - **Local Chromium (development and flows only).** effect-browser's `Chromium.open` needs Bun or Node, which suits tests and avoids paying for hosted sessions. effect-browser also has Policy and Presentation modules.
12. **Foldkit.**
    - The app is `Runtime.makeApplication({ … })` (`apps/web/src/entry.ts`). To give it Effect services, pass `resources: Layer.succeedContext(ctx)`, run it with `Runtime.embed` inside `Effect.acquireRelease`, then `BrowserRuntime.runMain`.
    - three.js is mounted through `Mount.defineStream` with `Stream.callback({ strategy: "sliding" })` and `Semaphore.withPermit`.
13. **Processes and CLIs.**
    - Spawn with `ChildProcess.make(cmd, args, { stdout: "pipe", forceKillAfter })` and read `.stdout` and `.exitCode`. Signal readiness through a `Deferred`, and keep everything scoped.
    - CLIs use `Command.make` with `Flag.*`, then `Command.run` and `BunServices.layer` (`scripts/ci/admin.ts`, `scripts/bundle-budget/cli.ts`).
14. **Tests.**
    - Leaf tests run on `bun test`. Run an Effect through the package's single adapter (`packages/chains/test/_runtime.ts`), or through Alchemy's `Test` harness for Worker code (`apps/floor/test/admission.test.ts`).
    - Time is `TestClock.setTime` and `TestClock.adjust` from `effect/testing`.
    - Fake an HTTP edge with `HttpClient.make(…)` returning `HttpClientResponse.fromWeb(request, new Response(…))`.
    - Prove something is sent only once with `Deferred`, `Effect.forkScoped`, `Effect.all({ concurrency: 2 })` and `Ref` counters.

## Don't

These don't exist or don't work in Effect 4:

- `Data.struct`.
- `Schema.keyof`.
- `Option.fromNullable`; use `Option.fromNullishOr` or `Option.fromNullOr`.
- `import { Encoding } from "effect"`; use `effect/encoding`.
- `Schema.Number`; use `Schema.Finite`.
- `encodeSync`; use the Effect-returning encoders.
- `decodeUnknown*` on values that are already typed.
