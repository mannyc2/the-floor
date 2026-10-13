import { expect, test } from "bun:test";
import { Effect, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";
import { AssetRef, Digest } from "../src/identifiers.ts";
import { WorldEvent, WorldEventDelivery } from "../src/world-events.ts";
import { expectPassed, roundTrip, runTest } from "./_runtime.ts";

const eventArbitrary = Arbitrary.schema(Schema.Union([
  WorldEvent.cases.AgentJoined,
  WorldEvent.cases.AgentMoved,
  WorldEvent.cases.AgentStateChanged,
  WorldEvent.cases.ReceiptLanded,
  WorldEvent.cases.CommonsPublished,
  WorldEvent.cases.BoardPostPublished,
  WorldEvent.cases.PieceWentLive,
  WorldEvent.cases.TokenLaunched,
  WorldEvent.cases.SettingChanged,
])).pipe(Arbitrary.map((event) => {
  if (event._tag !== "TokenLaunched") return event;
  const assetSuffix = event.token.slice(event.token.indexOf("/") + 1);
  return WorldEvent.cases.TokenLaunched.make({
    ...event,
    token: AssetRef.make(`${event.checkpoint.chain}/${assetSuffix}`),
  });
}));

test("world events preserve checkpoint and immutable record references through JSON", () =>
  runTest(
    Arbitrary.checkEffect(eventArbitrary, (event) => roundTrip(WorldEvent, event), {
      seed: "world-event-contract",
      runs: 256,
      size: 8,
    }).pipe(Effect.tap(expectPassed)),
  ));

test("events cannot drop their checkpoint and replay deliveries retain a recording label", () =>
  runTest(
    Arbitrary.checkEffect(eventArbitrary, (event) =>
      Effect.gen(function*() {
        const { checkpoint: _checkpoint, ...withoutCheckpoint } = event;
        expect(Schema.is(WorldEvent)(withoutCheckpoint)).toBe(false);
        const live = WorldEventDelivery.cases.Live.make({ event });
        const replay = WorldEventDelivery.cases.Replay.make({ event, recording: Digest.make("recording-1") });
        return (yield* roundTrip(WorldEventDelivery, live)) && (yield* roundTrip(WorldEventDelivery, replay));
      }), { seed: "world-event-evidence", runs: 128, size: 6 }).pipe(Effect.tap(expectPassed)),
  ));

test("a launched token cannot be recorded against another chain's checkpoint", () =>
  runTest(
    Arbitrary.checkEffect(Arbitrary.schema(WorldEvent.cases.TokenLaunched), (event) => {
      const otherChain = event.checkpoint.chain === "eip155:1" ? "eip155:2" : "eip155:1";
      return !Schema.is(WorldEvent)({ ...event, token: AssetRef.make(`${otherChain}/token:launch`) });
    }, { seed: "launch-chain-evidence", runs: 128, size: 6 }).pipe(Effect.tap(expectPassed)),
  ));
