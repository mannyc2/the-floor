import { WorldSnapshot } from "@floor/api/world";
import { ConfirmedPolicy, PositiveUsd, PrivyPolicyId } from "@floor/contract/agents";
import { PolicyDecision, Receipt, ReceiptCause, SwapIntent } from "@floor/contract/economics";
import {
  AgentId,
  AssetRef,
  ChainRef,
  Checkpoint,
  Digest,
  Height,
  IntentId,
  OwnerId,
  PolicyId,
  ReceiptId,
  TransactionRef,
  VersionId,
  WorldId,
} from "@floor/contract/identifiers";
import { createWorld } from "@floor/world";
import { BigDecimal, DateTime, Option, Result } from "effect";

export const world = WorldId.make("synthetic-world");
export const chain = ChainRef.make("solana:synthetic-fork");
export const agent = AgentId.make("synthetic-agent");
export const checkpoint = Checkpoint.make({
  chain,
  height: Height.make("123"),
  hash: Digest.make("synthetic-block"),
  time: DateTime.makeUnsafe("2026-10-15T12:00:00.000Z"),
});
export const join = { world, agent, checkpoint };
export const emptySnapshot = WorldSnapshot.make({
  model: Result.getOrThrow(createWorld(world, chain)),
  chain,
  sequence: 0,
  checkpoint: Option.none(),
  agents: [],
});
export const receipt = Receipt.cases.RefusedReceipt.make({
  id: ReceiptId.make("synthetic-receipt"),
  action: SwapIntent.make({
    id: IntentId.make("synthetic-intent"),
    agent,
    owner: OwnerId.make("synthetic-owner"),
    chain,
    requestedAt: checkpoint.time,
    sell: AssetRef.make(`${chain}/token:one`),
    buy: AssetRef.make(`${chain}/token:two`),
    dollars: PositiveUsd.make(BigDecimal.make(1n, 0)),
    slippageCap: 0.01,
  }),
  causes: [
    ReceiptCause.cases.OwnerRequest.make({
      owner: OwnerId.make("synthetic-owner"),
      request: Digest.make("synthetic-request"),
    }),
  ],
  recordedAt: checkpoint.time,
  policy: PolicyDecision.cases.Unconfirmed.make({ policy: PolicyId.make("synthetic-policy") }),
  refusal: { code: "policyUnconfirmed", detail: "Synthetic world-delivery fixture; no transaction was executed" },
});

// These policy and transaction records are schema fixtures, not provider or chain observations.
const providerPolicyId = PrivyPolicyId.make("synthetic-not-confirmed");
const policy = ConfirmedPolicy.make({
  id: PolicyId.make("synthetic-policy"),
  version: VersionId.make(1),
  owner: receipt.action.owner,
  limits: {
    allowedPrograms: { value: [], providerPolicyId },
    allowedDestinations: { value: [], providerPolicyId },
    tradeCapDollars: { value: PositiveUsd.make(BigDecimal.make(1n, 0)), providerPolicyId },
    dailyLossDollars: Option.none(),
    positionFraction: Option.none(),
    approvalAboveDollars: Option.none(),
    launchAllowed: { value: false, providerPolicyId },
  },
  confirmation: {
    ownerSignature: Digest.make("synthetic-not-confirmed"),
    provider: "privy",
    confirmedAt: checkpoint.time,
  },
});
export const unknownReceipt = Receipt.cases.UnknownReceipt.make({
  id: ReceiptId.make("synthetic-uncertain-receipt"),
  action: receipt.action,
  causes: receipt.causes,
  recordedAt: checkpoint.time,
  policy,
  submission: Digest.make("synthetic-submission"),
  transaction: Option.some(TransactionRef.make({ chain, hash: Digest.make("synthetic-transaction") })),
  lastCheckedAt: Option.some(checkpoint.time),
  reason: "Synthetic uncertain receipt fixture; no transaction was executed",
});
export const settledReceipt = Receipt.cases.SettledReceipt.make({
  id: unknownReceipt.id,
  action: receipt.action,
  causes: receipt.causes,
  recordedAt: checkpoint.time,
  policy,
  checkpoint,
  transaction: Option.getOrThrow(unknownReceipt.transaction),
  result: "succeeded",
});
