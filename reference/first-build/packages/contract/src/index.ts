import { Option, Schema, Struct } from "effect";

export const NonNegative = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0));
export const Hex = Schema.TemplateLiteral(["0x", Schema.String]).check(Schema.isPattern(/^0x[0-9a-fA-F]*$/));
export type Hex = typeof Hex.Type;
export const Address = Schema.TemplateLiteral(["0x", Schema.String]).check(Schema.isPattern(/^0x[0-9a-fA-F]{40}$/));
export const TransactionHash = Schema.TemplateLiteral(["0x", Schema.String]).check(
  Schema.isPattern(/^0x[0-9a-fA-F]{64}$/),
);
export const ExactAmount = Schema.String.check(Schema.isPattern(/^(0|[1-9][0-9]*)(\.[0-9]+)?$/));
export const MarketKind = Schema.Literals([
  "constant-product",
  "concentrated-liquidity",
  "bonding-curve",
  "lending",
  "perpetual",
  "prediction",
  "bridge",
  "vault",
]);
export type MarketKind = typeof MarketKind.Type;
export const Tier = Schema.Literals(["stall", "works", "tower"]);
export type Tier = typeof Tier.Type;
export const Emblem = Schema.Struct({
  shape: Schema.Literals(["circle", "triangle", "square", "diamond", "hexagon", "cross", "crescent", "star"]),
  modifier: Schema.NullOr(Schema.Literals(["bar", "dot", "ring"])),
});
export type Emblem = typeof Emblem.Type;
export const Policy = Schema.Struct({
  allowedChainIds: Schema.Array(Schema.Int),
  allowedProtocols: Schema.Array(Schema.String),
  allowedContracts: Schema.Array(Address),
  allowedMethods: Schema.Array(Schema.String),
  maxTradeUsd: NonNegative,
  maxPositionPercent: NonNegative.check(Schema.isLessThanOrEqualTo(100)),
  dailyLossLimitUsd: NonNegative,
  maxSlippageBps: NonNegative.check(Schema.isLessThanOrEqualTo(10000)),
  approvalThresholdUsd: NonNegative,
  approvalTtlSeconds: NonNegative,
  launchAllowed: Schema.Boolean,
  launchBudgetUsd: NonNegative,
  maxLaunchesPerAgentDay: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  maxLaunchesPerOwnerWeek: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  coolingOffSeconds: Schema.Int.check(Schema.isGreaterThanOrEqualTo(604800)),
  confirmedAt: Schema.NullOr(Schema.String),
  version: Schema.Int,
});
export type Policy = typeof Policy.Type;
export const defaultPolicy: Policy = {
  allowedChainIds: [84532],
  allowedProtocols: [],
  allowedContracts: [],
  allowedMethods: [],
  maxTradeUsd: 100,
  maxPositionPercent: 5,
  dailyLossLimitUsd: 25,
  maxSlippageBps: 100,
  approvalThresholdUsd: 50,
  approvalTtlSeconds: 900,
  launchAllowed: false,
  launchBudgetUsd: 0,
  maxLaunchesPerAgentDay: 1,
  maxLaunchesPerOwnerWeek: 3,
  coolingOffSeconds: 604800,
  confirmedAt: null,
  version: 1,
};
export const Agent = Schema.Struct({
  id: Schema.NonEmptyString,
  owner: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  emblem: Emblem,
  walletAddress: Schema.NullOr(Address),
  mandate: Schema.String,
  policy: Policy,
  visibility: Schema.Literals(["public", "private"]),
  publishMandate: Schema.Boolean,
  paused: Schema.Boolean,
  state: Schema.Literals(["researching", "inspecting", "deciding", "waiting", "trading", "asleep", "launching"]),
  budget: Schema.Struct({ dailyUsd: NonNegative, spentUsd: NonNegative, day: Schema.String }),
  districtId: Schema.String,
  createdAt: Schema.String,
});
export type Agent = typeof Agent.Type;
// Public identities are constructed by allowlist, so adding a private Agent field cannot expose it by default.
export const PublicAgent = Agent.mapFields(Struct.pick(["id", "name", "emblem", "state", "districtId", "createdAt"]))
  .pipe(
    Schema.fieldsAssign({ publishedMandate: Schema.Option(Schema.String) }),
  );
