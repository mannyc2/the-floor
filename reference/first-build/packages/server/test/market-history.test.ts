import { BunServices } from "@effect/platform-bun";
import { assert, it } from "@effect/vitest";
import { MarketHistory, Markets, recordingJson } from "@floor/markets";
import { Array, ConfigProvider, Context, Effect, Exit, FileSystem, Layer, Path, Schema } from "effect";
import { offlineChain } from "../../markets/src/testing";
import { databaseLayer } from "../src/sqlite-store";
import { FloorDatabase } from "../src/store";

class AbandonPlate extends Schema.TaggedError<AbandonPlate>()("AbandonPlate", {}) {}

const retainedDatabase = (filename: string) =>
  Markets.layer.pipe(
    Layer.provide(offlineChain),
    Layer.provideMerge(databaseLayer(filename)),
    Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ FLOOR_HISTORY_BLOCKS: 2 }))),
  );

it.layer(BunServices.layer)("durable market history", test => {
  test.effect("reopens SQLite with exact plate evidence after bounded history eviction", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "floor-history-" });
      const filename = path.join(directory, "history.sqlite");
      const recording = yield* Schema.decodeEffect(recordingJson)(
        yield* fs.readFileString("testing/recordings/base-day.json"),
      );
      const first = yield* Effect.fromOption(Array.head(recording.snapshots));
      const final = yield* Effect.fromOption(Array.last(recording.snapshots));
      const market = yield* Effect.fromOption(Array.head(first.markets));

      // Separate scopes close the first connection before the restart acquires the same file.
      const originalSlots = yield* Effect.gen(function*() {
        const services = yield* Layer.build(retainedDatabase(filename));
        const history = Context.get(services, MarketHistory);
        const db = Context.get(services, FloorDatabase);
        yield* history.append(first);
        yield* db.marketSlots.ensure(first.markets.map(item => item.id));
        yield* db.sql.withTransaction(Effect.gen(function*() {
          yield* history.pin(first.blockNumber);
          yield* db.plates.insert({
            title: "Retained source",
            createdAt: first.observedAt,
            blockNumber: first.blockNumber,
            marketId: market.id,
            receiptIds: [],
            view: "liquidity",
            image: "data:image/png;base64,AA==",
          });
        }));
        for (const snapshot of recording.snapshots.slice(1)) yield* history.append(snapshot);
        const retained = yield* history.snapshots;
        assert.strictEqual(retained.length, 3);
        assert.deepStrictEqual(retained.map(snapshot => snapshot.blockNumber), [
          first.blockNumber,
          final.blockNumber - 1800,
          final.blockNumber,
        ]);
        assert.isTrue(Exit.isFailure(yield* Effect.exit(history.append({ ...first, blockHash: "conflicting-hash" }))));
        return yield* db.marketSlots.list();
      }).pipe(Effect.scoped);

      yield* Effect.gen(function*() {
        const services = yield* Layer.build(retainedDatabase(filename));
        const history = Context.get(services, MarketHistory);
        const markets = Context.get(services, Markets);
        const db = Context.get(services, FloorDatabase);
        yield* history.importRecording(recording);
        yield* db.marketSlots.ensure(first.markets.toReversed().map(item => item.id));
        assert.deepStrictEqual(yield* db.marketSlots.list(), originalSlots);
        const replay = yield* markets.replay(first.blockNumber).pipe(Effect.flatMap(Effect.fromOption));
        const retained = yield* history.snapshots;
        assert.strictEqual(retained.length, 3);
        assert.strictEqual(replay.blockHash, first.blockHash);
        assert.deepStrictEqual(replay.markets.map(item => item.reading), first.markets.map(item => item.reading));
        assert.isTrue(
          replay.markets.every(item => item.history.every(point => point.blockNumber <= first.blockNumber)),
        );
        assert.strictEqual((yield* markets.fetchSnapshot()).blockNumber, final.blockNumber);
        assert.strictEqual((yield* db.plates.list()).length, 1);
        assert.isTrue(Exit.isFailure(yield* Effect.exit(history.pin(first.blockNumber - 1))));
      }).pipe(Effect.scoped);
    }));

  test.effect("rolls a source pin back with an abandoned plate transaction", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem;
      const recording = yield* Schema.decodeEffect(recordingJson)(
        yield* fs.readFileString("testing/recordings/base-day.json"),
      );
      const first = yield* Effect.fromOption(Array.head(recording.snapshots));
      yield* Effect.gen(function*() {
        const services = yield* Layer.build(retainedDatabase(":memory:"));
        const history = Context.get(services, MarketHistory);
        const db = Context.get(services, FloorDatabase);
        yield* history.append(first);
        const abandoned = yield* Effect.exit(db.sql.withTransaction(Effect.gen(function*() {
          yield* history.pin(first.blockNumber);
          return yield* new AbandonPlate();
        })));
        assert.isTrue(Exit.isFailure(abandoned));
        for (const snapshot of recording.snapshots.slice(1, 3)) yield* history.append(snapshot);
        const retained = yield* history.snapshots;
        assert.strictEqual(retained.length, 2);
        assert.isFalse(retained.some(snapshot => snapshot.blockNumber === first.blockNumber));
      }).pipe(Effect.scoped);
    }));
});
