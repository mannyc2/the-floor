import { type Proposal, type Receipt, withoutTransaction } from "@floor/contract";
import { createReceipt, fingerprintProposal, Signing } from "@floor/signing";
import { ApiError, type Owner } from "@floor/surfaces";
import { Context, Crypto, DateTime, Effect, Layer, Option, Result, Semaphore } from "effect";
import { AccountContext } from "./account-context";
import { type LaunchReviewRecord, LaunchReviews } from "./launch-reviews";
import { FloorDatabase } from "./store";

const pendingLaunch = (receipt: Receipt, reason: string): Receipt =>
  withoutTransaction({
    ...receipt,
    action: "launch",
    status: "pending-review",
    // oxlint-disable-next-line effect/noNullish -- An unreviewed launch has no approval lifetime in the receipt transport.
    expiresAt: null,
    reason,
  });

const reviewedLaunch = (receipt: Receipt, record: LaunchReviewRecord, now: string): Receipt => {
  const rejected = record.result.status === "rejected";
  return withoutTransaction({
    ...receipt,
    updatedAt: now,
    action: rejected ? "refusal" : "launch",
    status: rejected ? "refused" : "pending-review",
    checks: [
      ...receipt.checks.filter(check => check.rule !== "Launch gate"),
      ...record.result.checks.map(check => ({
        rule: `Launch gate: ${check.name}`,
        passed: check.status === "pass",
        actual: check.detail,
        limit: "pass",
      })),
    ],
    reason: `${rejected ? "Launch refused" : "Launch review pending"}: ${
      record.result.checks.filter(check => check.status !== "pass").map(check => `${check.name}: ${check.detail}`).join(
        "; ",
      )
    }`,
  });
};

/** @stability unstable */
export class Proposals extends Context.Service<Proposals, {
  readonly submit: (owner: Owner, proposal: Proposal) => Effect.Effect<Receipt, ApiError>;
}>()("floor/Proposals") {
  static readonly layer = Layer.effect(
    Proposals,
    Effect.gen(function*() {
      const db = yield* FloorDatabase;
      const accounts = yield* AccountContext;
      const signing = yield* Signing;
      const reviews = yield* LaunchReviews;
      const crypto = yield* Crypto.Crypto;
      const reviewLane = yield* Semaphore.make(1);
      const event = Effect.fn("Proposals.event")(function*(owner: Owner, receipt: Receipt) {
        yield* db.events.insert({
          id: yield* crypto.randomUUIDv4,
          type: "proposal-reviewed",
          // oxlint-disable-next-line effect/noNullish -- Review is a server observation, not a mined transaction.
          blockNumber: null,
          createdAt: DateTime.formatIso(yield* DateTime.now),
          actor: owner.id,
          entityId: receipt.id,
          payload: { status: receipt.status },
        });
      });
      const prepare = Effect.fn("Proposals.prepare")(function*(owner: Owner, proposal: Proposal) {
        const agent = yield* db.agents.findById(proposal.agentId);
        if (agent.owner !== owner.id || proposal.owner !== owner.id) {
          return yield* new ApiError({ message: "A proposal must belong to this owner and agent." });
        }
        const fingerprint = fingerprintProposal(proposal);
        const existing = yield* db.receipts.findByProposal(proposal.id);
        if (Option.isSome(existing)) {
          if (existing.value.data.proposalFingerprint !== fingerprint) {
            return yield* new ApiError({ message: "A proposal ID cannot be reused for different instructions." });
          }
          return existing.value.data;
        }
        const saved = yield* db.proposals.findByIdOption(proposal.id);
        if (Option.exists(saved, value => fingerprintProposal(value) !== fingerprint)) {
          return yield* new ApiError({ message: "Saved proposal instructions cannot be changed during review." });
        }
        const checked = createReceipt(
          proposal,
          agent.policy,
          yield* accounts.load(agent, owner, Option.some(proposal)),
        );
        const receipt = proposal.action === "launch" && checked.checks.every(check =>
            check.passed || check.rule === "Launch gate"
          )
          ? pendingLaunch(
            checked,
            "Launch content and its trusted machine must pass review before approval or casting.",
          )
          : checked;
        if (Option.isNone(saved)) yield* db.proposals.insert(proposal);
        yield* db.receipts.insert({ data: receipt });
        yield* event(owner, receipt);
        return receipt;
      }, db.sql.withTransaction);
      const finishLaunch = Effect.fn("Proposals.finishLaunch")(
        function*(owner: Owner, proposal: Extract<Proposal, { readonly action: "launch" }>, receipt: Receipt) {
          const reviewed = yield* reviews.review(proposal).pipe(Effect.result);
          return yield* db.sql.withTransaction(Effect.gen(function*() {
            const current = (yield* db.receipts.findById(receipt.id)).data;
            if (current.status !== "pending-review") return current;
            const now = DateTime.formatIso(yield* DateTime.now);
            const agent = yield* db.agents.findById(proposal.agentId);
            const updated = Result.isFailure(reviewed)
              ? { ...pendingLaunch(current, reviewed.failure.message), updatedAt: now }
              : reviewed.success.result.status === "accepted"
              ? createReceipt(proposal, agent.policy, yield* accounts.load(agent, owner, Option.some(proposal)))
              : reviewedLaunch(current, reviewed.success, now);
            // Review may take seconds. Preserve the initial record, while approval lifetime starts only after a successful review.
            const result = { ...updated, createdAt: current.createdAt };
            yield* db.receipts.update({ id: result.id, data: result });
            yield* event(owner, result);
            return result;
          }));
        },
      );
      const submit = Effect.fn("Proposals.submit")(
        function*(owner: Owner, proposal: Proposal) {
          const initial = yield* prepare(owner, proposal);
          const receipt = proposal.action === "launch" && initial.status === "pending-review"
            ? yield* finishLaunch(owner, proposal, initial)
            : initial;
          // Reservation rechecks the current policy and exact persisted gate evidence after this judgment has committed.
          return receipt.status === "approved" ? yield* signing.dispatchApproved(receipt.id) : receipt;
        },
        Effect.mapError(error =>
          error._tag === "ApiError" ? error : new ApiError({
            message: "The proposal review could not finish. Inspect its durable receipt before retrying.",
          })
        ),
      );
      return Proposals.of({
        // One scoped review lane prevents concurrent retries from replacing one another's evidence; SQL still owns dispatch authority.
        submit: (owner, proposal) =>
          proposal.action === "launch" ? reviewLane.withPermit(submit(owner, proposal)) : submit(owner, proposal),
      });
    }),
  );
}
