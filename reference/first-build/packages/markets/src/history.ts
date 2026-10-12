import { Config, Context, Effect, Layer, Option, Ref, Result, Schema } from "effect";
import { MarketRecording, MarketSnapshot } from "./types";

export class MarketHistoryError extends Schema.TaggedError<MarketHistoryError>()("MarketHistoryError", {
  operation: Schema.Literals(["read", "append", "import", "pin"]),
  message: Schema.String,
}) {}

interface MemoryHistory {
  readonly snapshots: Map<number, MarketSnapshot>;
  readonly pins: Set<number>;
}
interface HistoryService {
  readonly append: (snapshot: MarketSnapshot) => Effect.Effect<void, MarketHistoryError>;
  readonly importRecording: (recording: MarketRecording) => Effect.Effect<void, MarketHistoryError>;
  readonly snapshots: Effect.Effect<readonly MarketSnapshot[], MarketHistoryError>;
  readonly pin: (blockNumber: number) => Effect.Effect<void, MarketHistoryError>;
}

export const historyRetention = Config.schema(
  Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 10_000 })),
  "FLOOR_HISTORY_BLOCKS",
).pipe(Config.withDefault(2048));
export const snapshotJson = Schema.fromJsonString(MarketSnapshot);
// Charts are projections over retained observations; embedding every previous chart in every block grows storage quadratically.
export const observationOnly = (snapshot: MarketSnapshot): MarketSnapshot => ({
  ...snapshot,
  markets: snapshot.markets.map(market => ({ ...market, history: [] })),
});

export class MarketHistory extends Context.Service<MarketHistory, HistoryService>()("floor/MarketHistory") {
  static readonly memory = Layer.effect(
    MarketHistory,
    Effect.gen(function*() {
      const capacity = yield* historyRetention;
      const state = yield* Ref.make<MemoryHistory>({
        snapshots: new Map<number, MarketSnapshot>(),
        pins: new Set<number>(),
      });
      const compact = (current: MemoryHistory) => {
        const evict = [...current.snapshots.keys()].filter(block => !current.pins.has(block)).toSorted((a, b) => b - a)
          .slice(capacity);
        for (const block of evict) current.snapshots.delete(block);
        return current;
      };
      const append = Effect.fn("MarketHistory.memory.append")(function*(snapshot: MarketSnapshot) {
        const checked = yield* Schema.decodeEffect(MarketSnapshot)(observationOnly(snapshot)).pipe(
          Effect.mapError(() =>
            new MarketHistoryError({ operation: "append", message: "The market observation did not match its schema." })
          ),
        );
        const committed = yield* Ref.modify(
          state,
          (current): readonly [Result.Result<boolean, MarketHistoryError>, MemoryHistory] => {
            const existing = Option.fromUndefinedOr(current.snapshots.get(checked.blockNumber));
            if (current.pins.has(checked.blockNumber)) {
              return [
                Option.exists(existing, old => old.blockHash !== checked.blockHash)
                  ? Result.fail(
                    new MarketHistoryError({
                      operation: "append",
                      message: "A captured source block has a different chain hash.",
                    }),
                  )
                  : Result.succeed(true),
                current,
              ] as const;
            }
            const snapshots = new Map(current.snapshots).set(checked.blockNumber, checked);
            return [Result.succeed(true), compact({ snapshots, pins: current.pins })] as const;
          },
        );
        yield* Effect.fromResult(committed);
      });
      const importRecording = Effect.fn("MarketHistory.memory.importRecording")(function*(recording: MarketRecording) {
        const checked = yield* Schema.decodeEffect(MarketRecording)(recording).pipe(
          Effect.mapError(() =>
            new MarketHistoryError({ operation: "import", message: "The market recording did not match its schema." })
          ),
        );
        yield* Ref.update(state, current => {
          const snapshots = new Map(current.snapshots);
          for (const snapshot of checked.snapshots) {
            if (!snapshots.has(snapshot.blockNumber)) snapshots.set(snapshot.blockNumber, observationOnly(snapshot));
          }
          return compact({ snapshots, pins: current.pins });
        });
      });
      const pin = Effect.fn("MarketHistory.memory.pin")(function*(blockNumber: number) {
        const pinned = yield* Ref.modify(
          state,
          (current): readonly [Result.Result<boolean, MarketHistoryError>, MemoryHistory] =>
            current.snapshots.has(blockNumber)
              ? [Result.succeed(true), {
                snapshots: current.snapshots,
                pins: new Set(current.pins).add(blockNumber),
              }] as const
              : [
                Result.fail(
                  new MarketHistoryError({
                    operation: "pin",
                    message: "The captured source block is no longer retained.",
                  }),
                ),
                current,
              ] as const,
        );
        yield* Effect.fromResult(pinned);
      });
      return MarketHistory.of({
        append,
        importRecording,
        pin,
        snapshots: Ref.get(state).pipe(
          Effect.map(current => [...current.snapshots.values()].toSorted((a, b) => a.blockNumber - b.blockNumber)),
        ),
      });
    }),
  );
}
