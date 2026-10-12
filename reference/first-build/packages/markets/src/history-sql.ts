import { Effect, Layer, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { historyRetention, MarketHistory, MarketHistoryError, observationOnly, snapshotJson } from "./history";
import { type MarketRecording, type MarketSnapshot } from "./types";

const makeHistory = Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient;
  const capacity = yield* historyRetention;
  const rows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: Schema.Struct({ data: snapshotJson }),
    execute: () => sql`SELECT data FROM market_snapshots ORDER BY blockNumber`,
  });
  const pinned = SqlSchema.findOneOption({
    Request: Schema.Int,
    Result: Schema.Struct({ blockHash: Schema.String }),
    execute: block =>
      sql`SELECT blockHash FROM market_snapshots JOIN market_snapshot_pins USING(blockNumber) WHERE blockNumber = ${block}`,
  });
  const exists = SqlSchema.findOneOption({
    Request: Schema.Int,
    Result: Schema.Struct({ blockNumber: Schema.Int }),
    execute: block => sql`SELECT blockNumber FROM market_snapshots WHERE blockNumber = ${block}`,
  });
  const compact = sql`DELETE FROM market_snapshots WHERE blockNumber IN (
    SELECT blockNumber FROM market_snapshots WHERE blockNumber NOT IN (SELECT blockNumber FROM market_snapshot_pins)
    ORDER BY blockNumber DESC LIMIT -1 OFFSET ${capacity}
  )`;
  const append = Effect.fn("MarketHistory.sql.append")(
    function*(snapshot: MarketSnapshot) {
      const encoded = yield* Schema.encodeEffect(snapshotJson)(observationOnly(snapshot));
      yield* sql.withTransaction(Effect.gen(function*() {
        const captured = yield* pinned(snapshot.blockNumber);
        if (Option.isSome(captured)) {
          return yield* Effect.succeed(captured.value).pipe(
            Effect.filterOrFail(value => value.blockHash === snapshot.blockHash, () =>
              new MarketHistoryError({
                operation: "append",
                message: "A captured source block has a different chain hash.",
              })),
            Effect.asVoid,
          );
        }
        yield* sql`INSERT INTO market_snapshots(blockNumber, blockHash, data) VALUES (${snapshot.blockNumber}, ${snapshot.blockHash}, ${encoded})
        ON CONFLICT(blockNumber) DO UPDATE SET blockHash = excluded.blockHash, data = excluded.data`;
        return yield* compact.pipe(Effect.asVoid);
      }));
    },
    Effect.mapError(error =>
      Schema.is(MarketHistoryError)(error)
        ? error
        : new MarketHistoryError({ operation: "append", message: "The market observation could not be committed." })
    ),
  );
  const importRecording = Effect.fn("MarketHistory.sql.importRecording")(
    function*(recording: MarketRecording) {
      // Existing observations win over a bundled recording after restart; import and retention commit together.
      yield* sql.withTransaction(Effect.gen(function*() {
        for (const snapshot of recording.snapshots) {
          const encoded = yield* Schema.encodeEffect(snapshotJson)(observationOnly(snapshot));
          yield* sql`INSERT INTO market_snapshots(blockNumber, blockHash, data) VALUES (${snapshot.blockNumber}, ${snapshot.blockHash}, ${encoded})
          ON CONFLICT(blockNumber) DO NOTHING`;
        }
        yield* compact;
      }));
    },
    Effect.mapError(() =>
      new MarketHistoryError({ operation: "import", message: "The recorded observations could not be imported." })
    ),
  );
  const pin = Effect.fn("MarketHistory.sql.pin")(
    function*(blockNumber: number) {
      yield* sql.withTransaction(Effect.gen(function*() {
        yield* exists(blockNumber).pipe(
          Effect.flatMap(Effect.fromOption),
          Effect.mapError(() =>
            new MarketHistoryError({ operation: "pin", message: "The captured source block is no longer retained." })
          ),
        );
        yield* sql`INSERT INTO market_snapshot_pins(blockNumber) VALUES (${blockNumber}) ON CONFLICT(blockNumber) DO NOTHING`;
      }));
    },
    Effect.mapError(error =>
      Schema.is(MarketHistoryError)(error)
        ? error
        : new MarketHistoryError({ operation: "pin", message: "The captured source block could not be retained." })
    ),
  );
  return MarketHistory.of({
    append,
    importRecording,
    pin,
    snapshots: rows().pipe(
      Effect.map(result => result.map(row => row.data)),
      Effect.mapError(() =>
        new MarketHistoryError({ operation: "read", message: "Stored market observations could not be decoded." })
      ),
    ),
  });
});

/** @stability unstable */
export const MarketHistorySql = Layer.effect(MarketHistory, makeHistory);
