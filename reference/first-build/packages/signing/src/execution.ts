import { type Policy, type Proposal, Receipt, withoutTransaction } from "@floor/contract";
import { Context, DateTime, Effect, Layer, Option, Predicate, Result, Schema } from "effect";
import { type PolicyContext, reserveExecution } from "./policy";

export class SigningUnavailable
  extends Schema.TaggedError<SigningUnavailable>()("SigningUnavailable", { message: Schema.String })
{}
export interface TransactionResult {
  readonly transactionHash: `0x${string}`;
  readonly blockNumber: Option.Option<number>;
}
export class TransactionExecutor extends Context.Service<TransactionExecutor, {
  execute(
    proposal: Proposal,
    idempotencyKey: string,
    authority: SigningRecord,
  ): Effect.Effect<TransactionResult, SigningUnavailable | TransactionRejected | TransactionOutcomeUnknown>;
}>()("@floor/signing/TransactionExecutor") {
  static readonly unavailable = Layer.succeed(
    TransactionExecutor,
    TransactionExecutor.of({
      execute: () =>
        Effect.fail(
          new SigningUnavailable({
            message: "No audited testnet signing adapter configured. No transaction was signed.",
          }),
        ),
    }),
  );
}
export class TransactionRejected
  extends Schema.TaggedError<TransactionRejected>()("TransactionRejected", { message: Schema.String })
{}
export class TransactionOutcomeUnknown
  extends Schema.TaggedError<TransactionOutcomeUnknown>()("TransactionOutcomeUnknown", { message: Schema.String })
{}
export class SigningJournalError
  extends Schema.TaggedError<SigningJournalError>()("SigningJournalError", { message: Schema.String })
{}
export interface SigningRecord {
  readonly receipt: Receipt;
  readonly proposal: Proposal;
  readonly policy: Policy;
  readonly context: PolicyContext;
}
export class SigningJournal extends Context.Service<SigningJournal, {
  read(receiptId: string): Effect.Effect<Option.Option<SigningRecord>, SigningJournalError>;
  /** Reservation atomically compares receipt, policy and exposure facts. Settlement compares the receipt alone, preserving evidence after policy changes. */
  compareAndSet(expected: SigningRecord, next: Receipt): Effect.Effect<boolean, SigningJournalError>;
}>()("@floor/signing/Journal") {}

const observedResult = (receipt: Receipt, result: TransactionResult): Receipt => {
  const parsed = Schema.decodeUnknownResult(Receipt)({
    ...receipt,
    status: Option.isNone(result.blockNumber) ? "submitted" : "confirmed",
    transactionHash: result.transactionHash,
    blockNumber: Option.getOrNull(result.blockNumber),
    reason: "Transaction submitted through scoped account",
  });
  if (Result.isSuccess(parsed)) return parsed.success;
  // A malformed response after dispatch is uncertainty, never evidence that retrying is safe.
  return withoutTransaction({
    ...receipt,
    status: "uncertain",
    reason: "Signing provider returned invalid transaction evidence; reconcile the original dispatch",
  });
};

/** Only this invocation's successful authoritative append permits a send; observing executing never does. */
const dispatch = Effect.fn("Signing.dispatch")(function*(
  journal: Context.Service.Shape<typeof SigningJournal>,
  executor: Context.Service.Shape<typeof TransactionExecutor>,
  receiptId: string,
) {
  const loaded = yield* journal.read(receiptId);
  if (Option.isNone(loaded)) return yield* new SigningJournalError({ message: "Receipt not found" });
  const record = loaded.value;
  if (record.receipt.status !== "approved") return record.receipt;
  const reserved = reserveExecution(record.receipt, record.proposal, record.policy, record.context);
  const fresh = yield* journal.compareAndSet(record, reserved);
  if (!fresh) {
    const observed = yield* journal.read(receiptId);
    if (Option.isNone(observed)) {
      return yield* new SigningJournalError({ message: "Receipt disappeared during reconciliation" });
    }
    return observed.value.receipt;
  }
  if (reserved.status !== "executing") return reserved;
  const outcome = yield* executor.execute(record.proposal, reserved.id, { ...record, receipt: reserved }).pipe(
    Effect.match({
      onSuccess: (result): Receipt => observedResult(reserved, result),
      onFailure: (error): Receipt =>
        withoutTransaction({
          ...reserved,
          status: Predicate.isTagged(error, "TransactionOutcomeUnknown") ? "uncertain" : "failed",
          reason: error.message,
        }),
    }),
  );
  // A chain block belongs to its own chain. Replay uses when this server learned the outcome, never a cross-chain block comparison.
  const settled = { ...outcome, updatedAt: DateTime.formatIso(yield* DateTime.now) };
  // A failed commit after the send leaves the durable reservation intact. A restart must reconcile, never repeat it.
  const committed = yield* journal.compareAndSet({ ...record, receipt: reserved }, settled);
  if (!committed) {
    return yield* new SigningJournalError({
      message: "Dispatch outcome needs reconciliation against the authoritative receipt",
    });
  }
  return settled;
});

export const dispatchApproved = Effect.fn("Signing.dispatchApproved")(function*(receiptId: string) {
  return yield* dispatch(yield* SigningJournal, yield* TransactionExecutor, receiptId);
});

export class Signing extends Context.Service<Signing, {
  dispatchApproved(receiptId: string): Effect.Effect<Receipt, SigningJournalError>;
}>()("@floor/signing/Signing") {
  static readonly layer = Layer.effect(
    Signing,
    Effect.gen(function*() {
      const journal = yield* SigningJournal;
      const executor = yield* TransactionExecutor;
      return Signing.of({ dispatchApproved: (receiptId) => dispatch(journal, executor, receiptId) });
    }),
  );
}

export function reconcileDispatch(receipt: Receipt, result: TransactionResult, observedAt: string): Receipt {
  if (receipt.status !== "executing" && receipt.status !== "uncertain" && receipt.status !== "submitted") {
    return receipt;
  }
  return observedResult({ ...receipt, updatedAt: observedAt }, result);
}
