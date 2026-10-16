import {
  AgentId,
  ChainRef,
  Checkpoint,
  DeskId,
  Digest,
  FloorId,
  Height,
  TradingPostId,
  WorldEventId,
  WorldId,
} from "@floor/contract/identifiers";
import { AgentLocation } from "@floor/contract/world";
import { WorldEvent, WorldEventDelivery } from "@floor/contract/world-events";
import { WorldFrame, WorldSnapshot } from "@floor/contract/world-stream";
import { allStations, assignAgent, createWorld, defaultLayout } from "@floor/world";
import { canonicalLayout, type WorldLayout } from "@floor/world/layout";
import { foldWorld } from "@floor/world/stream";
import { expect } from "bun:test";
import { Array, DateTime, Effect, Option, Result, Schema } from "effect";
import { liveScene, locationText, planView, rendererSnapshot, worldView } from "../src/map/_lib/live-world";
import { initialModel, type Model, subscriptions, update } from "../src/map/main";
import { Message } from "../src/map/message";
import { effectTest } from "./_runtime";

// A small layout fills a floor with eight desks, so nine arrivals on one chain
// occupy two floors beside a third, blueprint floor.
const chain = ChainRef.make("solana:synthetic-viewer");
const worldId = WorldId.make("synthetic-viewer-world");
const selection = Option.some({ world: worldId, chain });
const layout = { ...defaultLayout, postsPerFloor: 1, stationsPerPost: 8 };
const checkpoint = Checkpoint.make({
  chain,
  height: Height.make("1"),
  hash: Digest.make("synthetic-block"),
  time: DateTime.makeUnsafe("2026-10-16T12:00:00.000Z"),
});
const empty = WorldSnapshot.make({
  model: Result.getOrThrow(createWorld(worldId, chain, layout)),
  chain,
  sequence: 0,
  checkpoint: Option.none(),
  agents: [],
});
const agents = Array.makeBy(9, index => AgentId.make(`synthetic-agent-${index}`));
const traveller = Array.lastNonEmpty(agents);
const fields = (snapshot: typeof WorldSnapshot.Type) => ({
  id: WorldEventId.make(`event_${snapshot.sequence + 1}`),
  world: worldId,
  checkpoint,
});
const joining = (snapshot: typeof WorldSnapshot.Type, agent: AgentId) => {
  const model = Result.getOrThrow(assignAgent(snapshot.model, agent, chain));
  const desk = Option.getOrThrow(Array.findFirst(allStations(model), station => station.desk.agentId === agent));
  return WorldEvent.cases.AgentJoined.make({ ...fields(snapshot), agent, desk: desk.desk.id });
};
const atPost = AgentLocation.cases.AtPost.make({ postId: TradingPostId.make("floor_1_post_0") });
const atDesk = AgentLocation.cases.AtDesk.make({ deskId: DeskId.make("floor_1_post_0_station_0_desk") });
const move = (to: typeof AgentLocation.Type) => (snapshot: typeof WorldSnapshot.Type) =>
  WorldEvent.cases.AgentMoved.make({
    ...fields(snapshot),
    agent: traveller,
    from: Option.map(
      Array.findFirst(snapshot.model.agents, agent => agent.agentId === traveller),
      agent => agent.location,
    ),
    to,
  });