export type PublicAgent = typeof PublicAgent.Type;
export const publicAgent = (agent: Agent): PublicAgent => ({
  ...Struct.pick(agent, ["id", "name", "emblem", "state", "districtId", "createdAt"]),
  publishedMandate: agent.publishMandate ? Option.some(agent.mandate) : Option.none(),
});
export const Source = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literals(["chain", "web", "note"]),
  label: Schema.String,
  url: Schema.String,
  blockNumber: Schema.NullOr(Schema.Int),
});
export type Source = typeof Source.Type;
export const PositionDisclosure = Schema.Union([
  Schema.Struct({ disclosure: Schema.Literal("undisclosed") }),
  Schema.Struct({
    disclosure: Schema.Literal("disclosed"),
    amount: ExactAmount,
    symbol: Schema.String,
    supplyPercent: Schema.NullOr(NonNegative),
  }),
]);
export type PositionDisclosure = typeof PositionDisclosure.Type;
export const PositionEvidence = Schema.Struct({
  account: Address,
  chainId: Schema.Int,
  tokenAddress: Address,
  balanceBaseUnits: Schema.String.check(Schema.isPattern(/^\d+$/)),
  supplyBaseUnits: Schema.String.check(Schema.isPattern(/^\d+$/)),
  decimals: Schema.Natural,
  symbol: Schema.String,
  blockNumber: Schema.Natural,
  blockHash: TransactionHash,
  observedAt: Schema.String,
  sourceUrl: Schema.String,
});
export type PositionEvidence = typeof PositionEvidence.Type;
export const ChainAssertion = Schema.Struct({
  field: Schema.Literals(["price", "reserve0", "reserve1", "supply", "progress", "tick", "graduationThreshold"]),
  kind: Schema.Literals(["minimum", "maximum", "equals"]),
  expected: Schema.Finite,
  blockNumber: Schema.Natural,
});
export type ChainAssertion = typeof ChainAssertion.Type;
export const AssertionEvidence = Schema.Struct({
  sourceId: Schema.String,
  chainId: Schema.Int,
  blockNumber: Schema.Natural,
  blockHash: TransactionHash,
  source: Schema.Literals(["chain", "recording"]),
  actual: Schema.Finite,
});
export type AssertionEvidence = typeof AssertionEvidence.Type;
export const Note = Schema.Struct({
  id: Schema.String,
  agentId: Schema.String,
  marketId: Schema.String,
  claim: Schema.String,
  sources: Schema.Array(Source),
  position: PositionDisclosure,
  positionEvidence: Schema.NullOr(PositionEvidence),
  publicationReason: Schema.NullOr(Schema.String),
  assertion: Schema.NullOr(ChainAssertion),
  assertionEvidence: Schema.NullOr(AssertionEvidence),
  status: Schema.Literals(["pending", "verified", "contradicted", "sourced"]),
  visibility: Schema.Literals(["public", "private"]),
  createdAt: Schema.String,
  blockNumber: Schema.NullOr(Schema.Int),
  verification: Schema.NullOr(Schema.String),
  launchAllocation: Schema.NullOr(ExactAmount),
});
export type Note = typeof Note.Type;
export const Thesis = Schema.Struct({
  id: Schema.String,
  agentId: Schema.String,
  marketId: Schema.String,
  belief: Schema.String,
  invalidation: Schema.String,
  noteIds: Schema.Array(Schema.String),
  createdAt: Schema.String,
});
export type Thesis = typeof Thesis.Type;
export const PolicyCheck = Schema.Struct({
  rule: Schema.String,
  passed: Schema.Boolean,
  actual: Schema.String,
  limit: Schema.String,
});
export type PolicyCheck = typeof PolicyCheck.Type;
export const BaseUnitAmount = Schema.String.check(Schema.isPattern(/^(0|[1-9][0-9]*)$/));
export const TokenAmount = ExactAmount.check(Schema.isPattern(/^(0|[1-9][0-9]*)(\.[0-9]{1,18})?$/));
export const FoundryLaunchSpec = Schema.Struct({
  launchId: TransactionHash,
  name: Schema.NonEmptyString.check(Schema.isMaxLength(64)),
  symbol: Schema.NonEmptyString.check(Schema.isPattern(/^[A-Za-z][A-Za-z0-9]{1,11}$/)),
  supply: TokenAmount,
  allocation: TokenAmount,
  graduationThresholdWei: BaseUnitAmount,
  virtualLiquidityWei: BaseUnitAmount,
  launchFeeWei: BaseUnitAmount,
  thesisHash: TransactionHash,
});
export type FoundryLaunchSpec = typeof FoundryLaunchSpec.Type;
const proposalFields = {
  id: Schema.NonEmptyString,
  agentId: Schema.String,
  owner: Schema.String,
  chainId: Schema.Int,
  protocol: Schema.String,
  contract: Address,
  method: Schema.String,
  recipient: Address,
  marketId: Schema.String,
  amount: ExactAmount,
  symbol: Schema.String,
  valueUsd: NonNegative,
  slippageBps: NonNegative,
  thesisId: Schema.String,
  sourceIds: Schema.Array(Schema.String),
  createdAt: Schema.String,
};
export const Proposal = Schema.Union([
  Schema.Struct({ ...proposalFields, action: Schema.Literal("trade"), launch: Schema.optionalKey(Schema.Never) }),
  Schema.Struct({ ...proposalFields, action: Schema.Literal("withdraw"), launch: Schema.optionalKey(Schema.Never) }),
  Schema.Struct({ ...proposalFields, action: Schema.Literal("launch"), launch: FoundryLaunchSpec }),
]);
export type Proposal = typeof Proposal.Type;
const receiptFields = {
  id: Schema.String,
  proposalId: Schema.String,
  proposalFingerprint: Schema.String,
  agentId: Schema.String,
  owner: Schema.String,
  marketId: Schema.String,
  chainId: Schema.Int.check(Schema.isGreaterThan(0)),
  action: Schema.Literals(["trade", "launch", "withdraw", "refusal"]),
  amount: ExactAmount,
  symbol: Schema.String,
  valueUsd: NonNegative,
  thesisId: Schema.String,
  sourceIds: Schema.Array(Schema.String),
  policyVersion: Schema.Int,
  checks: Schema.Array(PolicyCheck),
  reason: Schema.String,
  createdAt: Schema.String,
  updatedAt: Schema.String,
  expiresAt: Schema.NullOr(Schema.String),
};
// A durable receipt's phase determines what evidence exists; a confirmation cannot be represented without a chain hash and block.
export const Receipt = Schema.Union([
  Schema.Struct({
    ...receiptFields,
    status: Schema.Literals([
      "refused",
      "pending-review",
      "awaiting-approval",
      "approved",
      "executing",
      "uncertain",
      "expired",
      "declined",
      "failed",
    ]),
    transactionHash: Schema.Null,
    blockNumber: Schema.Null,
  }),
  Schema.Struct({
    ...receiptFields,
    status: Schema.Literal("submitted"),
    transactionHash: TransactionHash,
    blockNumber: Schema.Null,
  }),
  Schema.Struct({
    ...receiptFields,
    status: Schema.Literal("confirmed"),
    transactionHash: TransactionHash,
    blockNumber: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  }),
]);
export type Receipt = typeof Receipt.Type;
export const PublicPolicyCheck = PolicyCheck.mapFields(Struct.pick(["rule", "passed"]));
const publicReceiptKeys = [
  "id",
  "proposalId",
  "agentId",
  "marketId",
  "chainId",
  "action",
  "amount",
  "symbol",
  "valueUsd",
  "thesisId",
  "sourceIds",
  "policyVersion",
  "reason",
  "createdAt",
  "updatedAt",
  "expiresAt",
] as const;
const publicReceiptBranch = <Fields extends typeof Receipt.members[number]["fields"]>(schema: Schema.Struct<Fields>) =>
  schema.mapFields((fields) => ({
    ...Struct.pick(fields, [...publicReceiptKeys, "status", "transactionHash", "blockNumber"]),
    checks: Schema.Array(PublicPolicyCheck),
  }));
