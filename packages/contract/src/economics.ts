import { Option, Schema } from "effect";
import { ConfirmedPolicy, Fraction, PositiveUsd, VerifiedWithdrawalDestination } from "./agents.ts";
import {
  AgentId,
  AssetRef,
  BoardPostId,
  ChainRef,
  Checkpoint,
  CommonsId,
  Digest,
  IntentId,
  Label,
  OwnerId,
  PolicyId,
  ReceiptId,
  Timestamp,
  TransactionRef,
  VersionId,
} from "./identifiers.ts";

export const LaunchSpec = Schema.Struct({
  name: Label,
  symbol: Label,
  description: Schema.NonEmptyString,
  metadataDigest: Digest,
  initialBuyDollars: Schema.OptionFromNullOr(PositiveUsd),
});
export type LaunchSpec = typeof LaunchSpec.Type;
const intentFields = { id: IntentId, agent: AgentId, owner: OwnerId, chain: ChainRef, requestedAt: Timestamp };
export const SwapIntent = Schema.TaggedStruct("Swap", {
  ...intentFields,
  sell: AssetRef,
  buy: AssetRef,
  dollars: PositiveUsd,
  slippageCap: Fraction,
}).check(
  Schema.makeFilter(
    (intent) =>
      intent.sell !== intent.buy && intent.sell.startsWith(`${intent.chain}/`)
      && intent.buy.startsWith(`${intent.chain}/`),
    { message: "A swap exchanges distinct assets on its declared chain" },
  ),
);
export type SwapIntent = typeof SwapIntent.Type;
export const LaunchIntent = Schema.TaggedStruct("Launch", { ...intentFields, launchpad: Label, spec: LaunchSpec });
export type LaunchIntent = typeof LaunchIntent.Type;
export const WithdrawalIntent = Schema.TaggedStruct("Withdrawal", {
  ...intentFields,
  asset: AssetRef,
  dollars: PositiveUsd,
  destination: VerifiedWithdrawalDestination,
}).check(
  Schema.makeFilter(
    (intent) =>
      intent.owner === intent.destination.owner && intent.asset.startsWith(`${intent.chain}/`)
      && (intent.destination._tag === "OwnBank" || intent.destination.account.startsWith(`${intent.chain}:`)),
    { message: "A withdrawal uses its chain and a verified destination belonging to its owner" },
  ),
);
export type WithdrawalIntent = typeof WithdrawalIntent.Type;
export const ActionIntent = Schema.Union([SwapIntent, LaunchIntent, WithdrawalIntent]);
export type ActionIntent = typeof ActionIntent.Type;

export const ReceiptCause = Schema.TaggedUnion({
  Note: { item: CommonsId, version: VersionId },
  Thesis: { item: CommonsId, version: VersionId },
  BoardPost: { post: BoardPostId },
  OwnerRequest: { owner: OwnerId, request: Digest },
});
export type ReceiptCause = typeof ReceiptCause.Type;
export const PolicyDecision = Schema.TaggedUnion({
  Allowed: { policy: ConfirmedPolicy },
  Denied: { policy: ConfirmedPolicy, reasons: Schema.NonEmptyArray(Label) },
  Unconfirmed: { policy: PolicyId },
});
export type PolicyDecision = typeof PolicyDecision.Type;
export const Refusal = Schema.Struct({
  code: Schema.Literals([
    "policyDenied",
    "policyUnconfirmed",
    "simulationFailed",
    "unsupportedAction",
    "invalidDestination",
    "unavailable",
  ]),
  detail: Label,
});
export type Refusal = typeof Refusal.Type;
const receiptFields = {
  id: ReceiptId,
  action: ActionIntent,
  causes: Schema.NonEmptyArray(ReceiptCause),
  recordedAt: Timestamp,
};
// Outcome variants require evidence together: a settled transaction cannot lose
// its checkpoint, and uncertainty cannot accidentally acquire a settled status.
export const Receipt = Schema.TaggedUnion({
  SettledReceipt: {
    ...receiptFields,
    policy: ConfirmedPolicy,
    transaction: TransactionRef,
    checkpoint: Checkpoint,
    result: Schema.Literals(["succeeded", "failed"]),
  },
  RefusedReceipt: { ...receiptFields, policy: PolicyDecision, refusal: Refusal },
  UnknownReceipt: {
    ...receiptFields,
    policy: ConfirmedPolicy,
    submission: Digest,
    transaction: Schema.OptionFromNullOr(TransactionRef),
    lastCheckedAt: Schema.OptionFromNullOr(Timestamp),
    reason: Label,
  },
}).check(
  Schema.makeFilter(
    (receipt) => !receipt.causes.some((cause) => cause._tag === "OwnerRequest" && cause.owner !== receipt.action.owner),
    { message: "An owner request must come from the action's owner" },
  ),
  Schema.makeFilter((receipt) => {
    if (receipt._tag !== "RefusedReceipt") return receipt.policy.owner === receipt.action.owner;
    return receipt.policy._tag === "Unconfirmed" || receipt.policy.policy.owner === receipt.action.owner;
  }, { message: "Policy and action owners must match" }),
  Schema.makeFilter((receipt) => {
    if (receipt._tag !== "RefusedReceipt") return true;
    if (receipt.policy._tag === "Unconfirmed") return receipt.refusal.code === "policyUnconfirmed";
    if (receipt.policy._tag === "Denied") return receipt.refusal.code === "policyDenied";
    return receipt.refusal.code !== "policyDenied" && receipt.refusal.code !== "policyUnconfirmed";
  }, { message: "A refusal must retain its policy outcome" }),
  Schema.makeFilter((receipt) => {
    if (receipt._tag === "RefusedReceipt") return true;
    if (receipt._tag === "SettledReceipt") {
      return receipt.transaction.chain === receipt.action.chain && receipt.checkpoint.chain === receipt.action.chain;
    }
    return Option.isNone(receipt.transaction) || receipt.transaction.value.chain === receipt.action.chain;
  }, { message: "Transaction, checkpoint and action chains must match" }),
);
export type Receipt = typeof Receipt.Type;
