import { Address, ExactAmount, Hex, NonNegative, Proposal, TransactionHash } from "@floor/contract";
import { Schema } from "effect";

const WholeAmount = Schema.String.check(Schema.isPattern(/^(0|[1-9][0-9]*)$/));
const Selector = Hex.check(Schema.isPattern(/^0x[0-9a-fA-F]{8}$/));
const BlockNumber = Schema.Int.check(Schema.isGreaterThan(0));
export const AccountBinding = Schema.Struct({
  ownerId: Schema.NonEmptyString,
  ownerAddress: Address,
  agentId: Schema.NonEmptyString,
  policyHash: TransactionHash,
});
export type AccountBinding = typeof AccountBinding.Type;

const SessionPermission = Schema.Struct({
  contract: Address,
  method: Schema.NonEmptyString,
  selector: Selector,
  asset: Address,
  recipient: Address,
  maximumAmount: WholeAmount,
  maximumNativeValue: WholeAmount,
});
export const ScopedAccount = Schema.Struct({
  binding: AccountBinding,
  account: Address,
  chainId: Schema.Literal(84532),
  permissionId: TransactionHash,
  expiresAt: Schema.DateTimeUtcFromString,
  observedAt: Schema.DateTimeUtcFromString,
  blockNumber: BlockNumber,
  ownerVerified: Schema.Literal(true),
  moduleEnforced: Schema.Literal(true),
  permissions: Schema.NonEmptyArray(SessionPermission),
});
export type ScopedAccount = typeof ScopedAccount.Type;
export const AccountReadResponse = Schema.Union([
  Schema.Struct({ status: Schema.Literal("unlinked"), reason: Schema.NonEmptyString }),
  Schema.Struct({ status: Schema.Literal("verified"), account: ScopedAccount }),
]);

export const QuoteRequest = Schema.Struct({ binding: AccountBinding, proposal: Proposal });
export const AccountQuote = Schema.Struct({
  binding: AccountBinding,
  account: Address,
  chainId: Schema.Literal(84532),
  proposalFingerprint: Schema.String,
  observedAt: Schema.DateTimeUtcFromString,
  expiresAt: Schema.DateTimeUtcFromString,
  blockNumber: BlockNumber,
  walletUsd: NonNegative,
  resultingPositionUsd: NonNegative,
  dailyLossUsd: NonNegative,
  valueUsd: NonNegative,
  agentLaunchesToday: Schema.Natural,
  ownerLaunchesThisWeek: Schema.Natural,
  allocationLockedUntil: Schema.OptionFromNullOr(Schema.DateTimeUtcFromString),
});
export type AccountQuote = typeof AccountQuote.Type;

export const PrepareRequest = Schema.Struct({
  binding: AccountBinding,
  account: Address,
  permissionId: TransactionHash,
  receiptId: Schema.NonEmptyString,
  proposal: Proposal,
  proposalFingerprint: Schema.String,
  approvalExpiresAt: Schema.DateTimeUtcFromString,
});
export type PrepareRequest = typeof PrepareRequest.Type;
export const PreparedExecution = Schema.Struct({
  planId: Schema.NonEmptyString,
  binding: AccountBinding,
  account: Address,
  chainId: Schema.Literal(84532),
  permissionId: TransactionHash,
  receiptId: Schema.NonEmptyString,
  proposalFingerprint: Schema.String,
  target: Address,
  method: Schema.NonEmptyString,
  selector: Selector,
  calldata: Hex,
  nativeValue: WholeAmount,
  asset: Address,
  assetAmount: WholeAmount,
  recipient: Address,
  amount: ExactAmount,
  symbol: Schema.String,
  valueUsd: NonNegative,
  slippageBps: NonNegative,
  simulated: Schema.Literal(true),
  simulatedAtBlock: BlockNumber,
  expiresAt: Schema.DateTimeUtcFromString,
});
export type PreparedExecution = typeof PreparedExecution.Type;

export const DispatchRequest = Schema.Struct({
  planId: Schema.NonEmptyString,
  receiptId: Schema.NonEmptyString,
  proposalFingerprint: Schema.String,
  permissionId: TransactionHash,
});
export type DispatchRequest = typeof DispatchRequest.Type;
const DispatchIdentity = {
  receiptId: Schema.NonEmptyString,
  proposalFingerprint: Schema.String,
  account: Address,
  chainId: Schema.Literal(84532),
};
export const DispatchResponse = Schema.Union([
  Schema.Struct({
    ...DispatchIdentity,
    status: Schema.Literal("rejected"),
    accepted: Schema.Literal(false),
    reason: Schema.NonEmptyString,
  }),
  Schema.Struct({ ...DispatchIdentity, status: Schema.Literal("submitted"), transactionHash: TransactionHash }),
  Schema.Struct({
    ...DispatchIdentity,
    status: Schema.Literal("confirmed"),
    transactionHash: TransactionHash,
    blockNumber: BlockNumber,
  }),
]);
export type DispatchResponse = typeof DispatchResponse.Type;
