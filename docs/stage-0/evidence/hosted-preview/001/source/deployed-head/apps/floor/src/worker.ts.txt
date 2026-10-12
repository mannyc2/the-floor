import { FloorHttpApi } from "@floor/api/http";
import { Health } from "@floor/contract/health";
import type { Providers } from "alchemy/Cloudflare";
import { Worker, type WorkerAssetsConfig, type WorkerEnv } from "alchemy/Cloudflare/Workers/Worker";
import { Effect, Layer } from "effect";
import { HttpRouter, HttpServer } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";
import { AgentRuntimeLive, Agents } from "./agents/runtime";

const HealthHandlers = HttpApiBuilder.group(
  FloorHttpApi,
  "health",
  (handlers) => handlers.handle("get", () => Effect.succeed(Health.make({ status: "ready", service: "floor" }))),
);
const Routes = HttpApiBuilder.layer(FloorHttpApi).pipe(Layer.provide(HealthHandlers));

export const makeFloorWorker = Effect.fn("makeFloorWorker")(function*(options: {
  readonly assets?: WorkerAssetsConfig;
  readonly env?: WorkerEnv;
} = {}): Effect.fn.Return<Worker<{}>, never, Providers> {
  return yield* Worker(
    "FloorWorker",
    {
      main: import.meta.url,
      compatibility: { date: "2026-08-18", flags: [] },
      dev: { host: "127.0.0.1", port: 19740 },
      ...options,
    },
    Effect.gen(function*() {
      yield* Agents;
      const fetch = yield* HttpRouter.toHttpEffect(Routes.pipe(Layer.provide(HttpServer.layerServices)));
      return { fetch };
    }).pipe(
      // oxlint-disable-next-line effecttsgo/strict-effect-provide, effect/noInlineProvide -- Alchemy owns the native Worker application scope and bindings.
      Effect.provide(AgentRuntimeLive),
    ),
  );
});

export default makeFloorWorker();
