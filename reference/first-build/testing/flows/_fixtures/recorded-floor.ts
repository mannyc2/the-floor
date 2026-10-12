import { BunServices } from "@effect/platform-bun";
import { MarketHistory, type MarketRecording, Markets, recordingJson } from "@floor/markets";
import { Context, Effect, FileSystem, Layer, Schema } from "effect";
import { recordedChain } from "../../../packages/markets/src/testing";
import { Atlas } from "../../../packages/server/src/atlas";
import { Community } from "../../../packages/server/src/community";
import { DistrictTiers } from "../../../packages/server/src/district-tiers";
import { TokenHolders } from "../../../packages/server/src/holder-evidence";
import { databaseLayer } from "../../../packages/server/src/sqlite-store";

export class CapturedDay extends Context.Service<CapturedDay, MarketRecording>()("flow/CapturedDay") {}

// The transport reads captured Base responses. Atlas, SQLite migrations, history, layout authority and polling are real services.
/** @stability unstable */
export const recordedFloor = Layer.unwrap(Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const recording = yield* Schema.decodeEffect(recordingJson)(
    yield* fs.readFileString("testing/recordings/base-day.json"),
  );
  const history = Layer.effectDiscard(Effect.flatMap(MarketHistory, store => store.importRecording(recording))).pipe(
    Layer.provideMerge(databaseLayer(":memory:")),
  );
  const markets = Markets.layer.pipe(Layer.provide(recordedChain(recording)), Layer.provideMerge(history));
  return Layer.mergeAll(
    Atlas.layer.pipe(
      Layer.provideMerge(Community.layer.pipe(Layer.provide(TokenHolders.unavailable))),
      Layer.provideMerge(DistrictTiers.layer),
      Layer.provideMerge(markets),
    ),
    Layer.succeed(CapturedDay, recording),
  );
})).pipe(Layer.provide(BunServices.layer));
