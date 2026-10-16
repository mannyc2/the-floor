import {
  AgentId,
  ChainRef,
  Checkpoint,
  DeskId,
  Digest,
  ReceiptId,
  TradingPostId,
  WorldEventId,
  WorldId,
} from "@floor/contract/identifiers";
import { AgentLocation } from "@floor/contract/world";
import { WorldEvent } from "@floor/contract/world-events";
import { agentLocation, allStations, assignAgent } from "@floor/world";
import { assertReceiptEvolution, foldWorld, foldWorldEvent } from "@floor/world/stream";
import { expect, test } from "bun:test";
import { Effect, Option, Result } from "effect";
import { agent, checkpoint, emptySnapshot, receipt, settledReceipt, unknownReceipt, world } from "./_world-fixture";

const joinedModel = Result.getOrThrow(assignAgent(emptySnapshot.model, agent, checkpoint.chain));
const station = Option.getOrThrow(Option.fromNullishOr(allStations(joinedModel)[0]));
const joined = WorldEvent.cases.AgentJoined.make({
  id: WorldEventId.make("join"),
  world,
  checkpoint,
  agent,
  desk: station.desk.id,
});

test("world events allocate a desk and retain state and receipt evidence in sequence", () =>
  Effect.runPromise(Effect.gen(function*() {
    const first = yield* foldWorldEvent(emptySnapshot, joined);
    expect(first.sequence).toBe(1);
    expect(first.agents[0]?.state).toEqual(Option.none());
    const second = yield* foldWorldEvent(
      first,
      WorldEvent.cases.AgentStateChanged.make({
        id: WorldEventId.make("state"),
        world,
        checkpoint,
        agent,
        state: "researching",
      }),
    );
    const third = yield* foldWorldEvent(
      second,
      WorldEvent.cases.ReceiptLanded.make({
        id: WorldEventId.make("receipt"),
        world,
        checkpoint,
        agent,
        receipt: receipt.id,
      }),
      Option.some(receipt),
    );
    expect(third.sequence).toBe(3);
    expect(third.agents[0]?.state).toEqual(Option.some("researching"));
    expect(third.agents[0]?.receipt).toEqual(Option.some(receipt));
    expect(third.checkpoint).toEqual(Option.some(checkpoint));
    expect(allStations(third.model).map(item => item.desk.agentId)).toEqual([agent]);
  })));

test("invalid deliveries cannot advance the accepted world", () =>
  Effect.runPromise(Effect.gen(function*() {
    const state = WorldEvent.cases.AgentStateChanged.make({
      id: WorldEventId.make("state"),
      world,
      checkpoint,
      agent,
      state: "trading",
    });
    expect(Result.isFailure(yield* foldWorldEvent(emptySnapshot, state).pipe(Effect.result))).toBe(true);
    const first = yield* foldWorldEvent(emptySnapshot, joined);
    const landed = WorldEvent.cases.ReceiptLanded.make({
      id: WorldEventId.make("receipt"),
      world,
      checkpoint,
      agent,
      receipt: receipt.id,
    });
    expect(Result.isFailure(yield* foldWorldEvent(first, landed).pipe(Effect.result))).toBe(true);
    expect(Result.isFailure(yield* foldWorldEvent(first, joined).pipe(Effect.result))).toBe(true);
    expect(first.sequence).toBe(1);
    expect(first.agents[0]?.receipt).toEqual(Option.none());
  })));

test("world fold rejects foreign topology, checkpoints and receipt references", () =>
  Effect.runPromise(Effect.gen(function*() {
    for (
      const invalid of [
        WorldEvent.cases.AgentJoined.make({ ...joined, world: WorldId.make("other-world") }),
        WorldEvent.cases.AgentJoined.make({ ...joined, desk: DeskId.make("other-desk") }),
        WorldEvent.cases.AgentJoined.make({
          ...joined,
          checkpoint: Checkpoint.make({ ...checkpoint, chain: ChainRef.make("solana:other") }),
        }),
      ]
    ) {
      expect(Result.isFailure(yield* foldWorldEvent(emptySnapshot, invalid).pipe(Effect.result))).toBe(true);
    }
    const first = yield* foldWorldEvent(emptySnapshot, joined);
    const landed = WorldEvent.cases.ReceiptLanded.make({
      id: WorldEventId.make("receipt"),
      world,
      checkpoint,
      agent,
      receipt: ReceiptId.make("other-receipt"),
    });
    expect(Result.isFailure(yield* foldWorldEvent(first, landed, Option.some(receipt)).pipe(Effect.result))).toBe(true);
    expect(emptySnapshot.sequence).toBe(0);
    expect(emptySnapshot.agents).toEqual([]);
  })));

test("receipt rechecks preserve evidence and cannot undo a terminal result", () =>
  Effect.runPromise(Effect.gen(function*() {
    yield* assertReceiptEvolution(unknownReceipt, settledReceipt);
    expect(Result.isFailure(yield* assertReceiptEvolution(settledReceipt, unknownReceipt).pipe(Effect.result))).toBe(
      true,
    );
    expect(Result.isFailure(yield* assertReceiptEvolution(receipt, receipt).pipe(Effect.result))).toBe(true);
    const joinedSnapshot = yield* foldWorldEvent(emptySnapshot, joined);
    const event = WorldEvent.cases.ReceiptLanded.make({
      id: WorldEventId.make("settled"),
      world,
      checkpoint: Checkpoint.make({ ...checkpoint, hash: Digest.make("different-block") }),
      agent,
      receipt: settledReceipt.id,
    });
    expect(
      Result.isFailure(yield* foldWorldEvent(joinedSnapshot, event, Option.some(settledReceipt)).pipe(Effect.result)),
    ).toBe(true);
  })));

test("movement folds from the journal's own origin and never moves the station", () =>
  Effect.runPromise(Effect.gen(function*() {
    const first = yield* foldWorldEvent(emptySnapshot, joined);
    const atDesk = AgentLocation.cases.AtDesk.make({ deskId: station.desk.id });
    const atPost = AgentLocation.cases.AtPost.make({ postId: TradingPostId.make("floor_0_post_0") });
    const moved = WorldEvent.cases.AgentMoved.make({
      id: WorldEventId.make("move"),
      world,
      checkpoint,
      agent,
      from: Option.some(atDesk),
      to: atPost,
    });
    const second = yield* foldWorldEvent(first, moved);
    expect(second.sequence).toBe(2);
    expect(agentLocation(second.model, agent)).toEqual(Option.some(atPost));
    expect(allStations(second.model)).toEqual(allStations(first.model));
    expect(foldWorld(first, moved)).toEqual(Result.succeed(second));
    for (
      const invalid of [
        // A stale origin disagrees with the journal.
        WorldEvent.cases.AgentMoved.make({ ...moved, from: Option.some(atPost) }),
        WorldEvent.cases.AgentMoved.make({ ...moved, from: Option.none() }),
        WorldEvent.cases.AgentMoved.make({
          ...moved,
          to: AgentLocation.cases.AtPost.make({ postId: TradingPostId.make("floor_0_post_9") }),
        }),
        WorldEvent.cases.AgentMoved.make({ ...moved, agent: AgentId.make("synthetic-absent-agent") }),
      ]
    ) {
      expect(Result.isFailure(foldWorld(first, invalid))).toBe(true);
    }
    expect(Result.isFailure(foldWorld(emptySnapshot, moved))).toBe(true);
    expect(agentLocation(first.model, agent)).toEqual(Option.some(atDesk));
  })));
