import { ChangeWorldState, JoinWorld, LandWorldReceipt, WorldPublisher } from "@floor/api/world";
import { WorldRoutes } from "@floor/api/world-rpc";
import { WorldEvent } from "@floor/contract/world-events";
import type { Providers } from "alchemy/Cloudflare";
import { Request } from "alchemy/Cloudflare/Workers/Request";
import { Worker } from "alchemy/Cloudflare/Workers/Worker";
import { Effect, Layer, Schema } from "effect";
import { HttpRouter, HttpServer, HttpServerResponse } from "effect/http";
import { WorldRuntimeLive } from "../src/world/runtime";

export const makeWorldTestWorker = Effect.fn("makeWorldTestWorker")(
  function*(): Effect.fn.Return<Worker<{}>, never, Providers> {
    return yield* Worker(
      "FloorWorldLocal",
      {
        main: import.meta.url,
        compatibility: { date: "2026-08-18", flags: [] },
        dev: { host: "127.0.0.1", port: 19742 },
      },
      Effect.gen(function*() {
        const publisher = yield* WorldPublisher;
        const rpc = yield* HttpRouter.toHttpEffect(WorldRoutes.pipe(Layer.provide(HttpServer.layerServices)));
        return {
          fetch: Effect.gen(function*() {
            const request = yield* Request;
            const path = new URL(request.url).pathname;
            if (!["/join", "/state", "/receipt"].includes(path) && !path.startsWith("/api/world")) {
              return HttpServerResponse.text("ready");
            }
            if (path.startsWith("/api/world")) return yield* rpc;
            const body = yield* Effect.tryPromise(() => request.json());
            const event = path === "/join"
              ? yield* Schema.decodeUnknownEffect(Schema.toCodecJson(JoinWorld))(body).pipe(
                Effect.flatMap(publisher.join),
              )
              : path === "/state"
              ? yield* Schema.decodeUnknownEffect(Schema.toCodecJson(ChangeWorldState))(body).pipe(
                Effect.flatMap(publisher.state),
              )
              : yield* Schema.decodeUnknownEffect(Schema.toCodecJson(LandWorldReceipt))(body).pipe(
                Effect.flatMap(publisher.receipt),
              );
            return yield* HttpServerResponse.schemaJson(WorldEvent)(event);
          }).pipe(Effect.orDie),
        };
      }).pipe(Effect.provide(WorldRuntimeLive)),
    );
  },
);

export default makeWorldTestWorker();
