import { WorldRpcs } from "@floor/api/world-rpc";
import { ChainRef, WorldId } from "@floor/contract/identifiers";
import { AgentLocation } from "@floor/contract/world";
import { WorldFrame, WorldSnapshot } from "@floor/contract/world-stream";
import { canonicalLayout, locate, type PlanArea, type PlanPoint, type WorldLayout } from "@floor/world/layout";
import { foldWorld } from "@floor/world/stream";
import { Array, Effect, Layer, Option, Queue, Ref, Result, Schema, Stream } from "effect";
import { RpcClient, RpcSerialization } from "effect/rpc";
import { Http } from "foldkit";
import { Message } from "../message";
import type { Camera, GroundArea, LiveScene } from "../model";

export const WorldSelection = Schema.Struct({ world: WorldId, chain: ChainRef });
export type WorldSelection = typeof WorldSelection.Type;
export const selectionFromQuery = (query: URLSearchParams) =>
  Schema.decodeUnknownOption(WorldSelection)({ world: query.get("world"), chain: query.get("chain") });
// The delivery sequence a reloaded page resumes from. An absent or malformed
// value means a fresh subscription to the current snapshot.
export const sequenceFromQuery = (query: URLSearchParams) =>
  Option.fromNullishOr(query.get("sequence")).pipe(
    Option.filter(text => text.length > 0),
    Option.flatMap(text => Schema.decodeOption(Schema.Natural)(Number(text))),
  );

type Snapshot = typeof WorldSnapshot.Type;

// Entity identity follows canonical topology slots, independent of arrival order.
// The last floor is a blueprint, so it needs no renderer allocation yet; each
// occupied floor reserves its full slot range so a join never shifts an identity.
export const deskCapacity = (snapshot: Snapshot) =>
  Math.max(1, snapshot.model.floors.length - 1) * snapshot.model.layout.postsPerFloor
  * snapshot.model.layout.stationsPerPost;

// The synthetic desk's chair faces +z; an agent at a desk stands just behind it.
// This belongs to the synthetic geometry, not to the world layout.
const deskStance = { x: .3, z: 2 };
const ground = .05;

const bounding = (areas: ReadonlyArray<GroundArea>, points: ReadonlyArray<PlanPoint>): GroundArea => {
  const xs = [...areas.flatMap(area => [area.x0, area.x1]), ...points.map(point => point.x)];
  const zs = [...areas.flatMap(area => [area.z0, area.z1]), ...points.map(point => point.z)];
  return { x0: Math.min(...xs), z0: Math.min(...zs), x1: Math.max(...xs), z1: Math.max(...zs) };
};

