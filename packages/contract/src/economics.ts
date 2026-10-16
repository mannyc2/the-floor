import { Option, Schema } from "effect";
import { ConfirmedPolicy, Fraction, PositiveUsd, VerifiedWithdrawalDestination } from "./agents.ts";
import {
  AgentId,
  AssetRef,
  BoardPostId,
  ChainRef,
  Checkpoint,
  CommonsId,
  DestinationId,
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
  destination: DestinationId,
}).check(
  Schema.makeFilter((intent) => intent.asset.startsWith(`${intent.chain}/`), {
    message: "A withdrawal asset belongs to its declared chain",
  }),
);
export type WithdrawalIntent = typeof WithdrawalIntent.Type;
// Only the signer resolves this ID from its verified owner-destination registry.
// The agent supplies no account, bank details or self-asserted verification.
export const ResolvedWithdrawal = Schema.Struct({
  intent: WithdrawalIntent,
  destination: VerifiedWithdrawalDestination,
}).check(
  Schema.makeFilter((resolved) => resolved.intent.destination === resolved.destination.id, {
    message: "The resolved destination must match the requested identifier",
  }),
  Schema.makeFilter((resolved) => resolved.intent.owner === resolved.destination.owner, {
    message: "A resolved withdrawal destination belongs to the action's owner",
  }),
  Schema.makeFilter(
    (resolved) =>
      resolved.destination._tag === "OwnBank" || resolved.destination.account.startsWith(`${resolved.intent.chain}:`),
    { message: "A resolved account destination belongs to the withdrawal chain" },
  ),
);
export type ResolvedWithdrawal = typeof ResolvedWithdrawal.Type;
export const ActionIntent = Schema.Union([SwapIntent, LaunchIntent, WithdrawalIntent]);
export type ActionIntent = typeof ActionIntent.Type;

export const ReceiptCause = Schema.TaggedUnion({
  AgentIntent: { agent: AgentId, intent: IntentId },
  Note: { item: CommonsId, version: VersionId },
  Thesis: { item: CommonsId, version: VersionId },
  BoardPost: { post: BoardPostId },
  OwnerRequest: { owner: OwnerId, request: Digest },
});
export type ReceiptCause = typeof ReceiptCause.Type;
// Fork receipts carry their actual authority; they never assert a Privy policy was installed.
export const ForkPolicy = Schema.TaggedStruct("ForkPolicy", { owner: OwnerId, genesisHash: Digest });
export type ForkPolicy = typeof ForkPolicy.Type;
export const ExecutionPolicy = Schema.Union([ConfirmedPolicy, ForkPolicy]);
export type ExecutionPolicy = typeof ExecutionPolicy.Type;
export const PolicyDecision = Schema.TaggedUnion({
  Allowed: { policy: ExecutionPolicy },
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
    policy: ExecutionPolicy,
    transaction: TransactionRef,
    checkpoint: Checkpoint,
    result: Schema.Literals(["succeeded", "failed"]),
  },
  RefusedReceipt: { ...receiptFields, policy: PolicyDecision, refusal: Refusal },
  UnknownReceipt: {
    ...receiptFields,
    policy: ExecutionPolicy,
    submission: Digest,
    transaction: Schema.OptionFromNullOr(TransactionRef),
    lastCheckedAt: Schema.OptionFromNullOr(Timestamp),
    reason: Label,
  },
}).check(
  Schema.makeFilter(
    receipt =>
      receipt.causes.every(cause =>
        cause._tag !== "AgentIntent" || (cause.agent === receipt.action.agent && cause.intent === receipt.action.id)
      ),
    { message: "An agent intent cause must name the receipt action and agent" },
  ),
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
  Schema.makeFilter(receipt => {
    const policy = receipt._tag === "RefusedReceipt"
      ? receipt.policy._tag === "Unconfirmed" ? Option.none() : Option.some(receipt.policy.policy)
      : Option.some(receipt.policy);
    return Option.isNone(policy) || policy.value._tag !== "ForkPolicy"
      || receipt.action.chain === `solana:${policy.value.genesisHash.slice(0, 32)}`;
  }, { message: "A fork receipt must belong to its declared local genesis" }),
  Schema.makeFilter((receipt) => {
    if (receipt._tag === "RefusedReceipt") return true;
    if (receipt._tag === "SettledReceipt") {
      return receipt.transaction.chain === receipt.action.chain && receipt.checkpoint.chain === receipt.action.chain;
    }
    return Option.isNone(receipt.transaction) || receipt.transaction.value.chain === receipt.action.chain;
  }, { message: "Transaction, checkpoint and action chains must match" }),
);
export type Receipt = typeof Receipt.Type;
