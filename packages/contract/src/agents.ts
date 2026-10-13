import { Array, BigDecimal, Schema } from "effect";
import {
  AccountRef,
  AgentId,
  AssetRef,
  DeskId,
  DestinationId,
  Digest,
  Label,
  OwnerId,
  PolicyId,
  SignerId,
  Timestamp,
  VersionId,
  WalletId,
} from "./identifiers.ts";

// Decimal dollars remain exact across JSON, policy evaluation and the signer;
// binary floating-point prices must never become payment instructions.
const DecimalDollars = Schema.String.check(
  Schema.isTrimmed(),
  Schema.isPattern(/^[+]?[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/),
).pipe(
  Schema.decodeTo(Schema.BigDecimalFromString),
);
export const Usd = DecimalDollars.check(Schema.isGreaterThanOrEqualToBigDecimal(BigDecimal.make(0n, 0))).pipe(
  Schema.brand("Usd"),
);
export type Usd = typeof Usd.Type;
export const PositiveUsd = DecimalDollars.check(Schema.isGreaterThanBigDecimal(BigDecimal.make(0n, 0))).pipe(
  Schema.brand("PositiveUsd"),
);
export type PositiveUsd = typeof PositiveUsd.Type;
export const Fraction = Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 }));
export type Fraction = typeof Fraction.Type;
export const Capability = Schema.Literals(["trade", "launch", "research", "publish", "talk", "build"]);
export type Capability = typeof Capability.Type;
export const Mandate = Schema.Struct({
  instructions: Schema.NonEmptyString,
  capabilities: Schema.Array(Capability).check(Schema.isUnique()),
  updatedAt: Timestamp,
});
export type Mandate = typeof Mandate.Type;

export const Wallet = Schema.Struct({ id: WalletId, account: AccountRef });
export type Wallet = typeof Wallet.Type;
export const VerifiedWithdrawalDestination = Schema.TaggedUnion({
  OwnAccount: { id: DestinationId, owner: OwnerId, account: AccountRef, verifiedAt: Timestamp, verification: Digest },
  OwnBank: { id: DestinationId, owner: OwnerId, providerReference: Label, verifiedAt: Timestamp, verification: Digest },
});
export type VerifiedWithdrawalDestination = typeof VerifiedWithdrawalDestination.Type;
export const ProviderBalance = Schema.TaggedUnion({
  Unavailable: { reason: Label, checkedAt: Timestamp },
  Reported: { dollars: Usd, provider: Schema.Literal("privy"), observedAt: Timestamp },
});
export type ProviderBalance = typeof ProviderBalance.Type;
export const Owner = Schema.Struct({
  id: OwnerId,
  identity: Schema.Struct({ provider: Schema.Literal("privy"), subject: Label }),
  wallets: Schema.Array(Wallet),
  withdrawalDestinations: Schema.Array(VerifiedWithdrawalDestination),
  balance: ProviderBalance,
}).check(
  Schema.makeFilter((owner) => owner.withdrawalDestinations.every((destination) => destination.owner === owner.id), {
    message: "Withdrawal destinations must belong to this owner",
  }),
  Schema.makeFilter(
    (owner) =>
      Array.dedupe(owner.withdrawalDestinations.map((destination) => destination.id)).length
        === owner.withdrawalDestinations.length,
    { message: "Withdrawal destination identifiers must be unique" },
  ),
  Schema.makeFilter(
    (owner) =>
      Array.dedupe(owner.wallets.map((wallet) => wallet.account)).length === owner.wallets.length
      && Array.dedupe(owner.wallets.map((wallet) => wallet.id)).length === owner.wallets.length,
    { message: "Owner wallets must have unique identifiers and accounts" },
  ),
);
export type Owner = typeof Owner.Type;

export const PolicyLimits = Schema.Struct({
  allowedPrograms: Schema.Array(AccountRef).check(Schema.isUnique()),
  allowedDestinations: Schema.Array(AccountRef).check(Schema.isUnique()),
  tradeCapDollars: PositiveUsd,
  // A missing stateful limit is absent, never a zero limit or an implied guard.
  dailyLossDollars: Schema.OptionFromNullOr(PositiveUsd),
  positionFraction: Schema.OptionFromNullOr(Fraction),
  approvalAboveDollars: Schema.OptionFromNullOr(PositiveUsd),
  launchAllowed: Schema.Boolean,
});
export type PolicyLimits = typeof PolicyLimits.Type;
const policyFields = { id: PolicyId, version: VersionId, owner: OwnerId, limits: PolicyLimits };
export const DraftPolicy = Schema.TaggedStruct("DraftPolicy", { ...policyFields, requestedAt: Timestamp });
export type DraftPolicy = typeof DraftPolicy.Type;
export const ConfirmedPolicy = Schema.TaggedStruct("ConfirmedPolicy", {
  ...policyFields,
  confirmation: Schema.Struct({
    ownerSignature: Digest,
    provider: Schema.Literal("privy"),
    providerPolicyIds: Schema.NonEmptyArray(Label).check(Schema.isUnique()),
    confirmedAt: Timestamp,
  }),
});
export type ConfirmedPolicy = typeof ConfirmedPolicy.Type;
export const Policy = Schema.Union([DraftPolicy, ConfirmedPolicy]);
export type Policy = typeof Policy.Type;

export const Budget = Schema.Struct({ limitDollars: Usd, spentDollars: Usd, periodStartedAt: Timestamp }).check(
  Schema.makeFilter((budget) => BigDecimal.isLessThanOrEqualTo(budget.spentDollars, budget.limitDollars), {
    message: "Spent budget cannot exceed its limit",
  }),
);
export type Budget = typeof Budget.Type;
export const Emblem = Schema.Struct({
  shape: Schema.Literals(["circle", "square", "triangle", "diamond", "hexagon"]),
  mark: Schema.OptionFromNullOr(Label),
});
export type Emblem = typeof Emblem.Type;
export const AgentState = Schema.Literals([
  "working",
  "researching",
  "talking",
  "trading",
  "launching",
  "building",
  "waitingForOwner",
  "asleep",
]);
export type AgentState = typeof AgentState.Type;
export const Position = Schema.Struct({ asset: AssetRef, dollars: Usd, observedAt: Timestamp });
export type Position = typeof Position.Type;
export const Agent = Schema.Struct({
  id: AgentId,
  owner: OwnerId,
  name: Label,
  emblem: Emblem,
  wallets: Schema.NonEmptyArray(Wallet),
  signer: SignerId,
  mandate: Mandate,
  policy: Policy,
  budget: Budget,
  desk: DeskId,
  state: AgentState,
}).check(
  Schema.makeFilter((agent) => agent.policy.owner === agent.owner, { message: "An agent uses its own owner's policy" }),
  Schema.makeFilter(
    (agent) =>
      Array.dedupe(agent.wallets.map((wallet) => wallet.account.slice(0, wallet.account.lastIndexOf(":")))).length
        === agent.wallets.length,
    { message: "An agent has one wallet per chain" },
  ),
  Schema.makeFilter((agent) => Array.dedupe(agent.wallets.map((wallet) => wallet.id)).length === agent.wallets.length, {
    message: "Agent wallet identifiers must be unique",
  }),
);
export type Agent = typeof Agent.Type;

export const Author = Schema.TaggedUnion({ Owner: { id: OwnerId }, Agent: { id: AgentId } });
export type Author = typeof Author.Type;
