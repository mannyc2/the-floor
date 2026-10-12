import { defaultPolicy, Policy, Proposal, type Receipt } from "@floor/contract";
import { Option, Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  authorizeReceipt,
  createReceipt,
  evaluatePolicy,
  expireReceipt,
  fingerprintProposal,
  type PolicyContext,
  reserveExecution,
  updatePolicy,
} from "../src/index";
const account = "0x1111111111111111111111111111111111111111";
const home = "0x2222222222222222222222222222222222222222";
const pool = "0x3333333333333333333333333333333333333333";
const attacker = "0x4444444444444444444444444444444444444444";
const now = "2026-10-11T12:00:00.000Z";
const policy: Policy = {
  ...defaultPolicy,
  allowedProtocols: ["pool"],
  allowedContracts: [pool],
  allowedMethods: ["swap"],
  confirmedAt: "2026-10-11T11:00:00.000Z",
};
const proposal: Proposal = {
  id: "proposal-1",
  agentId: "wren",
  owner: "owner",
  action: "trade",
  chainId: 84532,
  protocol: "pool",
  contract: pool,
  method: "swap",
  recipient: account,
  marketId: "toad",
  amount: "1.000000000000000001",
  symbol: "ETH",
  valueUsd: 40,
  slippageBps: 20,
  thesisId: "thesis",
  sourceIds: ["source"],
  createdAt: now,
};
const context: PolicyContext = {
  owner: "owner",
  ownerAddress: Option.some(home),
  walletAddress: Option.some(account),
  agentId: "wren",
  paused: false,
  now,
  walletUsd: 1000,
  resultingPositionUsd: 40,
  dailyLossUsd: 0,
  quotedValueUsd: Option.some(40),
  quoteExpiresAt: Option.some("2026-10-11T12:05:00.000Z"),
  agentLaunchesToday: 0,
  ownerLaunchesThisWeek: 0,
  allocationLockedUntil: Option.none(),
  sourceEvidenceVerified: true,
  launchGateApproved: true,
  isTestnet: true,
};
const waiting = (): Receipt =>
  createReceipt({ ...proposal, valueUsd: 60 }, policy, {
    ...context,
    quotedValueUsd: Option.some(60),
    resultingPositionUsd: 40,
  });
