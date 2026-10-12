import { Policy, type PolicyCheck, Proposal, type Receipt, withoutTransaction } from "@floor/contract";
import { DateTime, Option, Result, Schema } from "effect";
export interface PolicyContext {
  readonly owner: string;
  readonly ownerAddress: Option.Option<string>;
  readonly walletAddress: Option.Option<string>;
  readonly agentId: string;
  readonly paused: boolean;
  readonly now: string;
  readonly walletUsd: number;
  readonly resultingPositionUsd: number;
  readonly dailyLossUsd: number;
  readonly quotedValueUsd: Option.Option<number>;
  readonly quoteExpiresAt: Option.Option<string>;
  readonly agentLaunchesToday: number;
  readonly ownerLaunchesThisWeek: number;
  readonly allocationLockedUntil: Option.Option<string>;
  readonly sourceEvidenceVerified: boolean;
  readonly launchGateApproved: boolean;
  readonly isTestnet: boolean;
}
export interface PolicyResult {
  readonly decision: "allow" | "approval" | "refuse";
  readonly checks: readonly PolicyCheck[];
  readonly reason: string;
}
export class AuthorizationError
  extends Schema.TaggedError<AuthorizationError>()("AuthorizationError", { message: Schema.String })
{}
const time = (value: string): number =>
  Option.getOrElse(Option.map(DateTime.make(value), DateTime.toEpochMillis), () => Number.NaN);
const sameAddress = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();
const check = (rule: string, passed: boolean, actual: string | number, limit: string | number): PolicyCheck => ({
  rule,
  passed,
  actual: String(actual),
  limit: String(limit),
});
const ProposalJson = Schema.fromJsonString(Proposal);
// @effect-diagnostics-next-line schemaSync:off -- Pure canonical serialization of an already-decoded proposal cannot perform asynchronous work.
export const fingerprintProposal = Schema.encodeSync(ProposalJson);

