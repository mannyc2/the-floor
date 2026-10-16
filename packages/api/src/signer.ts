import { IntentId, Receipt, SwapIntent } from "@floor/contract";
import { Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";

export class SignerRequestError extends Schema.TaggedError<SignerRequestError>()("SignerRequestError", {
  operation: Schema.String,
  cause: Schema.Defect(),
}, { httpApiStatus: 400 }) {}

/** @stability unstable */
export const SignerHttpApi = HttpApi.make("Signer").add(
  HttpApiGroup.make("signer").add(
    HttpApiEndpoint.post("submit", "/signer/submit", {
      payload: SwapIntent,
      success: Receipt,
      error: SignerRequestError,
    }),
    HttpApiEndpoint.post("settle", "/signer/settle", {
      payload: Schema.Struct({ intentId: IntentId }),
      success: Receipt,
      error: SignerRequestError,
    }),
  ),
);
