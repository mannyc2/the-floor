import { BunRuntime } from "@effect/platform-bun";
import { WorldId } from "@floor/contract/identifiers";
import { localState, Stack } from "alchemy";
import { providers } from "alchemy/Cloudflare";
import * as Test from "alchemy/Test/Core";
import { Config, Effect, FileSystem, Schema } from "effect";
import { TradeMandate } from "../src/agents/mandate";
import { readTradeConfiguration, TradeConfiguration } from "./_trade-configuration";
import { makeTradeTestWorker } from "./_trade-worker";

const options = {
  providers: providers(),
  state: localState(),
  dev: true,
  sidecar: false,
  stage: "first-agent-browser",
};
const serve = Effect.gen(function*() {
  const scope = yield* Effect.scope;
  const fs = yield* FileSystem.FileSystem;
  const world = yield* Config.schema(WorldId, "FLOOR_TRADE_WORLD").pipe(
    Config.withDefault(WorldId.make("first-agent-browser")),
  );
  const configuration = yield* readTradeConfiguration(world);
  const directory = yield* Config.schema(Schema.NonEmptyString, "FLOOR_TRADE_ASSETS").pipe(
    Config.withDefault("apps/web/dist"),
  );
  const stack = Stack(
    "FloorFirstAgentBrowser",
    { providers: providers(), state: localState() },
    makeTradeTestWorker({
      assets: {
        directory,
        runWorkerFirst: ["/api/*", "/trade", "/world/*"],
        notFoundHandling: "single-page-application",
      },
      env: { FLOOR_TRADE_CONFIGURATION: yield* Schema.encodeEffect(TradeConfiguration)(configuration) },
    }),
  );
  yield* Test.deploy(options, stack, { scope });
  yield* Effect.addFinalizer(() => Test.destroy(options, stack).pipe(Effect.orDie));
  const viewer = new URL("http://127.0.0.1:19743");
  viewer.searchParams.set("world", configuration.mandate.world);
  viewer.searchParams.set("chain", configuration.mandate.intent.chain);
  yield* fs.makeDirectory("work/first-trade", { recursive: true });
  yield* fs.writeFileString(
    "work/first-trade/agent.json",
    yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Struct({
      url: Schema.String,
      mandate: Schema.toCodecJson(TradeMandate),
    })))({ url: viewer.href, mandate: configuration.mandate }),
  );
  yield* Effect.addFinalizer(() => fs.remove("work/first-trade/agent.json").pipe(Effect.orDie));
  yield* Effect.log(`First agent and world ready at ${viewer.href}; public metadata is in work/first-trade/agent.json`);
  return yield* Effect.never;
});
// oxlint-disable-next-line effecttsgo/any-unknown-in-error-context -- Alchemy erases its harness error type; this executable contains it at the runtime boundary.
BunRuntime.runMain(Test.toEffect(serve, options).pipe(Effect.orDie));
