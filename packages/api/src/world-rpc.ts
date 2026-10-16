import { WorldFrame, WorldPublishError, WorldQuery } from "@floor/contract/world-stream";
import { Effect, Layer } from "effect";
import { Rpc, RpcGroup, RpcSerialization, RpcServer } from "effect/rpc";
import { WorldReader } from "./world";

/** @stability unstable */
export const WorldRpcs = RpcGroup.make(
  Rpc.make("watchWorld", { payload: WorldQuery, success: WorldFrame, error: WorldPublishError, stream: true }),
);

const Handlers = WorldRpcs.toLayer(Effect.map(WorldReader, reader => ({ watchWorld: reader.watch })));

/** @stability unstable */
export const WorldRoutes = RpcServer.layerHttp({ group: WorldRpcs, path: "/api/world", protocol: "http" }).pipe(
  Layer.provide(RpcSerialization.layerNdjson),
  Layer.provide(Handlers),
);
