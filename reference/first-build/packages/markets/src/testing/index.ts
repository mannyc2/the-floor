import { Array, Effect, Layer, Option } from "effect";
import { BaseChain, MarketRpcError } from "../base-chain";
import { MarketHistory } from "../history";
import { Markets } from "../runtime";
import type { MarketRecording } from "../types";

// This edge replays captured RPC responses. Production history, cache, normalization consumers and scopes remain intact.
export const recordedChain = (recording: MarketRecording) =>
  Layer.succeed(
    BaseChain,
    BaseChain.of({
      rpcHost: "recorded-base-edge",
      readAtBlock: Effect.fn("RecordedChain.readAtBlock")(function*(blockNumber?: number) {
        const requested = Option.fromUndefinedOr(blockNumber);
        const snapshot = yield* Effect.fromOption(Option.match(requested, {
          onNone: () => Array.last(recording.snapshots),
          onSome: block => Array.findFirst(recording.snapshots, candidate => candidate.blockNumber === block),
        })).pipe(
          Effect.mapError(() =>
            new MarketRpcError({ message: "The requested block is absent from the recorded edge." })
          ),
        );
        return {
          ...snapshot,
          source: "chain" as const,
          status: { mode: "live" as const, message: `Captured RPC response at Base block ${snapshot.blockNumber}.` },
          markets: snapshot.markets.map(market => ({
            ...market,
            reading: { ...market.reading, provenance: { ...market.reading.provenance, source: "chain" as const } },
          })),
        };
      }),
    }),
  );

export const offlineChain = Layer.succeed(
  BaseChain,
  BaseChain.of({
    rpcHost: "offline-base-edge",
    readAtBlock: () => Effect.fail(new MarketRpcError({ message: "The recorded transport is offline." })),
  }),
);

export const recordedHistory = (recording: MarketRecording) =>
  Layer.effectDiscard(Effect.flatMap(MarketHistory, history => history.importRecording(recording))).pipe(
    Layer.provideMerge(MarketHistory.memory),
  );

export const recordedMarkets = (recording: MarketRecording) =>
  Markets.layer.pipe(
    Layer.provide(recordedChain(recording)),
    Layer.provideMerge(recordedHistory(recording)),
  );