// Everything the viewer draws about places comes from a layout's plan. The
// viewer only shifts it so the first floor's origin is its zero, so another
// layout changes what is drawn without changing the viewer or renderer.
export const planView = (snapshot: Snapshot, layout: WorldLayout) => {
  const world = snapshot.model;
  const plan = layout.plan(world);
  const origin = Array.headNonEmpty(plan.floors).origin;
  const point = (value: PlanPoint) => ({ x: value.x - origin.x, z: value.z - origin.z });
  const area = (value: PlanArea): GroundArea => ({
    x0: value.x0 - origin.x,
    z0: value.z0 - origin.z,
    x1: value.x1 - origin.x,
    z1: value.z1 - origin.z,
  });
  const slots = world.layout.postsPerFloor * world.layout.stationsPerPost;
  // One lookup per world rather than a scan per desk: a full floor has hundreds.
  const locations = new Map(world.agents.map(agent => [agent.agentId, agent.location]));
  const records = new Map(snapshot.agents.map(agent => [agent.agent, agent]));
  const desks = plan.stations.map(station => {
    const location = Option.fromUndefinedOr(locations.get(station.agent));
    const record = Option.fromUndefinedOr(records.get(station.agent));
    const marker = Option.flatMap(location, value =>
      Option.map(locate(plan, value), position => {
        const placed = point(position);
        return value._tag === "AtDesk" ? { x: placed.x + deskStance.x, z: placed.z + deskStance.z } : placed;
      }));
    return {
      id: station.floor * slots + station.post * world.layout.stationsPerPost + station.station + 2,
      agent: station.agent,
      desk: station.desk,
      floor: station.floor,
      ...point(station.position),
      record,
      state: Option.flatMap(record, value => value.state),
      location,
      marker,
    };
  });
  const floors = plan.floors.map(floor => {
    const areas = floor.areas.map(area);
    const extent = bounding(areas, [point(floor.origin)]);
    return {
      index: floor.index,
      id: floor.id,
      chain: floor.chain,
      blueprint: floor.blueprint,
      areas,
      focus: areas.length === 0
        ? point(floor.origin)
        : { x: (extent.x0 + extent.x1) / 2, z: (extent.z0 + extent.z1) / 2 },
      desks: desks.filter(desk => desk.floor === floor.index).length,
    };
  });
  const anchors = plan.floors.flatMap(floor => [floor.origin, ...floor.posts.map(post => post.anchor)]).map(point);
  return {
    desks,
    floors,
    // Static for a mount: floors and posts never move, and markers stay among them.
    bounds: bounding(floors.flatMap(floor => floor.areas), [...anchors, ...desks]),
  };
};
export type WorldView = ReturnType<typeof planView>;
// Model snapshots are immutable, so the view, update and mount share one
// derivation per accepted world instead of re-planning on every render.
const views = new WeakMap<Snapshot, WorldView>();
export const worldView = (snapshot: Snapshot): WorldView => {
  const cached = views.get(snapshot);
  if (cached) return cached;
  const view = planView(snapshot, canonicalLayout);
  views.set(snapshot, view);
  return view;
};

export const rendererSnapshot = (snapshot: Snapshot, revision: number) => ({
  revision,
  instances: worldView(snapshot).desks.map(desk => ({
    id: desk.id,
    x: desk.x,
    y: ground,
    z: desk.z,
    active: Option.exists(desk.state, value => value === "researching" || value === "trading"),
    ...Option.match(desk.marker, {
      onNone: () => ({}),
      onSome: marker => ({ marker: { x: marker.x, y: ground, z: marker.z } }),
    }),
  })),
});

// The view describes its mount on every render, though only a new mount reads it.
const scenes = new WeakMap<Snapshot, { readonly revision: number; readonly scene: LiveScene }>();
export const liveScene = (snapshot: Snapshot, revision: number): LiveScene => {
  const cached = scenes.get(snapshot);
  if (cached?.revision === revision) return cached.scene;
  const view = worldView(snapshot);
  const scene = {
    floors: view.floors.flatMap(floor => floor.areas),
    bounds: view.bounds,
    snapshot: rendererSnapshot(snapshot, revision),
  };
  scenes.set(snapshot, { revision, scene });
  return scene;
};

const contains = (area: GroundArea, camera: Camera) =>
  camera.x >= area.x0 && camera.x <= area.x1 && camera.z >= area.z0 && camera.z <= area.z1;
export const floorInView = (view: WorldView, camera: Camera) =>
  Array.findFirst(view.floors, floor => floor.areas.some(area => contains(area, camera)));

const placeNames = {
  wallOfScreens: "wall of screens",
  bell: "bell",
  podium: "podium",
  fileRoom: "file room",
  board: "board",
} as const;
export const locationText = (desk: WorldView["desks"][number]) =>
  Option.match(desk.location, {
    onNone: () => "Location not reported",
    onSome: location => {
      const text = AgentLocation.match(location, {
        AtDesk: target => target.deskId === desk.desk ? "At its desk" : `Visiting desk ${target.deskId}`,
        AtPost: target => `At post ${target.postId}`,
        AtPlace: target => `At the ${placeNames[target.place]} on ${target.floorId}`,
        InLobby: target => target.place === "entrance" ? "At the lobby entrance" : "Among the lobby plots",
      });
      // The current layout positions no named places; the viewer says so
      // instead of drawing the agent somewhere it is not.
      return Option.isSome(desk.marker) ? text : `${text} · not positioned by the current layout`;
    },
  });