// Recorded history: arrivals, a state change, then the ninth agent walks to its
// post, to the board (which the square spiral does not position) and back.
const history = (() => {
  const frames: globalThis.Array<typeof WorldFrame.Type> = [];
  const snapshots: Array.NonEmptyArray<typeof WorldSnapshot.Type> = [empty];
  const deliver = (event: (snapshot: typeof WorldSnapshot.Type) => WorldEvent) => {
    const snapshot = Array.lastNonEmpty(snapshots);
    const next = event(snapshot);
    frames.push(WorldFrame.cases.Delivery.make({
      sequence: snapshot.sequence + 1,
      delivery: WorldEventDelivery.cases.Live.make({ event: next }),
      receipt: Option.none(),
    }));
    snapshots.push(Result.getOrThrow(foldWorld(snapshot, next)));
  };
  for (const agent of agents) deliver(snapshot => joining(snapshot, agent));
  deliver(snapshot =>
    WorldEvent.cases.AgentStateChanged.make({ ...fields(snapshot), agent: traveller, state: "researching" })
  );
  deliver(move(atPost));
  deliver(move(AgentLocation.cases.AtPlace.make({ floorId: FloorId.make("floor_1"), place: "board" })));
  deliver(move(atDesk));
  return { frames, snapshots };
})();
const at = (sequence: number) => Option.getOrThrow(Array.get(history.snapshots, sequence));
const snapshotFrame = (sequence: number) => WorldFrame.cases.Snapshot.make({ snapshot: at(sequence) });
const fold = (model: Model, frames: ReadonlyArray<typeof WorldFrame.Type>) =>
  frames.reduce((current, frame) => update(current, Message.ReceivedWorldFrame({ frame })).model, model);
const live = (model: Model) => update(model, Message.ChangedWorldConnection({ connection: "live" })).model;
const fresh = () => live(initialModel(12, Option.none(), selection));
const sameWorld = Schema.toEquivalence(Schema.Option(WorldSnapshot));
const traveller9 = (snapshot: typeof WorldSnapshot.Type) =>
  Option.getOrThrow(Array.findFirst(worldView(snapshot).desks, desk => desk.agent === traveller));
const instance = (snapshot: typeof WorldSnapshot.Type, id: number) =>
  Option.getOrThrow(Array.findFirst(rendererSnapshot(snapshot, 1).instances, item => item.id === id));

effectTest("every occupied floor and the blueprint render from the canonical layout", () =>
  Effect.sync(() => {
    const snapshot = at(9);
    const next = update(fresh(), Message.ReceivedWorldFrame({ frame: snapshotFrame(9) }));
    expect(next.model.status._tag).toBe("Opening");
    expect(next.model.desks).toBe(16);
    expect((next.commands ?? []).map(command => command.name)).toEqual(["SyncSequence"]);
    const view = worldView(snapshot);
    const plan = canonicalLayout.plan(snapshot.model);
    expect(view.floors.map(floor => [floor.index, floor.blueprint, floor.desks])).toEqual([
      [0, false, 8],
      [1, false, 1],
      [2, true, 0],
    ]);
    // Positions are the plan's, shifted so the first floor's origin is zero.
    const origin = Array.headNonEmpty(plan.floors).origin;
    const second = Option.getOrThrow(Array.get(plan.floors, 1));
    expect(Option.getOrThrow(Array.get(view.floors, 1)).focus).toEqual({
      x: second.origin.x - origin.x,
      z: second.origin.z - origin.z,
    });
    const desk = traveller9(snapshot);
    const station = Option.getOrThrow(Array.findFirst(plan.stations, item => item.agent === traveller));
    expect(desk.id).toBe(1 * 8 + 2);
    expect({ x: desk.x, z: desk.z }).toEqual({
      x: station.position.x - origin.x,
      z: station.position.z - origin.z,
    });
    const scene = liveScene(snapshot, 1);
    expect(scene.floors).toHaveLength(3);
    for (const area of scene.floors) {
      expect(scene.bounds.x0 <= area.x0 && scene.bounds.x1 >= area.x1).toBe(true);
      expect(scene.bounds.z0 <= area.z0 && scene.bounds.z1 >= area.z1).toBe(true);
    }
  }));

effectTest("deliveries fold through the Model, and replaying its frames reproduces the world", () =>
  Effect.sync(() => {
    const frames = [snapshotFrame(0), ...history.frames];
    const first = fold(fresh(), frames);
    const final = Array.lastNonEmpty(history.snapshots);
    expect(sameWorld(first.world, Option.some(final))).toBe(true);
    expect(first.worldRevision).toBe(frames.length);
    expect(subscriptions.world.modelToDependencies(first).cursor).toEqual(Option.some(final.sequence));
    // The same frames through a new Model give the same world and renderer input.
    const replayed = fold(fresh(), frames);
    expect(sameWorld(replayed.world, first.world)).toBe(true);
    expect(rendererSnapshot(Option.getOrThrow(replayed.world), 1)).toEqual(rendererSnapshot(final, 1));
    // A reconnect from a mid-history snapshot reaches the same world.
    const resumed = fold(fresh(), [snapshotFrame(10), ...history.frames.slice(10)]);
    expect(sameWorld(resumed.world, Option.some(final))).toBe(true);
  }));

