import { Array, Cache, Context, DateTime, Effect, Exit, Layer, Option, Result, Schema } from "effect";
import { BaseChain, type BaseChainOptions, MarketRpcError } from "./base-chain";
import { MarketHistory, type MarketHistoryError } from "./history";
import { MarketRecording, type MarketSnapshot, type PricePoint, withMarketHistory } from "./types";

export type MarketRuntimeOptions = BaseChainOptions;
interface MarketService {
  readonly fetchSnapshot: (force?: boolean) => Effect.Effect<MarketSnapshot, MarketRpcError | MarketHistoryError>;
  readonly fetchAtBlock: (block?: number) => Effect.Effect<MarketSnapshot, MarketRpcError | MarketHistoryError>;
  readonly getHistory: (marketId: string) => Effect.Effect<readonly PricePoint[], MarketHistoryError>;
  readonly replay: (block: number) => Effect.Effect<Option.Option<MarketSnapshot>, MarketHistoryError>;
  readonly getSnapshots: Effect.Effect<readonly MarketSnapshot[], MarketHistoryError>;
  readonly rpcHost: string;
}
const marketHistory = (snapshots: readonly MarketSnapshot[], marketId: string): readonly PricePoint[] => {
  const byBlock = new Map<number, PricePoint>();
  for (const snapshot of snapshots) {
    const market = snapshot.markets.find(item => item.id === marketId);
    if (market) {
      byBlock.set(snapshot.blockNumber, {
        blockNumber: snapshot.blockNumber,
        timestamp: snapshot.blockTimestamp,
        price: market.reading.price,
        source: snapshot.source,
      });
    }
  }
  return [...byBlock.values()].toSorted((a, b) => a.blockNumber - b.blockNumber);
};
const recordedSnapshot = (
  snapshot: MarketSnapshot,
  all: readonly MarketSnapshot[],
  message: string,
): MarketSnapshot => ({
  ...snapshot,
  source: "recording",
  status: { mode: "recording", message },
  markets: snapshot.markets.map(market => ({
    ...market,
    reading: { ...market.reading, provenance: { ...market.reading.provenance, source: "recording" } },
    history: Array.filterMap(marketHistory(all, market.id), point =>
      point.blockNumber <= snapshot.blockNumber
        ? Result.succeed({ ...point, source: "recording" as const })
        : Result.failVoid),
  })),
});
const makeMarkets = Effect.gen(function*() {
  const chain = yield* BaseChain;
  const historyStore = yield* MarketHistory;
  const getHistory = Effect.fn("Markets.getHistory")(function*(marketId: string) {
    return marketHistory(yield* historyStore.snapshots, marketId);
  });
  const fetchAtBlock = Effect.fn("Markets.fetchAtBlock")(function*(at?: number) {
    const reading = yield* chain.readAtBlock(at);
    const all = yield* historyStore.snapshots;
    const cutoff = Option.map(
      DateTime.make(reading.blockTimestamp),
      stamp => DateTime.toEpochMillis(stamp) - 86_400_000,
    );
    const enriched = reading.markets.map(market => {
      const history = marketHistory(all, market.id).filter(point => point.blockNumber <= reading.blockNumber);
      // A shorter retained window cannot support a 24-hour claim; hourly captures may bracket it by at most one hour.
      const start = Option.flatMap(
        cutoff,
        target =>
          Array.findLast(history, point =>
            Option.exists(DateTime.make(point.timestamp), stamp => {
              const age = target - DateTime.toEpochMillis(stamp);
              return age >= 0 && age <= 3_600_000;
            })),
      );
      const change = Option.flatMap(
        start,
        point => point.price > 0 ? Option.some((market.reading.price / point.price - 1) * 100) : Option.none(),
      );
      return withMarketHistory(market, history, change);
    });
    const snapshot = { ...reading, markets: enriched };
    // Durability precedes both the response and Atlas publication.
    yield* historyStore.append(snapshot);
    return snapshot;
  });
  const fallback = Effect.fn("Markets.fallback")(function*(error: MarketRpcError) {
    const retained = yield* historyStore.snapshots;
    return yield* Option.match(Array.last(retained), {
      onNone: () => Effect.fail(error),
      onSome: snapshot =>
        Effect.succeed(
          recordedSnapshot(
            snapshot,
            retained,
            `Recorded Base state from ${snapshot.blockTimestamp}. Live RPC is unavailable.`,
          ),
        ),
    });
  });
  const snapshotCache = yield* Cache.makeWith(() => fetchAtBlock().pipe(Effect.catchTag("MarketRpcError", fallback)), {
    capacity: 1,
    timeToLive: exit => Exit.isSuccess(exit) ? "15 seconds" : "0 seconds",
  });
  const fetchSnapshot = Effect.fn("Markets.fetchSnapshot")(function*(force: boolean = false) {
    if (force) {
      yield* Cache.invalidate(snapshotCache, "latest");
    }
    return yield* Cache.get(snapshotCache, "latest");
  });
  const replay = Effect.fn("Markets.replay")(function*(block: number) {
    const all = yield* historyStore.snapshots;
    const candidate = Array.last(
      all.filter(snapshot => snapshot.blockNumber <= block).toSorted((a, b) => a.blockNumber - b.blockNumber),
    );
    return Option.map(
      candidate,
      snapshot => recordedSnapshot(snapshot, all, `Replay at Base block ${snapshot.blockNumber}.`),
    );
  });
  return Markets.of({
    fetchSnapshot,
    fetchAtBlock,
    getHistory,
    replay,
    getSnapshots: historyStore.snapshots,
    rpcHost: chain.rpcHost,
  });
});

export class Markets extends Context.Service<Markets, MarketService>()("floor/Markets") {
  static readonly layer = Layer.effect(Markets, makeMarkets);
}

export const marketLayer = (options: MarketRuntimeOptions = {}) =>
  Markets.layer.pipe(Layer.provide(BaseChain.layer(options)));
export const decodeRecording = Schema.decodeUnknownEffect(MarketRecording);
export const recordingJson = Schema.fromJsonString(MarketRecording);
export type MarketRuntime = MarketService;
