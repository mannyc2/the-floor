import { Agent, Policy, Proposal, Receipt } from "@floor/contract";
import { type PolicyContext, SigningJournal, SigningJournalError, type SigningRecord } from "@floor/signing";
import { type Owner } from "@floor/surfaces";
import { DateTime, Effect, Equivalence, Layer, Option, Schema } from "effect";
import { AccountContext, unverifiedContext } from "./account-context";
import { FloorDatabase } from "./store";

/** @stability unstable */
export const policyContext = Effect.fn("Signing.policyContext")(
  function*(agent: Agent, owner: Owner, proposal: Option.Option<Proposal> = Option.none()) {
    return yield* (yield* AccountContext).load(agent, owner, proposal);
  },
);

const sameReceipt = Schema.toEquivalence(Receipt);
const samePolicy = Schema.toEquivalence(Policy);
const sameProposal = Schema.toEquivalence(Proposal);
const sameOptionalString = Option.makeEquivalence(Equivalence.String);
const sameOptionalNumber = Option.makeEquivalence(Equivalence.Number);
const sameReservationFacts = (before: PolicyContext, current: PolicyContext) =>
  before.paused === current.paused && before.walletUsd === current.walletUsd
  && before.sourceEvidenceVerified === current.sourceEvidenceVerified
  && before.launchGateApproved === current.launchGateApproved
  && before.resultingPositionUsd === current.resultingPositionUsd && before.dailyLossUsd === current.dailyLossUsd
  && before.agentLaunchesToday === current.agentLaunchesToday
  && before.ownerLaunchesThisWeek === current.ownerLaunchesThisWeek
  && sameOptionalString(before.walletAddress, current.walletAddress)
  && sameOptionalString(before.ownerAddress, current.ownerAddress)
  && sameOptionalString(before.allocationLockedUntil, current.allocationLockedUntil)
  && sameOptionalNumber(before.quotedValueUsd, current.quotedValueUsd);
/** @stability unstable */
export const SigningJournalLive = Layer.effect(
  SigningJournal,
  Effect.gen(function*() {
    const db = yield* FloorDatabase;
    const accounts = yield* AccountContext;
    const load = Effect.fn("SigningJournal.load")(function*(id: string) {
      const { data: receipt } = yield* db.receipts.findById(id);
      const proposal = yield* db.proposals.findById(receipt.proposalId);
      const agent = yield* db.agents.findById(receipt.agentId);
      const owner = yield* db.owners.findById(receipt.owner);
      return {
        receipt,
        proposal,
        policy: agent.policy,
        context: receipt.status === "approved"
          ? yield* accounts.load(agent, owner, Option.some(proposal))
          : unverifiedContext(agent, owner, yield* DateTime.now),
      } satisfies SigningRecord;
    });
    const read = (id: string) =>
      load(id).pipe(
        Effect.asSome,
        Effect.catchTag("NoSuchElementError", () => Effect.succeedNone),
        Effect.mapError(() => new SigningJournalError({ message: "The signing record could not be read." })),
      );
    const compareAndSet = Effect.fn("SigningJournal.compareAndSet")(function*(expected: SigningRecord, next: Receipt) {
      return yield* db.sql.withTransaction(Effect.gen(function*() {
        const stored = yield* db.receipts.findById(expected.receipt.id);
        if (!sameReceipt(stored.data, expected.receipt)) return false;
        if (expected.receipt.status === "approved") {
          const current = yield* load(expected.receipt.id);
          if (
            !samePolicy(current.policy, expected.policy) || !sameProposal(current.proposal, expected.proposal)
            || !sameReservationFacts(expected.context, current.context)
          ) return false;
        }
        // Settlement checks the reserved receipt alone so a later policy edit cannot erase transaction evidence.
        yield* db.receipts.update({ id: next.id, data: next });
        return true;
      })).pipe(
        Effect.mapError(() => new SigningJournalError({ message: "The signing record could not be committed." })),
      );
    });
    return SigningJournal.of({ read, compareAndSet });
  }),
);
