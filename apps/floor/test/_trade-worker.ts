import { FloorRpcs } from "@floor/api/rpc";
import { WorldRoutes } from "@floor/api/world-rpc";
import { signerClientLayer } from "@floor/chains/signer-client";
import { readPoolLayer } from "@floor/chains/solana/read-pool";
import { SolanaRpc } from "@floor/chains/solana/rpc";
import { Receipt, SwapIntent } from "@floor/contract/economics";
import { Health } from "@floor/contract/health";
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
        const rpc = yield* HttpRouter.toHttpEffect(
          Layer.merge(WorldRoutes, HealthRoutes).pipe(Layer.provide(HttpServer.layerServices)),
        );
        return {
          fetch: Effect.gen(function*() {
            const request = yield* Request;
            const path = new URL(request.url).pathname;
            if (path.startsWith("/api/")) return yield* rpc;
            if (path !== "/trade" || request.method !== "POST") return HttpServerResponse.text("ready");
            const body = yield* Effect.tryPromise(() => request.json());
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
