import { BunFileSystem } from "@effect/platform-bun";
import { Context, Effect, FileSystem, Layer, Ref, Schema } from "effect";
import { BaseChain, MarketHistory, type MarketRecording, MarketRpcError, Markets, recordingJson } from "../../src";

export class RecordedDay extends Context.Service<RecordedDay, MarketRecording>()("test/markets/RecordedDay") {}
export class ChainCalls extends Context.Service<ChainCalls, Ref.Ref<number>>()("test/markets/ChainCalls") {}

// Only the external chain reader is substituted. History, fallback, cache ownership and codecs are production implementations.
export const recordedMarkets = Layer.effectContext(Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const recording = yield* Schema.decodeEffect(recordingJson)(
    yield* fs.readFileString("testing/recordings/base-day.json"),
  );
  const calls = yield* Ref.make(0);
  const offline = BaseChain.of({
    rpcHost: "offline-fixture",
    readAtBlock: () =>
      Ref.update(calls, count => count + 1).pipe(
        Effect.andThen(new MarketRpcError({ message: "Fixture transport unavailable" })),
      ),
  });
  const markets = yield* Layer.build(
    Layer.unwrap(Effect.gen(function*() {
      yield* (yield* MarketHistory).importRecording(recording);
      return Markets.layer;
    })).pipe(Layer.provide(Layer.succeed(BaseChain, offline)), Layer.provide(MarketHistory.memory)),
  );
  return Context.add(Context.add(markets, RecordedDay, recording), ChainCalls, calls);
})).pipe(Layer.provide(BunFileSystem.layer));