// Derive each proof-bearing branch so privacy filtering cannot weaken the confirmation invariant.
export const PublicReceipt = Receipt.mapMembers(([unsent, submitted, confirmed]) => [
  publicReceiptBranch(unsent),
  publicReceiptBranch(submitted),
  publicReceiptBranch(confirmed),
]);
export type PublicReceipt = typeof PublicReceipt.Type;
export const publicReceipt = (receipt: Receipt): PublicReceipt => {
  const fields = {
    ...Struct.pick(receipt, publicReceiptKeys),
    checks: receipt.checks.map((check) => Struct.pick(check, ["rule", "passed"])),
  };
  if (receipt.status === "confirmed") {
    return {
      ...fields,
      status: receipt.status,
      transactionHash: receipt.transactionHash,
      blockNumber: receipt.blockNumber,
    };
  }
  if (receipt.status === "submitted") {
    return {
      ...fields,
      status: receipt.status,
      transactionHash: receipt.transactionHash,
      blockNumber: receipt.blockNumber,
    };
  }
  return {
    ...fields,
    status: receipt.status,
    transactionHash: receipt.transactionHash,
    blockNumber: receipt.blockNumber,
  };
};
export const Reading = Schema.Struct({
  marketId: Schema.String,
  kind: MarketKind,
  chainId: Schema.Int,
  blockNumber: Schema.Int,
  blockHash: Schema.String,
  blockTimestamp: Schema.Int,
  source: Schema.Literals(["chain", "recording", "synthetic"]),
  values: Schema.Record(Schema.String, Schema.Union([Schema.Finite, Schema.String, Schema.Array(Schema.Finite)])),
});
export type Reading = typeof Reading.Type;
export const ReadingContract = Schema.Struct({ kind: MarketKind, required: Schema.Array(Schema.String) });
export const readingContracts: Readonly<Record<MarketKind, readonly string[]>> = {
  "constant-product": ["reserve0", "reserve1", "price", "trades", "history"],
  "concentrated-liquidity": ["liquidityBands", "price", "trades", "history"],
  "bonding-curve": ["progress", "price", "trades", "history"],
  lending: ["deposits", "borrows", "utilization", "liquidations", "history"],
  perpetual: ["longOpenInterest", "shortOpenInterest", "funding", "history"],
  prediction: ["odds", "history"],
  bridge: ["valueCrossing", "queueLength"],
  vault: ["holdings", "movements"],
};
export type DriverExpression =
  | { readonly op: "constant"; readonly value: number }
  | { readonly op: "reading"; readonly name: string }
  | { readonly op: "time" }
  | {
    readonly op: "clamp" | "min" | "max" | "sin" | "ease" | "step" | "add" | "multiply";
    readonly args: readonly DriverExpression[];
  };
