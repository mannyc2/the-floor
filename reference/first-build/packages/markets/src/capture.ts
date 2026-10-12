import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Array, Console, DateTime, Effect, FileSystem, Schema } from "effect";
import { Layer } from "effect";
import { Argument, Command } from "effect/cli";
import { MarketHistory } from "./history";
import { marketLayer, Markets, recordingJson } from "./runtime";
import type { MarketRecording } from "./types";

const capture = Command.make(
  "capture-markets",
  {
    destination: Argument.String("destination").pipe(Argument.withDefault("testing/recordings/base-day.json")),
    hours: Argument.Int("hours").pipe(
      Argument.withSchema(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 168 }))),
      Argument.withDefault(24),
    ),
  },
  Effect.fn("Markets.capture")(function*({ destination, hours }) {
    const markets = yield* Markets;
    const fs = yield* FileSystem.FileSystem;
    const latest = yield* markets.fetchAtBlock();
    yield* Console.log(`Capturing ${latest.markets.length} pools through Base block ${latest.blockNumber}`);
    const historical = yield* Effect.forEach(
      hours === 0 ? [] : Array.makeBy(hours, index => hours - index),
      hour => markets.fetchAtBlock(latest.blockNumber - hour * 1800),
      { concurrency: 1 },
    );
    const recording: MarketRecording = {
      version: 1,
      description:
        "Direct eth_call readings at explicit Base blocks, sampled hourly. Token metadata comes from the same contracts. No interpolated trades or prices.",
      capturedAt: DateTime.formatIso(yield* DateTime.now),
      rpcHost: markets.rpcHost,
      snapshots: [...historical, latest].map(snapshot => ({
        ...snapshot,
        source: "recording",
        status: { mode: "recording", message: `Recorded Base block ${snapshot.blockNumber}` },
        markets: snapshot.markets.map(market => ({
          ...market,
          history: [],
          reading: { ...market.reading, provenance: { ...market.reading.provenance, source: "recording" } },
        })),
      })),
    };
    yield* fs.writeFileString(destination, yield* Schema.encodeEffect(recordingJson)(recording));
    yield* Console.log(`Saved ${recording.snapshots.length} snapshots to ${destination}`);
  }),
);

capture.pipe(
  Command.run({ version: "1.0.0" }),
  Effect.provide([marketLayer().pipe(Layer.provide(MarketHistory.memory)), BunServices.layer]),
  BunRuntime.runMain,
);