effectTest("stale, repeated and invalid frames never rewind the accepted world", () =>
  Effect.sync(() => {
    const accepted = fold(fresh(), [snapshotFrame(0), ...history.frames.slice(0, 10)]);
    expect(accepted.world.pipe(Option.map(world => world.sequence))).toEqual(Option.some(10));
    // A reconnect may repeat what the Model already holds.
    for (const frame of [snapshotFrame(4), snapshotFrame(10), ...history.frames.slice(5, 10)]) {
      expect(update(accepted, Message.ReceivedWorldFrame({ frame })).model).toBe(accepted);
    }
    const gap = Option.getOrThrow(Array.get(history.frames, 11));
    const rejected = update(accepted, Message.ReceivedWorldFrame({ frame: gap })).model;
    expect(sameWorld(rejected.world, accepted.world)).toBe(true);
    expect(rejected.worldConnection).toBe("reconnecting");
    expect(rejected.worldEpoch).toBe(accepted.worldEpoch + 1);
    // Frames the old connection had already queued do not restart it again.
    expect(update(rejected, Message.ReceivedWorldFrame({ frame: gap })).model.worldEpoch).toBe(rejected.worldEpoch);
    const next = Option.getOrThrow(Array.get(history.frames, 10));
    const replay = next._tag === "Delivery"
      ? WorldFrame.cases.Delivery.make({
        ...next,
        delivery: WorldEventDelivery.cases.Replay.make({ event: next.delivery.event, recording: Digest.make("rec") }),
      })
      : next;
    const foreign = WorldFrame.cases.Snapshot.make({
      snapshot: WorldSnapshot.make({ ...at(11), model: { ...at(11).model, id: WorldId.make("synthetic-other") } }),
    });
    for (const frame of [replay, foreign]) {
      const model = update(accepted, Message.ReceivedWorldFrame({ frame })).model;
      expect(sameWorld(model.world, accepted.world)).toBe(true);
      expect(model.worldEpoch).toBe(accepted.worldEpoch + 1);
    }
  }));

effectTest("agent markers follow movement and leave the floor for unpositioned places", () =>
  Effect.sync(() => {
    const desk = traveller9(at(10));
    expect(instance(at(10), desk.id).marker).toEqual({ x: desk.x + .3, y: .05, z: desk.z + 2 });
    expect(locationText(desk)).toBe("At its desk");
    const post = Option.getOrThrow(
      Array.findFirst(canonicalLayout.plan(at(11).model).floors.flatMap(floor => floor.posts), item =>
        item.id === atPost.postId),
    );
    const origin = Array.headNonEmpty(canonicalLayout.plan(at(11).model).floors).origin;
    expect(instance(at(11), desk.id).marker).toEqual({
      x: post.anchor.x - origin.x,
      y: .05,
      z: post.anchor.z - origin.z,
    });
    expect(locationText(traveller9(at(11)))).toBe("At post floor_1_post_0");
    // The desk itself never moves.
    expect({ x: instance(at(11), desk.id).x, z: instance(at(11), desk.id).z }).toEqual({ x: desk.x, z: desk.z });
    expect("marker" in instance(at(12), desk.id)).toBe(false);
    expect(locationText(traveller9(at(12)))).toBe(
      "At the board on floor_1 · not positioned by the current layout",
    );
    expect(instance(at(13), desk.id).marker).toEqual(instance(at(10), desk.id).marker);
  }));

