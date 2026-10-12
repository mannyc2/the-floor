import { assignTiers, MarketTier, type TierObservation } from "@floor/districts";
import { MarketHistory, type MarketSnapshot } from "@floor/markets";
import { ApiError } from "@floor/surfaces";
import { Context, DateTime, Effect, Layer, Option, Schema, Semaphore } from "effect";
import { SqlSchema } from "effect/sql";
import { FloorDatabase } from "./store";

const tierJson = Schema.fromJsonString(Schema.Array(MarketTier));
const TierRow = Schema.Struct({ blockNumber: Schema.Int, blockHash: Schema.String, data: tierJson });

/** Disjoint measured windows establish a lower bound; gaps never become invented daily volume or inactivity. */
export function tierObservations(
  snapshot: MarketSnapshot,
  history: readonly MarketSnapshot[],
): readonly TierObservation[] {
  const end = DateTime.toEpochMillis(DateTime.makeUnsafe(snapshot.blockTimestamp));
  const start = end - 86_400_000;
  return snapshot.markets.map(market => {
    const windows = history.filter(item => item.blockNumber <= snapshot.blockNumber).flatMap(item => {
      const observed = item.markets.find(candidate => candidate.id === market.id);
      const flow = Option.fromNullishOr(observed?.flow);
      if (Option.isNone(flow)) return [];
      const toTime = DateTime.toEpochMillis(DateTime.makeUnsafe(item.blockTimestamp));
      const fromTime = toTime - flow.value.windowSeconds * 1000;
      if (fromTime < start || toTime > end || flow.value.toBlock > snapshot.blockNumber) return [];
      return [{ ...flow.value, fromTime, toTime }];
    }).toSorted((left, right) => left.toBlock - right.toBlock || left.fromBlock - right.fromBlock);
    let previousBlock = -1;
    let coveredUntil = start;
    let complete = true;
    let lowerBound = 0;
    for (const window of windows) {
      if (window.fromBlock <= previousBlock) continue;
      if (window.fromTime > coveredUntil || (previousBlock >= 0 && window.fromBlock > previousBlock + 1)) {
        complete = false;
      }
      lowerBound += window.trades;
      previousBlock = window.toBlock;
      coveredUntil = Math.max(coveredUntil, window.toTime);
    }
    return {
      marketId: market.id,
      districtId: market.districtId,
      liquidityUsd: Option.fromNullOr(market.liquidityUsd),
      activity: { lowerBound, complete: complete && coveredUntil >= end },
    };
  });
}

const makeDistrictTiers = Effect.gen(function*() {
  const db = yield* FloorDatabase;
  const history = yield* MarketHistory;
  const semaphore = yield* Semaphore.make(1);
  const rows = SqlSchema.findAll({
    Request: Schema.Int,
    Result: TierRow,
    execute: block => db.sql`SELECT * FROM district_tiers WHERE blockNumber <= ${block} ORDER BY blockNumber`,
  });
  const at = Effect.fn("DistrictTiers.at")(
    function*(snapshot: MarketSnapshot) {
      if (snapshot.blockNumber === 0) return [];
      return yield* db.sql.withTransaction(Effect.gen(function*() {
        const retained = (yield* history.snapshots).filter(item => item.blockNumber <= snapshot.blockNumber);
        const source = retained.find(item => item.blockNumber === snapshot.blockNumber);
        if (!source || source.blockHash !== snapshot.blockHash) {
          return yield* new ApiError({
            message: "The tier source block is no longer retained with the same chain hash.",
          });
        }
        const stored = new Map((yield* rows(snapshot.blockNumber)).map(row => [row.blockNumber, row]));
        let previous: readonly MarketTier[] = [];
        for (const observed of retained) {
          const saved = Option.fromUndefinedOr(stored.get(observed.blockNumber));
          if (Option.isSome(saved) && saved.value.blockHash === observed.blockHash) {
            previous = saved.value.data;
            continue;
          }
          previous = assignTiers(tierObservations(observed, retained), previous);
          const encoded = yield* Schema.encodeEffect(tierJson)(previous);
          yield* db
            .sql`INSERT INTO district_tiers(blockNumber, blockHash, data) VALUES (${observed.blockNumber}, ${observed.blockHash}, ${encoded})
          ON CONFLICT(blockNumber) DO UPDATE SET blockHash = excluded.blockHash, data = excluded.data`;
        }
        return previous;
      }));
    },
    semaphore.withPermits(1),
    Effect.mapError(error =>
      Schema.is(ApiError)(error)
        ? error
        : new ApiError({ message: "The source block's district tiers could not be read." })
    ),
  );
  return { at };
});

/** @stability unstable */
export class DistrictTiers extends Context.Service<DistrictTiers, Effect.Success<typeof makeDistrictTiers>>()(
  "floor/DistrictTiers",
) {
  static readonly layer = Layer.effect(DistrictTiers, makeDistrictTiers);
}