describe("Money protection", () => {
  it("keeps one creation record while authority decisions acquire their actual observation times", () => {
    const requested = { ...proposal, createdAt: "2026-10-11T11:59:00.000Z", valueUsd: 60 };
    const facts = { ...context, quotedValueUsd: Option.some(60) };
    const pending = createReceipt(requested, policy, facts);
    expect(pending.chainId).toBe(84532);
    expect(pending.createdAt).toBe(now);
    expect(pending.updatedAt).toBe(now);
    const approvedAt = "2026-10-11T12:01:00.000Z";
    const approved = Result.getOrThrow(authorizeReceipt(pending, "owner", "approve", approvedAt));
    expect(approved.updatedAt).toBe(approvedAt);
    const reservedAt = "2026-10-11T12:02:00.000Z";
    const currentFacts = { ...facts, now: reservedAt };
    const reserved = reserveExecution(approved, requested, policy, currentFacts);
    expect(reserved.status).toBe("executing");
    expect(reserved.updatedAt).toBe(reservedAt);
    expect(reserved.createdAt).toBe(pending.createdAt);
    const rejected = reserveExecution(approved, requested, { ...policy, version: 2 }, currentFacts);
    expect(rejected.status).toBe("refused");
    expect(rejected.updatedAt).toBe(reservedAt);
    expect(rejected.chainId).toBe(pending.chainId);
    const expiredAt = "2026-10-11T12:15:00.000Z";
    const expired = expireReceipt(pending, expiredAt);
    expect(expired.updatedAt).toBe(expiredAt);
    expect(expired.createdAt).toBe(pending.createdAt);
    // Re-reading a final decision does not move its historical visibility to the time of the read.
    expect(expireReceipt(expired, "2026-10-11T12:16:00.000Z")).toEqual(expired);
    expect(reserveExecution(reserved, requested, policy, { ...facts, now: "2026-10-11T12:03:00.000Z" })).toEqual(
      reserved,
    );
  });
  it("requires all independent policy facts and preserves exact amounts", () => {
    const receipt = createReceipt(proposal, policy, context);
    expect(receipt.status).toBe("approved");
    expect(receipt.amount).toBe("1.000000000000000001");
    expect(receipt.transactionHash).toBeNull();
    expect(receipt.sourceIds).toEqual(["source"]);
    expect(receipt.thesisId).toBe("thesis");
    expect(receipt.checks.every((check) => check.passed)).toBe(true);
  });
  it.each(
    [
      ["owner", { owner: "attacker" }],
      ["recipient", { recipient: attacker }],
      ["contract", { contract: attacker }],
      ["method", { method: "approve" }],
      ["protocol", { protocol: "drainer" }],
      ["mainnet", { chainId: 8453 }],
      ["fabricated quote", { valueUsd: 1 }],
      ["slippage", { slippageBps: 101 }],
    ] as const,
  )("refuses altered %s", (_name, changed) => {
    expect(evaluatePolicy({ ...proposal, ...changed }, policy, context).decision).toBe("refuse");
  });
  it("refuses missing or expired quote, exhausted limits, pause and locked allocations", () => {
    for (
      const changed of [
        { quotedValueUsd: Option.none() },
        { quoteExpiresAt: Option.some(now) },
        { dailyLossUsd: 25 },
        { paused: true },
        { sourceEvidenceVerified: false },
        { resultingPositionUsd: 51 },
        { allocationLockedUntil: Option.some("2026-10-18T12:00:00Z") },
      ]
    ) expect(evaluatePolicy(proposal, policy, { ...context, ...changed }).decision).toBe("refuse");
  });
  it("rejects nonfinite or negative untrusted amounts at the schema boundary", () => {
    expect(Result.isFailure(Schema.decodeResult(Proposal)({ ...proposal, valueUsd: -1 }))).toBe(true);
    expect(Result.isFailure(Schema.decodeResult(Proposal)({ ...proposal, valueUsd: Infinity }))).toBe(true);
    expect(Result.isFailure(Schema.decodeResult(Proposal)({ ...proposal, amount: "-1" }))).toBe(true);
    expect(Result.isFailure(Schema.decodeResult(Policy)({ ...policy, dailyLossLimitUsd: -1 }))).toBe(true);
    expect(evaluatePolicy(proposal, policy, { ...context, walletUsd: NaN }).decision).toBe("refuse");
  });
  it("approval expiration never signs and replay cannot revive it", () => {
    const pending = waiting();
    expect(pending.status).toBe("awaiting-approval");
    const expired = Result.getOrThrow(authorizeReceipt(pending, "owner", "approve", "2026-10-11T12:15:00.000Z"));
    expect(expired.status).toBe("expired");
    expect(expired.transactionHash).toBeNull();
    expect(Result.getOrThrow(authorizeReceipt(expired, "owner", "approve", "2026-10-11T12:16:00.000Z"))).toEqual(
      expired,
    );
    expect(expireReceipt(pending, "2026-10-11T12:15:00.000Z").status).toBe("expired");
  });
  it("only owner can approve and declined approvals stay declined", () => {
    expect(Result.isFailure(authorizeReceipt(waiting(), "attacker", "approve", now))).toBe(true);
    const declined = Result.getOrThrow(authorizeReceipt(waiting(), "owner", "decline", now));
    expect(Result.getOrThrow(authorizeReceipt(declined, "owner", "approve", now)).status).toBe("declined");
  });
  it("an approved id cannot be reused with any changed economic field", () => {
    const receipt = createReceipt(proposal, policy, context);
    for (
      const changed of [{ amount: "2" }, { recipient: attacker }, { valueUsd: 41 }, { contract: attacker }, {
        method: "transfer",
      }, { sourceIds: ["invented"] }] satisfies readonly Partial<Proposal>[]
    ) {
      const altered = { ...proposal, ...changed };
      expect(fingerprintProposal(altered)).not.toBe(receipt.proposalFingerprint);
      expect(reserveExecution(receipt, altered, policy, context).status).toBe("refused");
    }
    expect(reserveExecution(receipt, proposal, { ...policy, version: 2 }, context).status).toBe("refused");
  });
  it("reserves once without inventing a transaction", () => {
    const receipt = createReceipt(proposal, policy, context);
    const reserved = reserveExecution(receipt, proposal, policy, context);
    expect(reserved.status).toBe("executing");
    expect(reserveExecution(reserved, proposal, policy, context)).toEqual(reserved);
    expect(reserved.transactionHash).toBeNull();
  });
  it("withdrawal is canonical, goes home and always waits for owner", () => {
    const withdrawal: Proposal = {
      ...proposal,
      action: "withdraw",
      protocol: "owner-withdrawal",
      method: "withdrawToOwner",
      contract: account,
      recipient: home,
    };
    expect(evaluatePolicy(withdrawal, policy, { ...context, paused: true }).decision).toBe("approval");
    expect(evaluatePolicy({ ...withdrawal, recipient: attacker }, policy, context).decision).toBe("refuse");
    expect(evaluatePolicy({ ...withdrawal, method: "executeArbitrary" }, policy, context).decision).toBe("refuse");
    expect(evaluatePolicy({ ...withdrawal, contract: attacker }, policy, context).decision).toBe("refuse");
  });
  it("policy cannot be changed by its agent or untrusted pages", () => {
    expect(Result.isFailure(updatePolicy(policy, { ...policy, maxTradeUsd: 100000 }, "wren", "owner", now))).toBe(true);
    expect(Result.getOrThrow(updatePolicy(policy, { ...policy, maxTradeUsd: 20 }, "owner", "owner", now)))
      .toMatchObject({ maxTradeUsd: 20, version: 2, confirmedAt: now });
  });
});