export const DriverExpression: Schema.Codec<DriverExpression> = Schema.suspend(() =>
  Schema.Union([
    Schema.Struct({ op: Schema.Literal("constant"), value: Schema.Finite }),
    Schema.Struct({ op: Schema.Literal("reading"), name: Schema.String }),
    Schema.Struct({ op: Schema.Literal("time") }),
    Schema.Struct({
      op: Schema.Literals(["clamp", "min", "max", "sin", "ease", "step", "add", "multiply"]),
      args: Schema.Array(DriverExpression),
    }),
  ])
);
export const DesignPart = Schema.Struct({
  id: Schema.String,
  kit: Schema.String,
  material: Schema.String,
  position: Schema.Tuple([Schema.Finite, Schema.Finite, Schema.Finite]),
  size: Schema.Tuple([NonNegative, NonNegative, NonNegative]),
  image: Schema.NullOr(Schema.String),
});
export const Design = Schema.Struct({
  id: Schema.String,
  tokenId: Schema.String,
  name: Schema.String,
  kind: MarketKind,
  tier: Tier,
  parts: Schema.Array(DesignPart),
  readings: Schema.Array(Schema.Struct({ reading: Schema.String, instrument: Schema.String, partId: Schema.String })),
  drivers: Schema.Array(
    Schema.Struct({ partId: Schema.String, property: Schema.String, expression: DriverExpression }),
  ),
  behaviours: Schema.Array(
    Schema.Struct({
      event: Schema.Literals(["whale-buy", "new-high", "graduation"]),
      partId: Schema.String,
      action: Schema.Literals(["splash", "ring", "raise"]),
    }),
  ),
  texturePixels: NonNegative,
  bounds: Schema.Struct({ width: NonNegative, depth: NonNegative, height: NonNegative }),
});
export type Design = typeof Design.Type;
export const DesignElection = Schema.Struct({
  id: Schema.NonEmptyString,
  designId: Schema.NonEmptyString,
  marketId: Schema.NonEmptyString,
  token: Address,
  symbol: Schema.String,
  proposer: Address,
  blockNumber: Schema.Int,
  blockHash: TransactionHash,
  supplyRaw: BaseUnitAmount,
  quorumRaw: BaseUnitAmount,
  supportRaw: BaseUnitAmount,
  opposeRaw: BaseUnitAmount,
  createdAt: Schema.String,
  closesAt: Schema.String,
  finalizedAt: Schema.NullOr(Schema.String),
  status: Schema.Literals(["open", "adopted", "rejected"]),
});
export type DesignElection = typeof DesignElection.Type;
export const AdoptedDesign = Schema.Struct({
  electionId: Schema.String,
  marketId: Schema.String,
  design: Design,
  adoptedAt: Schema.String,
});
export type AdoptedDesign = typeof AdoptedDesign.Type;
export const FloorEvent = Schema.Struct({
  id: Schema.String,
  type: Schema.String,
  blockNumber: Schema.NullOr(Schema.Int),
  createdAt: Schema.String,
  actor: Schema.String,
  entityId: Schema.String,
  payload: Schema.Record(Schema.String, Schema.Unknown),
});
export type FloorEvent = typeof FloorEvent.Type;
export const Plate = Schema.Struct({
  number: Schema.Int,
  title: Schema.String,
  createdAt: Schema.String,
  blockNumber: Schema.Int,
  marketId: Schema.String,
  receiptIds: Schema.Array(Schema.String),
  view: Schema.String,
});
export type Plate = typeof Plate.Type;
export const ScribedLine = Schema.Struct({
  id: Schema.String,
  owner: Schema.String,
  marketId: Schema.String,
  price: NonNegative,
  crossed: Schema.Boolean,
  direction: Schema.Literals(["above", "below"]),
  createdAt: Schema.String,
});
export type ScribedLine = typeof ScribedLine.Type;
export const Thread = Schema.Struct({
  id: Schema.String,
  agentId: Schema.String,
  question: Schema.String,
  marketIds: Schema.Array(Schema.String),
  finding: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
});
export type Thread = typeof Thread.Type;
export const Brief = Schema.Struct({
  id: Schema.String,
  agentId: Schema.String,
  date: Schema.String,
  text: Schema.String,
  receiptIds: Schema.Array(Schema.String),
  noteIds: Schema.Array(Schema.String),
  visibility: Schema.Literals(["public", "private"]),
});
export type Brief = typeof Brief.Type;
export const Chain = Schema.Struct({
  id: Schema.Int,
  name: Schema.String,
  blockTime: NonNegative,
  tradition: Schema.String,
});
export const District = Schema.Struct({
  id: Schema.String,
  chainId: Schema.Int,
  name: Schema.String,
  kind: Schema.Literals(["narrative", "protocol"]),
  anchor: Schema.Tuple([Schema.Finite, Schema.Finite]),
  footprint: NonNegative,
});
export const Token = Schema.Struct({
  address: Address,
  chainId: Schema.Int,
  districtId: Schema.String,
  name: Schema.String,
  symbol: Schema.String,
  tier: Tier,
  logo: Schema.NullOr(Schema.String),
  launcher: Schema.NullOr(Schema.String),
});
export const Market = Schema.Struct({
  id: Schema.String,
  tokenId: Schema.String,
  kind: MarketKind,
  venue: Schema.String,
  designId: Schema.String,
});
export const Setting = Schema.Struct({
  key: Schema.String,
  scope: Schema.Literals(["floor", "chain", "district", "token", "agent"]),
  scopeId: Schema.String,
  value: Schema.Union([Schema.String, Schema.Finite, Schema.Boolean]),
  changedByEvent: Schema.NullOr(Schema.String),
});
export type Setting = typeof Setting.Type;
export const defaults = {
  theme: "day",
  visibility: "public",
  publishMandate: false,
  sound: false,
  seaState: true,
  seaTide: false,
  maxUpdatesPerSecond: 4,
  worksLiquidityUsd: 50000,
  worksTradesPerDay: 100,
  towerPercentile: 0.98,
  tierHysteresis: 0.2,
  layoutWidthsPerHour: 1,
  gatePass: 0.85,
  gateReject: 0.4,
  launchCoolingOffSeconds: 604800,
  agentLaunchesPerDay: 1,
  ownerLaunchesPerWeek: 3,
  voteHours: 72,
  quorumSupplyPercent: 1,
  testnetOnly: true,
} as const;

export type UnsentReceipt = Extract<Receipt, { readonly transactionHash: null }>;
export type ReceiptDraft = Omit<UnsentReceipt, "transactionHash" | "blockNumber">;
export function withoutTransaction(draft: ReceiptDraft): UnsentReceipt {
  return { ...draft, transactionHash: null, blockNumber: null };
}
export function unillustratedPart(part: Omit<typeof DesignPart.Type, "image">): typeof DesignPart.Type {
  return { ...part, image: null };
}

// These constructors own JSON absence. Domain research code carries Option and never invents an unobserved allocation or block.
export const undisclosedPosition: PositionDisclosure = { disclosure: "undisclosed" };
export const researchNote = (
  input: Omit<Note, "launchAllocation" | "positionEvidence" | "publicationReason" | "assertion" | "assertionEvidence">,
): Note =>
  Note.make({
    ...input,
    launchAllocation: null,
    positionEvidence: null,
    publicationReason: null,
    assertion: null,
    assertionEvidence: null,
  });
export const webResearchSource = (input: Omit<Source, "blockNumber">): Source =>
  Source.make({ ...input, blockNumber: null });
