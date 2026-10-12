import { Result } from "effect";
import { expect, it } from "vitest";
import { allocationCanTransfer, curveBuy, curveSell, voteResult } from "../src/index";
it("allocation lock allows only additional unlocked tokens before release", () => {
  expect(allocationCanTransfer(110n, 10n, 100n, 1000, 999)).toBe(true);
  expect(allocationCanTransfer(110n, 11n, 100n, 1000, 999)).toBe(false);
  expect(allocationCanTransfer(110n, 110n, 100n, 1000, 1000)).toBe(true);
  expect(allocationCanTransfer(110n, -1n, 100n, 1000, 1000)).toBe(false);
});
it("integer curve arithmetic cannot create money by roundtrip", () => {
  const tokens = Result.getOrThrow(curveBuy(1000000n, 1000n, 100n));
  const returned = Result.getOrThrow(curveSell(1000000n - tokens, 1100n, tokens));
  expect(returned).toBeLessThanOrEqual(100n);
});
it("governance requires 72 hours, supply quorum and unique holders", () => {
  const proposal = {
    id: "p",
    tokenId: "t",
    proposer: "owner",
    createdAt: "2026-10-11T00:00:00Z",
    snapshotSupply: 10000n,
    votes: [{ voter: "holder", balanceAtSnapshot: 100n, support: true }],
  };
  expect(Result.getOrThrow(voteResult(proposal, "2026-10-13T00:00:00Z"))).toBe("open");
  expect(Result.getOrThrow(voteResult(proposal, "2026-10-14T00:00:00Z"))).toBe("adopted");
  expect(
    Result.isFailure(
      voteResult({ ...proposal, votes: [...proposal.votes, ...proposal.votes] }, "2026-10-14T00:00:00Z"),
    ),
  ).toBe(true);
});
