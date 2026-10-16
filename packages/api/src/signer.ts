import { IntentId, Receipt, SwapIntent } from "@floor/contract";
import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";

export class SignerRequestError extends Schema.TaggedError<SignerRequestError>()("SignerRequestError", {
  operation: Schema.String,
  cause: Schema.Defect(),
}) {}

/** @stability unstable */
export const SignerRpcs = RpcGroup.make(
  Rpc.make("submit", { payload: SwapIntent, success: Receipt, error: SignerRequestError }),
  Rpc.make("settle", {
    payload: Schema.Struct({ intentId: IntentId }),
    success: Receipt,
    error: SignerRequestError,
  }),
);
