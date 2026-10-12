import { Address, type Agent, type Proposal } from "@floor/contract";
import { type PolicyContext, ScopedAccounts, SigningUnavailable } from "@floor/signing";
import type { Owner } from "@floor/surfaces";
import { Context, DateTime, Effect, Layer, Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { LaunchReviewEvidence } from "./launch-reviews";
import { FloorDatabase } from "./store";

export const unverifiedContext = (agent: Agent, owner: Owner, now: DateTime.Utc): PolicyContext => ({
  owner: owner.id,
  ownerAddress: Option.fromNullishOr(owner.walletAddress),
  walletAddress: Option.none(),
  agentId: agent.id,
  paused: agent.paused,
  now: DateTime.formatIso(now),
  walletUsd: 0,
  resultingPositionUsd: 0,
  dailyLossUsd: 0,
  quotedValueUsd: Option.none(),
  quoteExpiresAt: Option.none(),
  agentLaunchesToday: 0,
  ownerLaunchesThisWeek: 0,
  allocationLockedUntil: Option.none(),
  sourceEvidenceVerified: false,
  launchGateApproved: false,
  isTestnet: true,
});

/** @stability unstable */
export class AccountContext extends Context.Service<AccountContext, {
  readonly status: { readonly configured: boolean; readonly detail: string };
  load(agent: Agent, owner: Owner, proposal: Option.Option<Proposal>): Effect.Effect<PolicyContext, SigningUnavailable>;
}>()("floor/AccountContext") {
  static readonly layer = Layer.effect(
    AccountContext,
    Effect.gen(function*() {
      const accounts = yield* ScopedAccounts;
      const db = yield* FloorDatabase;
      const launchEvidence = yield* LaunchReviewEvidence;
      const hasSourceEvidence = Effect.fn("AccountContext.sourceEvidence")(function*(proposal: Proposal) {
        const thesis = yield* db.theses.findById(proposal.thesisId);
        if (
          thesis.agentId !== proposal.agentId || (proposal.action !== "launch" && thesis.marketId !== proposal.marketId)
          || thesis.noteIds.length === 0
        ) return false;
        const notes = yield* Effect.forEach(thesis.noteIds, id => db.notes.findById(id));
        const sources = new Set(
          notes.filter(note =>
            note.agentId === proposal.agentId && note.marketId === thesis.marketId
            && (note.status === "verified" || note.status === "sourced")
          ).flatMap(note => note.sources.map(source => source.id)),
        );
        return proposal.sourceIds.length > 0 && proposal.sourceIds.every(id => sources.has(id));
      }, Effect.catchTag("NoSuchElementError", () => Effect.succeed(false)));
      const launchCounts = SqlSchema.findOne({
        Request: Schema.Struct({
          owner: Schema.String,
          agentId: Schema.String,
          dayStart: Schema.String,
          weekStart: Schema.String,
        }),
        Result: Schema.Struct({ agentLaunchesToday: Schema.Natural, ownerLaunchesThisWeek: Schema.Natural }),
        execute: (request) =>
          db.sql`
        SELECT
          COUNT(CASE WHEN json_extract(data, '$.agentId') = ${request.agentId}
            AND json_extract(data, '$.createdAt') >= ${request.dayStart} THEN 1 END) AS agentLaunchesToday,
          COUNT(CASE WHEN json_extract(data, '$.owner') = ${request.owner}
            AND json_extract(data, '$.createdAt') >= ${request.weekStart} THEN 1 END) AS ownerLaunchesThisWeek
        FROM receipts WHERE json_extract(data, '$.action') = 'launch'
          AND json_extract(data, '$.status') IN ('executing', 'uncertain', 'submitted', 'confirmed')`,
      });
      return AccountContext.of({
        status: accounts.status,
        load: Effect.fn("AccountContext.load")(
          function*(agent: Agent, owner: Owner, proposal: Option.Option<Proposal>) {
            const now = yield* DateTime.now;
            const base = {
              ...unverifiedContext(agent, owner, now),
              sourceEvidenceVerified: Option.isSome(proposal) && proposal.value.action !== "withdraw"
                ? yield* hasSourceEvidence(proposal.value)
                : false,
              launchGateApproved: Option.isSome(proposal) && proposal.value.action === "launch"
                ? yield* launchEvidence.accepted(proposal.value)
                : false,
            };
            if (agent.owner !== owner.id) {
              return yield* new SigningUnavailable({ message: "The account belongs to a different owner." });
            }
            if (!accounts.status.configured || owner.mode !== "wallet" || Option.isNone(base.ownerAddress)) return base;
            const address = yield* Schema.decodeUnknownEffect(Address)(base.ownerAddress.value);
            const binding = yield* accounts.binding(owner.id, address, agent.id, agent.policy);
            const linked = yield* accounts.read(binding);
            if (Option.isNone(linked)) return base;
            const storedAddress = Option.fromNullishOr(agent.walletAddress);
            if (
              Option.exists(storedAddress, (current) => current.toLowerCase() !== linked.value.account.toLowerCase())
            ) {
              return yield* new SigningUnavailable({
                message: "The remote account differs from the account already bound to this desk.",
              });
            }
            if (Option.isNone(storedAddress)) {
              // Only an externally owner-authorized, policy-bound account can fill this field; this never creates an account or permission.
              yield* db.agents.update({ ...agent, walletAddress: linked.value.account });
            }
            const verified = { ...base, walletAddress: Option.some(linked.value.account) };
            if (Option.isNone(proposal) || proposal.value.action === "withdraw") return verified;
            if (
              proposal.value.agentId !== agent.id || proposal.value.owner !== owner.id
              || proposal.value.chainId !== 84532
            ) {
              return yield* new SigningUnavailable({
                message: "A quote must belong to this owner's Base Sepolia proposal.",
              });
            }
            const quote = yield* accounts.quote({ binding, proposal: proposal.value });
            if (quote.account.toLowerCase() !== linked.value.account.toLowerCase()) {
              return yield* new SigningUnavailable({
                message: "The independent valuation belongs to a different account.",
              });
            }
            const local = yield* launchCounts({
              owner: owner.id,
              agentId: agent.id,
              dayStart: `${DateTime.formatIso(now).slice(0, 10)}T00:00:00.000Z`,
              weekStart: DateTime.formatIso(DateTime.subtract(now, { days: 7 })),
            });
            return {
              ...verified,
              now: DateTime.formatIso(yield* DateTime.now),
              walletUsd: quote.walletUsd,
              resultingPositionUsd: quote.resultingPositionUsd,
              dailyLossUsd: quote.dailyLossUsd,
              quotedValueUsd: Option.some(quote.valueUsd),
              quoteExpiresAt: Option.some(DateTime.formatIso(quote.expiresAt)),
              agentLaunchesToday: Math.max(local.agentLaunchesToday, quote.agentLaunchesToday),
              ownerLaunchesThisWeek: Math.max(local.ownerLaunchesThisWeek, quote.ownerLaunchesThisWeek),
              allocationLockedUntil: Option.map(quote.allocationLockedUntil, DateTime.formatIso),
            };
          },
          Effect.mapError(() =>
            new SigningUnavailable({
              message: "Fresh owner-bound account evidence could not be verified. No transaction can be reserved.",
            })
          ),
        ),
      });
    }),
  );
}
