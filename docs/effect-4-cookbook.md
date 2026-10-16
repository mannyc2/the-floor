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
   - `@effect/ai-openai` has no Decisions provider, so the Floor has its own predicate-only adapter (`apps/floor/src/agents/decisions.ts`). The OpenAI model Layer is in `apps/floor/src/agents/models.ts`.
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

## Fibers

- **Choose a fiber's lifetime on purpose.**
  - `Effect.forkChild` ends with its parent fiber. Use it for concurrent work inside one operation.
  - `Effect.forkScoped` ends when the current scope closes, even after its parent has finished. Use it for background workers owned by a mount or a Layer, such as the renderer's animation loop and observers.
  - `Effect.forkIn(effect, scope)` ends when a given scope closes, for work that must outlive an inner scope but not an outer one.
  - `Effect.forkDetach` lives until it completes or the program ends. Don't use it in the Floor's code: a detached fiber outlives its owner and leaks work.
- **Interrupt and wait.**
  - `Fiber.interrupt(fiber)` returns only after the fiber has stopped and its finalizers have run. Use it wherever cleanup must finish before the next step, such as retiring a renderer before acquiring the next one.
  - `fiber.interruptUnsafe()` only signals; it doesn't wait.
  - Replacing a `FiberMap` entry interrupts the previous fiber without waiting for its cleanup, so a `FiberMap` can't enforce "release before reacquire".
  - `FiberSet.size` reports 0 as soon as the set's scope starts closing, while interruption may still be running. To prove cleanup, await the scope's closure and check the resources themselves.
- **Read outcomes.** `Fiber.join` re-raises the fiber's failure. `Fiber.await` returns its `Exit`, which tells an interruption from a failure. Pair it with `Effect.track(metric, mapExit)` to count outcomes by kind.
- **Expect late starts.** A forked fiber starts only after the current fiber yields, and even a yield doesn't guarantee it has started. In tests, signal readiness with a `Deferred` before sending work, never `Effect.sleep` or `Effect.yieldNow`. A subscriber that starts late misses earlier changes, so where late joiners matter, prefer state that holds the latest value, like the renderer's display slot, over a stream of events.
- **Count fibers in tests and the workbench.** `Metric.enableRuntimeMetricsLayer` records `child_fibers_active`, `child_fibers_started`, `child_fiber_successes` and `child_fiber_failures`. Every exit that isn't a success counts as a failure, including a normal interruption at unmount, so classify outcomes with `Fiber.await` and `Effect.track` instead. Fiber counts returning to baseline don't prove that other resources, such as WebGL contexts or listeners, were released. Effect 4 has no `Supervisor.track` or `Effect.supervised`.

## Don't

Avoid these old APIs and unsupported boundary patterns:

- `Data.struct`.
- `Schema.keyof`.
- `Option.fromNullable`; use `Option.fromNullishOr` or `Option.fromNullOr`.
- `import { Encoding } from "effect"`; use `effect/encoding`.
- `Schema.Number`; use `Schema.Finite`.
- Synchronous Schema encoders exist in installed 4.0.3, but use the Effect-returning encoders by default. A synchronous Foldkit view that stores a typed presentation in a DOM attribute uses `Schema.encodeSync` at that exact boundary, with a reasoned diagnostic exception.
- `decodeUnknown*` on values that are already typed.
