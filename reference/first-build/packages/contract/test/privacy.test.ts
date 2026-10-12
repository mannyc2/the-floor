import { Option, Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  type Agent,
  defaultPolicy,
  PositionDisclosure,
  publicAgent,
  PublicReceipt,
  publicReceipt,
  undisclosedPosition,
  withoutTransaction,
} from "../src/index";

const agent: Agent = {
  paused: false,
  id: "wren",
  owner: "owner-secret",
  name: "Wren",
  // oxlint-disable-next-line effect/noNullish -- The source Agent DTO records an absent emblem modifier as JSON null.
  emblem: { shape: "circle", modifier: null },
  walletAddress: "0x1111111111111111111111111111111111111111",
  mandate: "Private research instructions",
  policy: defaultPolicy,
  visibility: "public",
  publishMandate: false,
  state: "researching",
  budget: { dailyUsd: 10, spentUsd: 4, day: "2026-10-11" },
  districtId: "quay",
  createdAt: "2026-10-11T12:00:00Z",
};

describe("public observation boundaries", () => {
  it("projects only public identity and an explicit absence of private mandate", () => {
    const visible = publicAgent(agent);
    expect(Object.keys(visible).toSorted()).toEqual([
      "createdAt",
      "districtId",
      "emblem",
      "id",
      "name",
      "publishedMandate",
      "state",
    ]);
    expect(Option.isNone(visible.publishedMandate)).toBe(true);
  });
  it("publishes a mandate only when the owner explicitly selected it", () => {
    expect(publicAgent({ ...agent, publishMandate: true }).publishedMandate).toEqual(Option.some(agent.mandate));
  });
  it("cannot confuse an undisclosed position with a known zero position", () => {
    expect(undisclosedPosition).toEqual({ disclosure: "undisclosed" });
    expect(Result.isFailure(Schema.decodeUnknownResult(PositionDisclosure)({ disclosure: "disclosed" }))).toBe(true);
    const knownZero = { disclosure: "disclosed", amount: "0", symbol: "TOKEN", supplyPercent: 0 };
    expect(Result.isSuccess(Schema.decodeUnknownResult(PositionDisclosure)(knownZero))).toBe(true);
    expect(
      Result.isFailure(
        Schema.decodeUnknownResult(PositionDisclosure)({ amount: "0", symbol: "TOKEN", supplyPercent: 0 }),
      ),
    ).toBe(true);
  });
  it("publishes receipt evidence without owner identifiers or private policy facts", () => {
    const receipt = withoutTransaction({
      id: "receipt-1",
      proposalId: "proposal-1",
      proposalFingerprint: "private-owner-and-proposal-serialization",
      owner: "owner-secret",
      agentId: "wren",
      marketId: "pool",
      chainId: 84532,
      action: "trade",
      amount: "1",
      symbol: "TOKEN",
      valueUsd: 1,
      thesisId: "thesis-1",
      sourceIds: ["source-1"],
      policyVersion: 1,
      status: "approved",
      checks: [{ rule: "Owner binding", passed: true, actual: "owner-secret", limit: "private-policy-facts" }],
      reason: "Owner confirmed",
      createdAt: "2026-10-11T12:00:00Z",
      updatedAt: "2026-10-11T12:00:00Z",
      expiresAt: "2026-10-11T12:15:00Z",
    });
    const visible = publicReceipt(receipt);
    expect(Object.hasOwn(visible, "owner")).toBe(false);
    expect(Object.hasOwn(visible, "proposalFingerprint")).toBe(false);
    expect(visible.checks).toEqual([{ rule: "Owner binding", passed: true }]);
    expect(Result.isFailure(Schema.decodeUnknownResult(PublicReceipt)({ ...visible, status: "confirmed" }))).toBe(true);
    const confirmed = publicReceipt({
      ...receipt,
      status: "confirmed",
      transactionHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      blockNumber: 12,
    });
    expect(Result.isSuccess(Schema.decodeResult(PublicReceipt)(confirmed))).toBe(true);
    expect(confirmed.status).toBe("confirmed");
  });
});
