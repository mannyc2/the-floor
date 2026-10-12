import { describe, expect, it } from "@effect/vitest";
import { type Reading } from "@floor/contract";
import { Effect, Option, Result } from "effect";
import { acceptLiveReading, assignTiers, chooseOrange, limitMovement, nextTier, replayAt } from "../src/index";
const reading = (blockNumber: number, source: Reading["source"] = "chain"): Reading => ({
  marketId: "a",
  kind: "constant-product",
  chainId: 8453,
  blockNumber,
  blockHash: "0x123",
  blockTimestamp: blockNumber,
  source,
  values: { price: blockNumber },
});
describe("District truth", () => {
  it("applies hysteresis without flapping", () => {
    expect(nextTier({ previous: "stall", liquidityUsd: 51000, tradesPerDay: 110, districtPercentile: 0.5 })).toBe(
      "stall",
    );
    expect(nextTier({ previous: "stall", liquidityUsd: 60000, tradesPerDay: 120, districtPercentile: 0.5 })).toBe(
      "works",
    );
    expect(nextTier({ previous: "works", liquidityUsd: 42000, tradesPerDay: 90, districtPercentile: 0.5 })).toBe(
      "works",
    );
    expect(nextTier({ previous: "works", liquidityUsd: 39000, tradesPerDay: 90, districtPercentile: 0.5 })).toBe(
      "stall",
    );
  });
  it.effect("uses measured activity lower bounds without inventing inactivity from partial coverage", () =>
    Effect.sync(() => {
      const candidates = [
        {
          marketId: "unknown",
          districtId: "d",
          liquidityUsd: Option.some(70_000),
          activity: { lowerBound: 0, complete: false },
        },
        {
          marketId: "retained",
          districtId: "d",
          liquidityUsd: Option.some(70_000),
          activity: { lowerBound: 10, complete: false },
        },
        {
          marketId: "liquidity-fell",
          districtId: "d",
          liquidityUsd: Option.some(39_000),
          activity: { lowerBound: 0, complete: false },
        },
        {
          marketId: "measured",
          districtId: "d",
          liquidityUsd: Option.some(80_000),
          activity: { lowerBound: 140, complete: false },
        },
        {
          marketId: "inactive",
          districtId: "d",
          liquidityUsd: Option.some(70_000),
          activity: { lowerBound: 10, complete: true },
        },
      ];
      expect(assignTiers(candidates, [
        { marketId: "retained", tier: "works" },
        { marketId: "liquidity-fell", tier: "tower" },
        { marketId: "inactive", tier: "works" },
      ])).toEqual([
        { marketId: "unknown", tier: "stall" },
        { marketId: "retained", tier: "works" },
        { marketId: "liquidity-fell", tier: "stall" },
        { marketId: "measured", tier: "tower" },
        { marketId: "inactive", tier: "stall" },
      ]);
    }));
  it("moves at most one width per hour for an entire recorded month", () => {
    let point = { x: 0, z: 0 };
    for (let hour = 0; hour < 24 * 31; hour++) {
      const next = limitMovement(point, { x: Math.sin(hour) * 1000, z: Math.cos(hour) * 1000 }, 2, 3600);
      expect(Math.hypot(next.x - point.x, next.z - point.z)).toBeLessThanOrEqual(2.000000000001);
      point = next;
    }
  });
  it("selects one authoritative orange with deterministic ties", () => {
    expect(chooseOrange([{ id: "z", valueMoving: 10 }, { id: "a", valueMoving: 10 }])).toEqual(Option.some("a"));
    expect(Option.isNone(chooseOrange([{ id: "a", valueMoving: 0 }]))).toBe(true);
  });
  it("synthetic and recorded readings cannot reach live state", () => {
    expect(Result.isFailure(acceptLiveReading(reading(1, "synthetic")))).toBe(true);
    expect(Result.isFailure(acceptLiveReading(reading(1, "recording")))).toBe(true);
    expect(Result.getOrThrow(acceptLiveReading(reading(1)))).toEqual(reading(1));
  });
  it("replay takes the latest block through the same representation", () => {
    expect(replayAt([reading(3), reading(1), reading(2)], 2)).toEqual([reading(2)]);
  });
});
