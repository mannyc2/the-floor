import { FloorRpcs } from "@floor/api/rpc";
import { ChangeWorldState, MoveInWorld, WorldPublisher } from "@floor/api/world";
import { WorldRoutes } from "@floor/api/world-rpc";
import { signerClientLayer } from "@floor/chains/signer-client";
import { readPoolLayer } from "@floor/chains/solana/read-pool";
import { SolanaRpc } from "@floor/chains/solana/rpc";
import { Receipt, SwapIntent } from "@floor/contract/economics";
import { Health } from "@floor/contract/health";
import { AgentId, Checkpoint, WorldId } from "@floor/contract/identifiers";
import { WorldEvent } from "@floor/contract/world-events";
import type { Providers } from "alchemy/Cloudflare";
import { WorkerConfigProvider } from "alchemy/Cloudflare/Workers/ConfigProvider";
import { Request } from "alchemy/Cloudflare/Workers/Request";
import { Worker, type WorkerAssetsConfig, type WorkerEnv } from "alchemy/Cloudflare/Workers/Worker";
import { Config, ConfigProvider, Effect, Layer, Schema } from "effect";
import { HttpRouter, HttpServer, HttpServerResponse } from "effect/http";
import { RpcSerialization, RpcServer } from "effect/rpc";
import { FirstAgent, TradeMandate } from "../src/agents/mandate";
import { makeFirstAgentRuntime } from "../src/agents/trade-runtime";
import { WorldRuntimeLive } from "../src/world/runtime";
import { TradeConfiguration } from "./_trade-configuration";
import { toolTurn, tradeModel } from "./trade-fixtures";

const Dependencies = Layer.unwrap(Effect.gen(function*() {
  const provider = yield* WorkerConfigProvider();
  const configuration = yield* Config.schema(TradeConfiguration, "FLOOR_TRADE_CONFIGURATION").pipe(
    Effect.provideService(ConfigProvider.ConfigProvider, provider),
  );
  const intent = yield* Schema.encodeEffect(SwapIntent)(configuration.mandate.intent);
  return Layer.mergeAll(
    // The model is the only synthetic edge; pool, signature, receipt and world storage remain native.
    tradeModel([toolTurn("read_pool"), toolTurn("submit_intent", { intent })]),
    signerClientLayer(configuration.signerUrl),
    readPoolLayer(configuration.mandate.intent.chain).pipe(Layer.provide(SolanaRpc.layer(configuration.endpoint))),
  );
}));
const Runtime = makeFirstAgentRuntime(Dependencies).pipe(Layer.provideMerge(WorldRuntimeLive));
// Arrivals for a separate, labelled synthetic world. The multi-floor browser
// flow publishes through the same internal service the agent uses; production
// has no such route.
const WorldArrivals = Schema.Struct({ world: WorldId, checkpoint: Checkpoint, agents: Schema.Array(AgentId) });
const HealthRoutes = RpcServer.layerHttp({ group: FloorRpcs, path: "/api/rpc", protocol: "http" }).pipe(
  Layer.provide(RpcSerialization.layerJson),
  Layer.provide(
    FloorRpcs.toLayer({ health: () => Effect.succeed(Health.make({ status: "ready", service: "floor" })) }),
  ),
);
export const makeTradeTestWorker = Effect.fn("makeTradeTestWorker")(
  function*(options: {
    readonly assets?: WorkerAssetsConfig;
    readonly env?: WorkerEnv;
  } = {}): Effect.fn.Return<Worker<{}>, never, Providers> {
    return yield* Worker(
      "FloorFirstTradeLocal",
      {
        main: import.meta.url,
        compatibility: { date: "2026-08-18", flags: [] },
        dev: { host: "127.0.0.1", port: 19743 },
        ...options,
      },
      Effect.gen(function*() {
        const agent = yield* FirstAgent;
        const world = yield* WorldPublisher;
        const rpc = yield* HttpRouter.toHttpEffect(
          Layer.merge(WorldRoutes, HealthRoutes).pipe(Layer.provide(HttpServer.layerServices)),
        );
        return {
          fetch: Effect.gen(function*() {
            const request = yield* Request;
            const path = new URL(request.url).pathname;
            if (path.startsWith("/api/")) return yield* rpc;
            const publication = ["/world/arrivals", "/world/state", "/world/move"].includes(path);
            if ((path !== "/trade" && !publication) || request.method !== "POST") {
              return HttpServerResponse.text("ready");
            }
            const body = yield* Effect.tryPromise(() => request.json());
            if (path === "/world/arrivals") {
              const input = yield* Schema.decodeUnknownEffect(Schema.toCodecJson(WorldArrivals))(body);
              const joined = yield* Effect.forEach(
                input.agents,
                arrival => world.join({ world: input.world, checkpoint: input.checkpoint, agent: arrival }),
                { concurrency: 1 },
              );
              return yield* HttpServerResponse.schemaJson(Schema.Array(WorldEvent))(joined);
            }
            if (path === "/world/state") {
              const input = yield* Schema.decodeUnknownEffect(Schema.toCodecJson(ChangeWorldState))(body);
              return yield* HttpServerResponse.schemaJson(WorldEvent)(yield* world.state(input));
            }
            if (path === "/world/move") {
              const input = yield* Schema.decodeUnknownEffect(Schema.toCodecJson(MoveInWorld))(body);
              return yield* HttpServerResponse.schemaJson(WorldEvent)(yield* world.move(input));
            }
            const input = yield* Schema.decodeUnknownEffect(Schema.toCodecJson(TradeMandate))(body);
            const receipt = yield* agent.run(input);
            return yield* HttpServerResponse.schemaJson(Receipt)(receipt);
          }).pipe(Effect.orDie),
        };
      }).pipe(Effect.provide(Runtime)),
    );
  },
);
export default makeTradeTestWorker();
