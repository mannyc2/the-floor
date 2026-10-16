import { SignerError } from "@floor/chains/signer";
import type { IntentId, Receipt } from "@floor/contract";
import { Context } from "effect";
import type { Effect, Option } from "effect";

export class SubmissionJournal extends Context.Service<SubmissionJournal, {
  readonly read: (id: IntentId) => Effect.Effect<Option.Option<Receipt>, SignerError>;
  readonly write: (receipt: Receipt) => Effect.Effect<void, SignerError>;
}>()("@floor/signer/SubmissionJournal") {}