// Applies one stream frame to the Model's world. Success(None) means the frame
// is already reflected (a reconnect can repeat what was accepted); a failure
// means the stream and this Model disagree, so the viewer reconnects from its
// last accepted sequence.
export const acceptWorldFrame = (
  selection: WorldSelection,
  current: Option.Option<Snapshot>,
  frame: typeof WorldFrame.Type,
): Result.Result<Option.Option<Snapshot>, string> => {
  if (frame._tag === "Snapshot") {
    const snapshot = frame.snapshot;
    if (snapshot.model.id !== selection.world || snapshot.chain !== selection.chain) {
      return Result.fail("World snapshot does not match the requested world");
    }
    return Result.succeed(
      Option.exists(current, accepted => accepted.sequence >= snapshot.sequence)
        ? Option.none()
        : Option.some(snapshot),
    );
  }
  if (frame.delivery._tag !== "Live") return Result.fail("Replay evidence cannot enter the live viewer");
  if (Option.isNone(current)) return Result.fail("A delivery arrived before its snapshot");
  if (frame.sequence <= current.value.sequence) return Result.succeed(Option.none());
  if (frame.sequence !== current.value.sequence + 1) return Result.fail("World delivery is not contiguous");
  return foldWorld(current.value, frame.delivery.event, frame.receipt).pipe(
    Result.map(Option.some),
    Result.mapError(error => `World delivery was rejected: ${error._tag}`),
  );
};

class WorldStreamFailure extends Schema.TaggedError<WorldStreamFailure>()("WorldStreamFailure", {
  reason: Schema.String,
}) {}

const protocol = RpcClient.layerProtocolHttp({ url: "/api/world" }).pipe(
  Layer.provide([Http.layer, RpcSerialization.layerNdjson]),
);

type WorldMessage = typeof Message.ReceivedWorldFrame.Type | typeof Message.ChangedWorldConnection.Type;

// Frames go to the Model unchanged; the Model folds them and owns the cursor.
// Each connection reads that cursor, so a reconnect resumes from the last
// sequence the Model accepted rather than from what this stream last saw.
export const watchWorld = (
  selection: WorldSelection,
  restarted: boolean,
  cursor: () => Option.Option<number>,
) =>
  Stream.callback<WorldMessage>(
    queue => {
      const connect = Effect.gen(function*() {
        const announced = yield* Ref.make(false);
        const client = yield* RpcClient.make(WorldRpcs);
        yield* client.watchWorld({ ...selection, after: cursor() }).pipe(
          Stream.runForEach(frame =>
            Effect.gen(function*() {
              if (!(yield* Ref.getAndSet(announced, true))) {
                yield* Queue.offer(queue, Message.ChangedWorldConnection({ connection: "live" }));
              }
              yield* Queue.offer(queue, Message.ReceivedWorldFrame({ frame }));
            })
          ),
        );
        return yield* new WorldStreamFailure({ reason: "World stream ended" });
      }).pipe(
        Effect.scoped,
        Effect.catch(error => Effect.logWarning("World stream disconnected", error)),
        // Each reconnect owns its HTTP client and request fibers.
        // oxlint-disable-next-line effecttsgo/strict-effect-provide -- The subscription connection is the browser fetch composition boundary.
        Effect.provide(protocol),
      );
      const reconnecting = connect.pipe(
        // A quiet HTTP stream may not fail immediately when the browser loses
        // its network. Release it on offline so stale evidence is labelled and
        // the next connection resumes from the last accepted sequence.
        Effect.raceFirst(Stream.fromEventListener(window, "offline").pipe(Stream.runHead)),
        Effect.andThen(Queue.offer(queue, Message.ChangedWorldConnection({ connection: "reconnecting" }))),
        Effect.andThen(Effect.sleep("1 second")),
        Effect.forever,
      );
      // A Model that rejected a frame restarts the stream; pausing first keeps
      // a persistently invalid world from reconnecting in a tight loop.
      return restarted ? Effect.sleep("1 second").pipe(Effect.andThen(reconnecting)) : reconnecting;
    },
    // Frames are deliveries, not replaceable samples, so none may be dropped.
    { bufferSize: 32, strategy: "suspend" },
  );