effectTest("floor navigation flies to a floor's focus without changing zoom or corner", () =>
  Effect.sync(() => {
    const opened = fold(fresh(), [snapshotFrame(9)]);
    const ready = update(opened, Message.SucceededMountMap({ generation: 1, renderer: "test", snapshotRevision: 1 }))
      .model;
    const flown = update(ready, Message.ClickedFloor({ floor: 1 }));
    const fly = Option.getOrThrow(Array.findFirst(flown.commands ?? [], command => command.name === "Fly"));
    const focus = Option.getOrThrow(Array.get(worldView(at(9)).floors, 1)).focus;
    expect(fly.args).toEqual({ camera: { ...ready.presentation.camera, x: focus.x, z: focus.z } });
    expect(update(ready, Message.ClickedFloor({ floor: 7 })).commands ?? []).toEqual([]);
  }));

effectTest("a reloaded page resumes from its URL sequence until the world refuses it", () =>
  Effect.sync(() => {
    const resumed = initialModel(12, Option.none(), selection, Option.some(10));
    expect(subscriptions.world.modelToDependencies(resumed).cursor).toEqual(Option.some(10));
    const accepted = fold(live(resumed), [snapshotFrame(10)]);
    expect(accepted.resume).toEqual(Option.none());
    expect(subscriptions.world.modelToDependencies(accepted).cursor).toEqual(Option.some(10));
    // A cursor the world no longer serves falls back to a fresh subscription.
    const refused = update(resumed, Message.ChangedWorldConnection({ connection: "reconnecting" })).model;
    expect(subscriptions.world.modelToDependencies(refused).cursor).toEqual(Option.none());
  }));

// A stand-in for a later layout: notched rooms, posts and desks shifted off the
// square lattice, and a board it positions. Nothing in the viewer changes.
const shift = (point: { readonly x: number; readonly z: number }) => ({ x: point.x + 3, z: point.z - 1 });
const notchedLayout: WorldLayout = {
  plan: world => {
    const plan = canonicalLayout.plan(world);
    return {
      ...plan,
      floors: Array.map(plan.floors, floor => ({
        ...floor,
        areas: floor.areas.flatMap(area => [
          { ...area, x1: (area.x0 + area.x1) / 2 },
          { ...area, x0: (area.x0 + area.x1) / 2, z1: (area.z0 + area.z1) / 2 },
        ]),
        posts: floor.posts.map(post => ({ ...post, anchor: shift(post.anchor) })),
        places: [{ place: "board" as const, position: { x: floor.origin.x - 5, z: floor.origin.z + 4 } }],
      })),
      stations: plan.stations.map(station => ({ ...station, position: shift(station.position) })),
    };
  },
};

effectTest("another layout plugs into the viewer through the plan alone", () =>
  Effect.sync(() => {
    const snapshot = at(12);
    const canonical = worldView(snapshot);
    const notched = planView(snapshot, notchedLayout);
    // Desk identities are topology, so they survive a layout change.
    expect(notched.desks.map(desk => desk.id)).toEqual(canonical.desks.map(desk => desk.id));
    for (const [index, desk] of notched.desks.entries()) {
      const before = Option.getOrThrow(Array.get(canonical.desks, index));
      expect({ x: desk.x, z: desk.z }).toEqual({ x: before.x + 3, z: before.z - 1 });
    }
    expect(notched.floors.map(floor => floor.areas.length)).toEqual([2, 2, 2]);
    // The traveller stands at the board, which this layout positions.
    const walker = Option.getOrThrow(Array.findFirst(notched.desks, desk => desk.agent === traveller));
    const origin = Array.headNonEmpty(canonicalLayout.plan(snapshot.model).floors).origin;
    const floor = Option.getOrThrow(Array.get(canonicalLayout.plan(snapshot.model).floors, 1));
    expect(walker.marker).toEqual(
      Option.some({ x: floor.origin.x - 5 - origin.x, z: floor.origin.z + 4 - origin.z }),
    );
    expect(locationText(walker)).toBe("At the board on floor_1");
    expect(Option.isNone(traveller9(snapshot).marker)).toBe(true);
    for (const area of notched.floors.flatMap(item => item.areas)) {
      expect(notched.bounds.x0 <= area.x0 && notched.bounds.x1 >= area.x1).toBe(true);
      expect(notched.bounds.z0 <= area.z0 && notched.bounds.z1 >= area.z1).toBe(true);
    }
  }));
