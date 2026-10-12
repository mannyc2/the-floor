import { ScribedLine } from "@floor/contract";
import { chooseOrange } from "@floor/districts";
import { Markets, type MarketSnapshot } from "@floor/markets";
import { expireReceipt } from "@floor/signing";
import { ApiError, type AtlasSnapshot } from "@floor/surfaces";
import { Context, Crypto, DateTime, Effect, Layer, Option, PubSub, Ref, Schedule, Schema, Stream } from "effect";
import { Community } from "./community";
import { DistrictTiers } from "./district-tiers";
import { FloorDatabase } from "./store";

const makeAtlas = Effect.gen(function*() {
  const markets = yield* Markets;
  const db = yield* FloorDatabase;
  const crypto = yield* Crypto.Crypto;
  const community = yield* Community;
  const tiers = yield* DistrictTiers;
  const stamp = DateTime.formatIso(yield* DateTime.now);
  const recorded = yield* markets.replay(Number.MAX_SAFE_INTEGER);
  const initial: MarketSnapshot = {
    chainId: 8453,
    blockNumber: 0,
    blockHash: "",
    blockTimestamp: stamp,
    observedAt: stamp,
    source: "chain",
    markets: [],
    status: { mode: "unavailable", message: "Connecting to the Base node. No readings have arrived yet." },
  };
  const current = yield* Ref.make(Option.getOrElse(recorded, () => initial));
  yield* db.marketSlots.ensure(
    (yield* markets.getSnapshots).flatMap(snapshot => snapshot.markets.map(market => market.id)),
  );
  // Replay-one plus a bounded sliding buffer keeps slow viewers from retaining the entire live history.
  const updates = yield* PubSub.sliding<AtlasSnapshot>({ capacity: 2, replay: 1 });
  yield* Effect.addFinalizer(() => PubSub.shutdown(updates));
  const snapshot = Effect.fn("Atlas.snapshot")(
    function*(block: Option.Option<number>) {
      const selected = Option.isSome(block) ? yield* markets.replay(block.value) : Option.some(yield* Ref.get(current));
      if (Option.isNone(selected)) return yield* new ApiError({ message: "No recorded reading exists at that block." });
      const history = yield* markets.getSnapshots;
      const value: AtlasSnapshot = {
        market: selected.value,
        slots: yield* db.marketSlots.list(),
        adoptedDesigns: yield* community.adoptedAt(selected.value.blockTimestamp),
        tiers: yield* tiers.at(selected.value),
        activeMarketId: Option.getOrNull(
          chooseOrange(
            selected.value.markets.flatMap(market =>
              Option.match(Option.fromNullishOr(market.valueMovingUsd), {
                onNone: () => [],
                onSome: valueMoving => [{ id: market.id, valueMoving }],
              })
            ),
          ),
        ),
        historyBlocks: history.map(entry => ({ blockNumber: entry.blockNumber, timestamp: entry.blockTimestamp })),
        replay: Option.isSome(block),
      };
      return value;
    },
    Effect.mapError(error =>
      Schema.is(ApiError)(error) ? error : new ApiError({ message: "The recorded source block could not be read." })
    ),
  );
  const refresh = Effect.gen(function*() {
    const next = yield* markets.fetchSnapshot();
    const now = DateTime.formatIso(yield* DateTime.now);
    yield* db.sql.withTransaction(Effect.gen(function*() {
      yield* db.marketSlots.ensure(next.markets.map(market => market.id));
      for (const row of yield* db.alerts.list()) {
        const line = yield* Schema.decodeEffect(ScribedLine)(row);
        const price = Option.fromNullishOr(next.markets.find(market => market.id === line.marketId)?.priceUsd);
        if (
          !line.crossed && Option.isSome(price)
          && (line.direction === "above" ? price.value >= line.price : price.value <= line.price)
        ) {
          yield* db.alerts.update({ ...line, crossed: true });
          yield* db.events.insert({
            id: yield* crypto.randomUUIDv4,
            type: "line-crossed",
            blockNumber: next.blockNumber,
            createdAt: now,
            actor: line.owner,
            entityId: line.id,
            payload: { price: price.value, marketId: line.marketId },
          });
        }
      }
      for (const row of yield* db.receipts.list()) {
        const expired = expireReceipt(row.data, now);
        if (expired.status !== row.data.status) yield* db.receipts.update({ id: row.id, data: expired });
      }
    }));
    yield* Ref.set(current, next);
    yield* PubSub.publish(updates, yield* snapshot(Option.none()));
  });
  yield* PubSub.publish(updates, yield* snapshot(Option.none()));
  yield* refresh.pipe(
    Effect.catch(error => Effect.logWarning("Market refresh could not complete", error._tag)),
    Effect.repeat(Schedule.spaced("15 seconds")),
    Effect.forkScoped,
  );
  return { snapshot, changes: Stream.fromPubSub(updates), refresh };
});

/** @stability unstable */
export class Atlas extends Context.Service<Atlas, Effect.Success<typeof makeAtlas>>()("floor/Atlas") {
  static readonly layer = Layer.effect(Atlas, makeAtlas);
}
