import { Health, HealthRequest } from "@floor/contract/health";
import { Rpc, RpcGroup } from "effect/rpc";

/** @stability unstable */
export const FloorRpcs = RpcGroup.make(
  Rpc.make("health", { payload: HealthRequest, success: Health }),
);