function baseChecks(proposal: Proposal, policy: Policy, context: PolicyContext): readonly PolicyCheck[] {
  const amount = Number(proposal.amount);
  return [
    check(
      "Owner binding",
      proposal.owner === context.owner && proposal.agentId === context.agentId,
      proposal.owner,
      context.owner,
    ),
    check(
      "Owner-confirmed policy",
      Option.exists(
        Option.fromNullishOr(policy.confirmedAt),
        (confirmedAt) => Number.isFinite(time(confirmedAt)) && time(confirmedAt) <= time(context.now),
      ),
      policy.confirmedAt ?? "unconfirmed",
      "owner confirmation required",
    ),
    check(
      "Owner permission active",
      !context.paused || proposal.action === "withdraw",
      context.paused ? "paused" : "active",
      "active, or owner withdrawal",
    ),
    check(
      "Valid amount",
      Number.isFinite(amount) && (proposal.action === "launch" ? amount >= 0 : amount > 0),
      proposal.amount,
      "positive amount; launch allocation may be zero",
    ),
    check(
      "Valid clock",
      Number.isFinite(time(context.now)) && Number.isFinite(time(proposal.createdAt))
        && time(proposal.createdAt) <= time(context.now),
      context.now,
      "valid server time",
    ),
    check(
      "Allowed chain",
      policy.allowedChainIds.includes(proposal.chainId),
      proposal.chainId,
      policy.allowedChainIds.join(", "),
    ),
    check(
      "Testnet only",
      context.isTestnet && [84532, 31337].includes(proposal.chainId),
      proposal.chainId,
      "audited testnet configuration",
    ),
  ];
}
function withdrawalChecks(proposal: Proposal, context: PolicyContext): readonly PolicyCheck[] {
  return [
    check(
      "Canonical owner withdrawal",
      proposal.protocol === "owner-withdrawal" && proposal.method === "withdrawToOwner"
        && Option.exists(context.walletAddress, (address) => sameAddress(proposal.contract, address)),
      `${proposal.protocol}.${proposal.method}`,
      "owner-withdrawal.withdrawToOwner on the agent account",
    ),
    check(
      "Funds only go home",
      Option.exists(context.ownerAddress, (address) => sameAddress(proposal.recipient, address)),
      proposal.recipient,
      Option.getOrElse(context.ownerAddress, () => "wallet not connected"),
    ),
  ];
}
function marketChecks(proposal: Proposal, policy: Policy, context: PolicyContext): readonly PolicyCheck[] {
  const quoted = context.quotedValueUsd;
  return [
    check(
      "Trade recipient",
      Option.exists(context.walletAddress, (address) => sameAddress(proposal.recipient, address)),
      proposal.recipient,
      Option.getOrElse(context.walletAddress, () => "smart account not connected"),
    ),
    check(
      "Allowed protocol",
      policy.allowedProtocols.includes(proposal.protocol),
      proposal.protocol,
      policy.allowedProtocols.join(", "),
    ),
    check(
      "Allowed contract",
      policy.allowedContracts.some((address) => sameAddress(address, proposal.contract)),
      proposal.contract,
      policy.allowedContracts.join(", "),
    ),
    check(
      "Allowed method",
      policy.allowedMethods.includes(proposal.method),
      proposal.method,
      policy.allowedMethods.join(", "),
    ),
    check(
      "Fresh independent valuation",
      Option.exists(quoted, (value) => Number.isFinite(value) && value >= 0)
        && Option.exists(context.quoteExpiresAt, (expires) => time(expires) > time(context.now)),
      Option.match(quoted, { onSome: String, onNone: () => "unavailable" }),
      "unexpired server quote",
    ),
    check(
      "Proposal matches quote",
      Option.exists(quoted, (value) => proposal.valueUsd === value),
      proposal.valueUsd,
      Option.match(quoted, { onSome: String, onNone: () => "quote unavailable" }),
    ),
    check(
      "Slippage",
      Number.isFinite(proposal.slippageBps) && proposal.slippageBps >= 0
        && proposal.slippageBps <= policy.maxSlippageBps,
      proposal.slippageBps,
      policy.maxSlippageBps,
    ),
    check(
      "Daily loss",
      Number.isFinite(context.dailyLossUsd) && context.dailyLossUsd >= 0
        && context.dailyLossUsd < policy.dailyLossLimitUsd,
      context.dailyLossUsd,
      policy.dailyLossLimitUsd,
    ),
    check(
      "Linked thesis",
      proposal.thesisId.length > 0 && proposal.sourceIds.length > 0 && context.sourceEvidenceVerified,
      proposal.thesisId || "missing",
      "owned thesis with persisted sourced or verified evidence required",
    ),
  ];
}
function tradingChecks(proposal: Proposal, policy: Policy, context: PolicyContext): readonly PolicyCheck[] {
  return [
    ...marketChecks(proposal, policy, context),
    check(
      "Maximum trade",
      Option.exists(context.quotedValueUsd, (value) => value <= policy.maxTradeUsd),
      Option.match(context.quotedValueUsd, { onSome: String, onNone: () => "unavailable" }),
      policy.maxTradeUsd,
    ),
    check(
      "Maximum position",
      context.walletUsd > 0 && Number.isFinite(context.resultingPositionUsd) && context.resultingPositionUsd >= 0
        && context.resultingPositionUsd / context.walletUsd * 100 <= policy.maxPositionPercent,
      context.walletUsd > 0 ? context.resultingPositionUsd / context.walletUsd * 100 : "no balance",
      policy.maxPositionPercent,
    ),
    check(
      "Allocation cooling-off",
      Option.match(context.allocationLockedUntil, {
        onNone: () => true,
        onSome: (unlock) => time(context.now) >= time(unlock),
      }),
      Option.getOrElse(context.allocationLockedUntil, () => "no locked allocation"),
      "allocation released",
    ),
  ];
}
function launchingChecks(proposal: Proposal, policy: Policy, context: PolicyContext): readonly PolicyCheck[] {
  return [
    ...marketChecks(proposal, policy, context),
    check(
      "Launch gate",
      context.launchGateApproved,
      context.launchGateApproved ? "accepted" : "not accepted",
      "accepted review of these exact launch instructions and source content",
    ),
    check("Launch permission", policy.launchAllowed, String(policy.launchAllowed), "owner allowed"),
    check(
      "Launch budget",
      Option.exists(context.quotedValueUsd, (value) => value <= policy.launchBudgetUsd),
      Option.match(context.quotedValueUsd, { onSome: String, onNone: () => "unavailable" }),
      policy.launchBudgetUsd,
    ),
    check(
      "Agent daily launches",
      Number.isInteger(context.agentLaunchesToday) && context.agentLaunchesToday >= 0
        && context.agentLaunchesToday < policy.maxLaunchesPerAgentDay && policy.maxLaunchesPerAgentDay <= 1,
      context.agentLaunchesToday,
      policy.maxLaunchesPerAgentDay,
    ),
    check(
      "Owner weekly launches",
      Number.isInteger(context.ownerLaunchesThisWeek) && context.ownerLaunchesThisWeek >= 0
        && context.ownerLaunchesThisWeek < policy.maxLaunchesPerOwnerWeek && policy.maxLaunchesPerOwnerWeek <= 3,
      context.ownerLaunchesThisWeek,
      policy.maxLaunchesPerOwnerWeek,
    ),
    check("Allocation lock", policy.coolingOffSeconds >= 604800, policy.coolingOffSeconds, "at least 604800 seconds"),
  ];
}
export function evaluatePolicy(proposal: Proposal, policy: Policy, context: PolicyContext): PolicyResult {
  const checks = [...baseChecks(proposal, policy, context)];
  switch (proposal.action) {
    case "withdraw":
      checks.push(...withdrawalChecks(proposal, context));
      break;
    case "trade":
      checks.push(...tradingChecks(proposal, policy, context));
      break;
    case "launch":
      checks.push(...launchingChecks(proposal, policy, context));
      break;
  }
  const failed = checks.filter((entry) => !entry.passed);
  if (failed.length > 0) return { decision: "refuse", checks, reason: failed.map((entry) => entry.rule).join("; ") };
  const approval = proposal.action === "withdraw" || proposal.valueUsd > policy.approvalThresholdUsd;
  return {
    decision: approval ? "approval" : "allow",
    checks,
    reason: approval ? "Owner approval required" : "Confirmed policy passed",
  };
}
export function createReceipt(proposal: Proposal, policy: Policy, context: PolicyContext): Receipt {
  const result = evaluatePolicy(proposal, policy, context);
  return withoutTransaction({
    id: `receipt:${proposal.id}`,
    proposalId: proposal.id,
    proposalFingerprint: fingerprintProposal(proposal),
    agentId: proposal.agentId,
    owner: proposal.owner,
    marketId: proposal.marketId,
    chainId: proposal.chainId,
    action: result.decision === "refuse" ? "refusal" : proposal.action,
    status: result.decision === "refuse"
      ? "refused"
      : result.decision === "approval"
      ? "awaiting-approval"
      : "approved",
    amount: proposal.amount,
    symbol: proposal.symbol,
    valueUsd: proposal.valueUsd,
    thesisId: proposal.thesisId,
    sourceIds: proposal.sourceIds,
    policyVersion: policy.version,
    checks: result.checks,
    reason: result.reason,
    createdAt: context.now,
    updatedAt: context.now,
    expiresAt: Option.getOrNull(
      result.decision === "refuse"
        ? Option.none()
        : Option.some(
          DateTime.formatIso(DateTime.makeUnsafe(time(context.now) + Math.max(0, policy.approvalTtlSeconds) * 1000)),
        ),
    ),
  });
}
export function expireReceipt(receipt: Receipt, now: string): Receipt {
  if (
    (receipt.status === "awaiting-approval" || receipt.status === "approved")
    && Option.exists(Option.fromNullishOr(receipt.expiresAt), (expires) => time(now) >= time(expires))
  ) {
    return withoutTransaction({
      ...receipt,
      updatedAt: now,
      status: "expired",
      reason: "Approval expired without signing",
    });
  }
  return receipt;
}
export function authorizeReceipt(
  receipt: Receipt,
  owner: string,
  decision: "approve" | "decline",
  now: string,
): Result.Result<Receipt, AuthorizationError> {
  if (!Number.isFinite(time(now))) {
    return Result.fail(new AuthorizationError({ message: "A valid server time is required" }));
  }
  if (receipt.owner !== owner) {
    return Result.fail(new AuthorizationError({ message: "Only the bound owner may answer this approval" }));
  }
  const current = expireReceipt(receipt, now);
  if (current.status !== "awaiting-approval") return Result.succeed(current);
  return Result.succeed({
    ...current,
    updatedAt: now,
    status: decision === "approve" ? "approved" : "declined",
    reason: decision === "approve"
      ? "Approved by owner; policy will be checked again before signing"
      : "Declined by owner",
  });
}
export function reserveExecution(
  receipt: Receipt,
  proposal: Proposal,
  policy: Policy,
  context: PolicyContext,
): Receipt {
  const current = expireReceipt(receipt, context.now);
  if (current.status !== "approved") return current;
  if (
    current.proposalId !== proposal.id || current.proposalFingerprint !== fingerprintProposal(proposal)
    || current.policyVersion !== policy.version
  ) {
    return {
      ...current,
      updatedAt: context.now,
      status: "refused",
      action: "refusal",
      reason: "Proposal or confirmed policy changed after approval",
    };
  }
  const result = evaluatePolicy(proposal, policy, context);
  if (result.decision === "refuse") {
    return {
      ...current,
      updatedAt: context.now,
      status: "refused",
      action: "refusal",
      checks: result.checks,
      reason: result.reason,
    };
  }
  return { ...current, updatedAt: context.now, status: "executing", checks: result.checks, reason: "Signing reserved" };
}
export function updatePolicy(
  current: Policy,
  next: Policy,
  principal: string,
  owner: string,
  now: string,
): Result.Result<Policy, AuthorizationError> {
  if (principal !== owner) return Result.fail(new AuthorizationError({ message: "Policy changes require the owner" }));
  const parsed = Schema.decodeResult(Policy)(next);
  if (Result.isFailure(parsed)) return Result.fail(new AuthorizationError({ message: parsed.failure.message }));
  return Result.succeed({ ...parsed.success, version: current.version + 1, confirmedAt: now });
}
