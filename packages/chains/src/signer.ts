import type { IntentId, Receipt, SwapIntent } from "@floor/contract";
import { Context, Schema } from "effect";
import type { Effect } from "effect";

export class SignerError extends Schema.TaggedError<SignerError>()("SignerError", {
  operation: Schema.String,
  cause: Schema.Defect(),
}) {}

export class Signer extends Context.Service<Signer, {
  readonly submit: (intent: SwapIntent) => Effect.Effect<Receipt, SignerError>;
  readonly settle: (intentId: IntentId) => Effect.Effect<Receipt, SignerError>;
}>()("@floor/chains/Signer") {}
