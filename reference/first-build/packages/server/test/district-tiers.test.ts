import { BunServices } from "@effect/platform-bun";
import { assert, it } from "@effect/vitest";
import { MarketHistory, type MarketSnapshot, recordingJson } from "@floor/markets";
import { Array, Context, DateTime, Effect, FileSystem, Layer, Path, Schema } from "effect";
import { DistrictTiers, tierObservations } from "../src/district-tiers";
import { databaseLayer } from "../src/sqlite-store";

const base = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const recording = yield* Schema.decodeEffect(recordingJson)(
    yield* fs.readFileString("testing/recordings/base-day.json"),
  );
  return yield* Effect.fromOption(Array.head(recording.snapshots));
});

// Activity is deliberately synthetic here so overlap, hysteresis and reorg behavior have exact, independently known answers.
const observation = (
  source: MarketSnapshot,
  block: number,
  minute: number,
  trades: number,
  liquidity: number,
): MarketSnapshot => {
  const stamp = DateTime.formatIso(DateTime.add(DateTime.makeUnsafe("2026-01-01T00:00:00.000Z"), { minutes: minute }));
  return {
    ...source,
    blockNumber: block,
    blockHash: `0x${block.toString(16).padStart(64, "0")}`,
    blockTimestamp: stamp,
    observedAt: stamp,
    markets: source.markets.slice(0, 2).map((market, index) => ({
      ...market,
      districtId: "test-district",
      liquidityUsd: liquidity * (index + 1),
      flow: { trades, windowSeconds: 120, quoteVolume: 0, volumeUsd: 0, fromBlock: block - 59, toBlock: block },
    })),
  };
};
const services = (filename: string) => DistrictTiers.layer.pipe(Layer.provideMerge(databaseLayer(filename)));

it.layer(BunServices.layer)("historical district tiers", test => {
  test.effect("counts overlapping flow windows once and leaves partial daily coverage incomplete", () =>
    Effect.gen(function*() {
      const source = yield* base;
      const first = observation(source, 100, 2, 70, 1_000_000);
      const overlap = observation(source, 130, 3, 100, 1_000_000);
      const next = observation(source, 160, 4, 60, 1_000_000);
      const future = observation(source, 220, 6, 1000, 1_000_000);
      const observations = tierObservations(next, [first, overlap, next, future]);
      assert.isTrue(observations.every(item => item.activity.lowerBound === 130 && !item.activity.complete));
      const expired = observation(source, 43_360, 1444, 0, 1_000_000);
      assert.isTrue(tierObservations(expired, [first, next, expired]).every(item => item.activity.lowerBound === 0));
    }));

  test.effect("persists hysteresis across restart, replays prior tiers and invalidates descendants after a reorg", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "floor-tiers-" });
      const filename = path.join(directory, "tiers.sqlite");
      const source = yield* base;
      const initial = observation(source, 100, 2, 0, 1_000_000);
      const promoted = observation(source, 160, 4, 130, 1_000_000);
      const later = observation(source, 43_420, 1446, 0, 1_000_000);
      const original = yield* Effect.gen(function*() {
        const context = yield* Layer.build(services(filename));
        const history = Context.get(context, MarketHistory);
        const tiers = Context.get(context, DistrictTiers);
        for (const snapshot of [initial, promoted, later]) yield* history.append(snapshot);
        const before = yield* tiers.at(initial);
        assert.isTrue(before.every(item => item.tier === "stall"));
        const raised = yield* tiers.at(promoted);
        assert.deepStrictEqual(raised.map(item => item.tier), ["works", "tower"]);
        assert.deepStrictEqual(yield* tiers.at(later), raised);
        assert.deepStrictEqual(yield* tiers.at(initial), before);
        return raised;
      }).pipe(Effect.scoped);
      yield* Effect.gen(function*() {
        const context = yield* Layer.build(services(filename));
        const history = Context.get(context, MarketHistory);
        const tiers = Context.get(context, DistrictTiers);
        assert.deepStrictEqual(yield* tiers.at(later), original);
        const replacement = { ...observation(source, 160, 4, 0, 1_000_000), blockHash: `0x${"f".repeat(64)}` };
        yield* history.append(replacement);
        assert.isTrue((yield* tiers.at(later)).every(item => item.tier === "stall"));
      }).pipe(Effect.scoped);
    }));
});
