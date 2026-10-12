import { describe, expect, it } from "@effect/vitest";
import { Array, Effect, Exit, Option, Ref } from "effect";
import { TestClock } from "effect/testing";
import {
  Markets,
  normalizeBondingCurve,
  normalizeConcentratedLiquidity,
  normalizeConstantProduct,
  type Provenance,
} from "../src";
import { ChainCalls, RecordedDay, recordedMarkets } from "./_fixtures/base-chain";

const token0 = { address: "0x0000000000000000000000000000000000000001", symbol: "A", name: "A", decimals: 18 };
const token1 = { address: "0x0000000000000000000000000000000000000002", symbol: "B", name: "B", decimals: 6 };
const provenance: Provenance = {
  chainId: 8453,
  blockNumber: 123,
  blockHash: `0x${"1".repeat(64)}`,
  blockTimestamp: "2026-10-11T00:00:00.000Z",
  observedAt: "2026-10-11T00:00:01.000Z",
  source: "chain",
};
const input = {
  token0,
  token1,
  baseAddress: token0.address,
  reserve0: 10n * 10n ** 18n,
  reserve1: 20_000n * 10n ** 6n,
  provenance,
};

describe("canonical pool readings", () => {
  it.effect("corrects both decimal systems and quote orientation", () =>
    Effect.gen(function*() {
      const forward = yield* normalizeConstantProduct(input);
      const reverse = yield* normalizeConstantProduct({ ...input, baseAddress: token1.address });
      expect(forward.price).toBe(2000);
      expect(forward.price * reverse.price).toBe(1);
      expect(forward.reserve0Raw).toBe("10000000000000000000");
      expect(forward.provenance).toBe(provenance);
    }));
  it.effect("uses slot price independently of concentrated pool balances", () =>
    Effect.gen(function*() {
      const reading = yield* normalizeConcentratedLiquidity({
        ...input,
        sqrtPriceX96: 2n ** 96n,
        tick: 0,
        liquidity: 15n,
        bands: [],
      });
      expect(reading.price).toBe(1e12);
      expect(reading.price).not.toBe((yield* normalizeConstantProduct(input)).price);
      expect(reading.bands).toEqual([]);
    }));
  it.effect("bounds graduation progress and rejects unmeasurable reserves", () =>
    Effect.gen(function*() {
      const curve = {
        ...input,
        virtualTokenReserve: 1000n * 10n ** 18n,
        virtualQuoteReserve: 1000n * 10n ** 6n,
        supply: 100n * 10n ** 18n,
        graduation: { basis: "quote-raised" as const, threshold: 10_000n * 10n ** 6n },
        graduated: true,
      };
      expect(yield* normalizeBondingCurve(curve)).toMatchObject({
        price: 1,
        progress: 1,
        graduated: true,
        supply: 100,
      });
      expect(Exit.isFailure(yield* Effect.exit(normalizeBondingCurve({ ...curve, virtualTokenReserve: 0n })))).toBe(
        true,
      );
      expect(Exit.isFailure(yield* Effect.exit(normalizeConstantProduct({ ...input, reserve0: 0n })))).toBe(true);
    }));
});

it.effect("separates virtual curve price, actual inventory and token-based graduation", () =>
  Effect.gen(function*() {
    const reading = yield* normalizeBondingCurve({
      ...input,
      reserve0: 600n * 10n ** 18n,
      reserve1: 100n * 10n ** 6n,
      virtualTokenReserve: 600n * 10n ** 18n,
      virtualQuoteReserve: 1000n * 10n ** 6n,
      supply: 1000n * 10n ** 18n,
      graduation: { basis: "tokens-sold", initialSupply: 1000n * 10n ** 18n, remainingThreshold: 100n * 10n ** 18n },
      graduated: false,
    });
    expect(reading.price).toBeCloseTo(5 / 3);
    expect(reading.reserve1).toBe(100);
    expect(reading.progress).toBeCloseTo(4 / 9);
    expect(reading.graduationThreshold).toBe(900);
    expect(reading.graduationBasis).toBe("tokens-sold");
    expect(reading.graduationUnit).toBe("A");
  }));

it.layer(recordedMarkets)("recorded Base readings", test => {
  test.effect("decodes 25 actual blocks without fabricated provenance", () =>
    Effect.gen(function*() {
      const recording = yield* RecordedDay;
      expect(recording.snapshots).toHaveLength(25);
      for (const snapshot of recording.snapshots) {
        expect(snapshot.markets).toHaveLength(14);
        expect(new Set(snapshot.markets.map(market => market.kind))).toEqual(
          new Set(["constant-product", "concentrated-liquidity", "bonding-curve"]),
        );
        expect(snapshot.blockHash).toMatch(/^0x[0-9a-f]{64}$/i);
        for (const market of snapshot.markets) {
          expect(market.reading.provenance.blockNumber).toBe(snapshot.blockNumber);
          expect(market.reading.provenance.source).toBe("recording");
          expect(market.reading.reserve0Raw).toMatch(/^\d+$/);
        }
      }
    }));
  test.effect("replays only known blocks and excludes future history", () =>
    Effect.gen(function*() {
      const recording = yield* RecordedDay;
      const markets = yield* Markets;
      const middle = yield* Effect.fromOption(Array.get(recording.snapshots, 12));
      const first = yield* Effect.fromOption(Array.head(recording.snapshots));
      const market = yield* Effect.fromOption(Array.head(middle.markets));
      const replay = yield* markets.replay(middle.blockNumber + 1);
      expect(Option.map(replay, value => value.blockNumber)).toEqual(Option.some(middle.blockNumber));
      expect(Option.exists(replay, value =>
        value.markets.every(item =>
          item.history.every(point => point.blockNumber <= middle.blockNumber)
        ))).toBe(true);
      expect(Option.isNone(yield* markets.replay(first.blockNumber - 1))).toBe(true);
      expect(yield* markets.getHistory(market.id)).toHaveLength(25);
      expect(yield* markets.getSnapshots).toHaveLength(25);
    }));
  test.effect("labels the fallback and coalesces reads until the native cache expires", () =>
    Effect.gen(function*() {
      const markets = yield* Markets;
      const calls = yield* ChainCalls;
      const snapshots = yield* Effect.all([markets.fetchSnapshot(), markets.fetchSnapshot(), markets.fetchSnapshot()], {
        concurrency: 3,
      });
      for (const snapshot of snapshots) {
        expect(snapshot.status.mode).toBe("recording");
        expect(snapshot.status.message).toContain("Live RPC is unavailable");
      }
      expect(yield* Ref.get(calls)).toBe(1);
      yield* TestClock.adjust("14 seconds");
      yield* markets.fetchSnapshot();
      expect(yield* Ref.get(calls)).toBe(1);
      yield* TestClock.adjust("2 seconds");
      yield* markets.fetchSnapshot();
      expect(yield* Ref.get(calls)).toBe(2);
      yield* markets.fetchSnapshot(true);
      expect(yield* Ref.get(calls)).toBe(3);
    }));
});
