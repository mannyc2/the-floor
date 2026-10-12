import { assert, it } from "@effect/vitest";
import { Markets } from "@floor/markets";
import { Array, Effect, Option } from "effect";
import { CapturedDay, recordedFloor } from "./_fixtures/recorded-floor";

it.layer(recordedFloor)("replay matches live", test => {
  test.effect("preserves every measured value, source block and flow window for the captured day", () =>
    Effect.gen(function*() {
      const recording = yield* CapturedDay;
      const markets = yield* Markets;
      for (const captured of recording.snapshots) {
        const live = yield* markets.fetchAtBlock(captured.blockNumber);
        const replay = yield* markets.replay(captured.blockNumber).pipe(Effect.flatMap(Effect.fromOption));
        assert.strictEqual(replay.blockHash, live.blockHash);
        assert.strictEqual(replay.blockTimestamp, live.blockTimestamp);
        assert.strictEqual(replay.source, "recording");
        assert.strictEqual(live.source, "chain");
        assert.deepStrictEqual(
          replay.markets.map(market => ({
            id: market.id,
            kind: market.kind,
            priceUsd: market.priceUsd,
            liquidityUsd: market.liquidityUsd,
            flow: market.flow,
            reading: market.reading,
          })),
          live.markets.map(market => ({
            id: market.id,
            kind: market.kind,
            priceUsd: market.priceUsd,
            liquidityUsd: market.liquidityUsd,
            flow: market.flow,
            reading: { ...market.reading, provenance: { ...market.reading.provenance, source: "recording" } },
          })),
        );
        assert.isTrue(
          replay.markets.every(market => market.history.every(point => point.blockNumber <= captured.blockNumber)),
        );
      }
      const earliest = yield* Effect.fromOption(Array.head(recording.snapshots));
      const latest = yield* Effect.fromOption(Array.last(recording.snapshots));
      const start = yield* markets.replay(earliest.blockNumber).pipe(Effect.flatMap(Effect.fromOption));
      const end = yield* markets.replay(latest.blockNumber).pipe(Effect.flatMap(Effect.fromOption));
      assert.isTrue(start.markets.every(market => Option.isNone(Option.fromNullishOr(market.change24h))));
      assert.isTrue(end.markets.every(market => Option.isSome(Option.fromNullishOr(market.change24h))));
      assert.isTrue(
        (yield* markets.getSnapshots).every(snapshot => snapshot.markets.every(market => market.history.length === 0)),
      );
    }));
});
