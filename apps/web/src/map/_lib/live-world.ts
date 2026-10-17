import { WorldRpcs } from "@floor/api/world-rpc";
import { figureHeight } from "@floor/atlas/proportions";
import { ChainRef, WorldId } from "@floor/contract/identifiers";
import { AgentLocation } from "@floor/contract/world";
import { WorldFrame, WorldSnapshot } from "@floor/contract/world-stream";
import { canonicalLayout, locate, type PlanArea, type PlanPoint, type WorldLayout } from "@floor/world/layout";
import { foldWorld } from "@floor/world/stream";
import { Array, Effect, Layer, Option, Queue, Ref, Result, Schema, Stream } from "effect";
import { RpcClient, RpcSerialization } from "effect/rpc";
import { Http } from "foldkit";
import { Message } from "../message";
import { type Camera, type GroundArea, type LiveScene, postKeys } from "../model";
import { postLayout, type TraderKind, traderKinds, traderPlaces, traderReach, traderStates } from "./live-layout";

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
// Post slots cover the desk capacity's floors and the blueprint beyond them,
// so they change exactly when the desk capacity does and a mount's allocation
// holds every post its world can show. A first arrival turns a lone blueprint
// into an occupied floor and a new blueprint without changing either.
export const postCapacity = (snapshot: Snapshot) =>
  (Math.max(1, snapshot.model.floors.length - 1) + 1) * snapshot.model.layout.postsPerFloor;

const bounding = (areas: ReadonlyArray<GroundArea>, points: ReadonlyArray<PlanPoint>): GroundArea => {
  const xs = [...areas.flatMap(area => [area.x0, area.x1]), ...points.map(point => point.x)];
  const zs = [...areas.flatMap(area => [area.z0, area.z1]), ...points.map(point => point.z)];
  return { x0: Math.min(...xs), z0: Math.min(...zs), x1: Math.max(...xs), z1: Math.max(...zs) };
};

// A stable, unbiased spread of an agent's id: its jacket and where it stands
// when it visits a post. FNV-1a, so every viewer derives the same values.
const spread = (text: string) => {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  return hash >>> 0;
};
// Visitors crowd the aisle just outside a post's seated ring, as the picked
// floor's crowds do, at one of three depths so a busy post's crowd thickens;
// a desk's visitor stands behind its occupant's shoulder.
const crowdDepth = .32;
const visitorRadius = postLayout.counterEdge + traderReach.standing + .12;

// A placed thing on the ground plane: where it stands and the yaw that turns
// its +Z (a station's trader side, a figure's front) the way it faces.
export interface Placement {
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
}
// Where an agent's figure is and what kind of place that is; the renderer's
// crowd chooses how it looks there.
export interface Stance extends Placement {
  readonly kind: TraderKind;
  readonly place: number;
}
const stance = (placement: Placement, kind: TraderKind, place = 0): Stance => ({ ...placement, kind, place });

// Which way a named place's furniture backs: away from the rest of its room,
// toward the outer wall of the wing that holds it.
const facingOf = (place: GroundArea, areas: ReadonlyArray<GroundArea>) => {
  const x = (place.x0 + place.x1) / 2, z = (place.z0 + place.z1) / 2;
  const holder = areas.find(area => x >= area.x0 && x <= area.x1 && z >= area.z0 && z <= area.z1);
  const rest = areas.filter(area => area !== holder);
  const box = holder ?? place;
  const other = rest.length > 0 ? bounding(rest, []) : box;
  const away = { x: (box.x0 + box.x1 - other.x0 - other.x1) / 2, z: (box.z0 + box.z1 - other.z0 - other.z1) / 2 };
  return Math.abs(away.x) >= Math.abs(away.z) ? (away.x >= 0 ? Math.PI / 2 : -Math.PI / 2) : away.z >= 0 ? 0 : Math.PI;
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
  // The layout's closest posts are drawn at the live floor's pitch, close
  // enough that their crowds meet; a layout without one draws H at the Atlas
  // figure height.
  const unitsPerH = Option.match(plan.postPitch, {
    onNone: () => figureHeight,
    onSome: pitch => pitch / postLayout.pitch,
  });
  const ring = (anchor: PlanPoint, bearing: number, radius: number, turn: number): Placement => ({
    x: anchor.x + Math.sin(bearing) * radius * unitsPerH,
    z: anchor.z + Math.cos(bearing) * radius * unitsPerH,
    yaw: bearing + turn,
  });
  const slots = world.layout.postsPerFloor * world.layout.stationsPerPost;
  const slotsPerPost = world.layout.stationsPerPost;
  const postSlot = (floor: number, post: number) => floor * world.layout.postsPerFloor + post;
  const anchors = new Map(
    plan.floors.flatMap(floor =>
      floor.posts.map(post => [postSlot(floor.index, post.index), point(post.anchor)] as const)
    ),
  );
  const openPosts = new Map(
    plan.floors.flatMap(floor =>
      floor.posts.filter(post => post.open).map(post => [post.id, point(post.anchor)] as const)
    ),
  );
  // A station keeps its plan position's bearing from its post. The kit sets
  // the radii: the counter edge where the station sits, the stool where its
  // agent sits, so a station never meets its post under any layout or scale.
  const stations = new Map(plan.stations.map(station => {
    const anchor = Option.getOrElse(
      Option.fromUndefinedOr(anchors.get(postSlot(station.floor, station.post))),
      () => point(station.position),
    );
    const at = point(station.position);
    const bearing = Math.atan2(at.x - anchor.x, at.z - anchor.z);
    return [station.desk, { anchor, bearing }] as const;
  }));
  const places = new Map(plan.floors.flatMap(floor =>
    floor.places.map(place => {
      const reserved = area(place.area);
      return [`${floor.id}/${place.place}`, {
        place: place.place,
        area: reserved,
        facing: facingOf(reserved, floor.areas.map(area)),
        built: !floor.blueprint,
      }] as const;
    })
  ));
  // One lookup per world rather than a scan per desk: a full floor has hundreds.
  const locations = new Map(world.agents.map(agent => [agent.agentId, agent.location]));
  const records = new Map(snapshot.agents.map(agent => [agent.agent, agent]));
  const desks = plan.stations.map(station => {
    const location = Option.fromUndefinedOr(locations.get(station.agent));
    const record = Option.fromUndefinedOr(records.get(station.agent));
    const own = Option.fromUndefinedOr(stations.get(station.desk));
    const hash = spread(station.agent);
    // Seated at its own desk; standing beside another desk, in another post's
    // crowd, at a named place or in the lobby.
    const marker = Option.flatMap(location, (value): Option.Option<Stance> =>
      AgentLocation.match(value, {
        AtDesk: target =>
          Option.map(Option.fromUndefinedOr(stations.get(target.deskId)), at =>
            target.deskId === station.desk
              ? stance(ring(at.anchor, at.bearing, postLayout.counterEdge + traderReach.seated, Math.PI), "seat")
              : stance(
                ring(
                  at.anchor,
                  at.bearing + (hash % 2 === 0 ? 1 : -1) * Math.PI / slotsPerPost * .62,
                  visitorRadius,
                  Math.PI,
                ),
                "visit",
              )),
        AtPost: target =>
          Option.map(Option.fromUndefinedOr(openPosts.get(target.postId)), anchor => {
            const gap = hash % slotsPerPost + .5;
            const depth = Math.floor(hash / slotsPerPost) % 3;
            return stance(
              ring(
                anchor,
                Math.PI / 2 + gap * Math.PI * 2 / slotsPerPost,
                postLayout.crowd + depth * crowdDepth,
                Math.PI,
              ),
              "post",
            );
          }),
        AtPlace: target =>
          Option.map(Option.fromUndefinedOr(places.get(`${target.floorId}/${target.place}`)), place => {
            // Several agents at one place spread across its reservation.
            const spreadX = ((hash % 7) / 6 - .5) * .5, spreadZ = ((Math.floor(hash / 7) % 5) / 4 - .5) * .5;
            return stance(
              {
                x: (place.area.x0 + place.area.x1) / 2 + spreadX * (place.area.x1 - place.area.x0),
                z: (place.area.z0 + place.area.z1) / 2 + spreadZ * (place.area.z1 - place.area.z0),
                yaw: place.facing,
              },
              "place",
              traderPlaces.indexOf(place.place),
            );
          }),
        InLobby: () => Option.map(locate(plan, value), position => stance({ ...point(position), yaw: 0 }, "lobby")),
      }));
    return {
      id: station.floor * slots + station.post * world.layout.stationsPerPost + station.station + 2,
      agent: station.agent,
      desk: station.desk,
      floor: station.floor,
      ...point(station.position),
      station: Option.map(own, at => ring(at.anchor, at.bearing, postLayout.counterEdge, 0)),
      seed: hash,
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
  const lobby = plan.lobby.areas.map(area);
  const posts = plan.floors.flatMap(floor =>
    floor.posts.map(post => ({ slot: postSlot(floor.index, post.index), open: post.open, ...point(post.anchor) }))
  );
  return {
    unitsPerH,
    desks,
    floors,
    lobby,
    posts,
    doors: plan.floors.flatMap(floor => floor.doors.map(area)),
    // A blueprint floor's places are reserved but not yet furnished.
    places: [...places.values()].flatMap(({ built, ...place }) => built ? [place] : []),
    plots: plan.lobby.plots.map(area),
    // Static for a mount: floors and posts never move, and markers stay among them.
    bounds: bounding(
      [...floors.flatMap(floor => floor.areas), ...lobby],
      [...plan.floors.map(floor => point(floor.origin)), ...posts, ...desks],
    ),
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

// Every desk, figure and post the renderer places. A desk's station turns to
// face its trader; a figure stands in the pose its location asks for, in its
// agent's jacket; a post is drawn open or as an unbuilt footprint.
// The renderer's instance snapshot, as the deferred renderer decodes it. A
// type alias, not an interface, so it remains plain JSON.
export type RendererInstance = {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw?: number;
  readonly active?: boolean;
  readonly marker?: {
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly yaw: number;
    readonly kind: number;
    readonly state: number;
    readonly place: number;
    readonly seed: number;
  };
};
export type RendererSnapshot = { readonly revision: number; readonly instances: ReadonlyArray<RendererInstance> };
export const rendererSnapshot = (snapshot: Snapshot, revision: number): RendererSnapshot => {
  const view = worldView(snapshot);
  return {
    revision,
    instances: [
      ...view.desks.flatMap(desk =>
        Option.toArray(Option.map(desk.station, station => ({
          id: desk.id,
          x: station.x,
          y: 0,
          z: station.z,
          yaw: station.yaw,
          active: Option.exists(desk.state, value => value === "researching" || value === "trading"),
          ...Option.match(desk.marker, {
            onNone: () => ({}),
            onSome: marker => ({
              marker: {
                x: marker.x,
                y: 0,
                z: marker.z,
                yaw: marker.yaw,
                kind: traderKinds.indexOf(marker.kind),
                state: Option.match(desk.state, { onNone: () => 0, onSome: value => traderStates.indexOf(value) }),
                place: marker.place,
                seed: desk.seed,
              },
            }),
          }),
        })))
      ),
      ...view.posts.map(post => ({
        id: (post.open ? postKeys.open : postKeys.blueprint) + post.slot,
        x: post.x,
        y: 0,
        z: post.z,
      })),
    ],
  };
};

// The view describes its mount on every render, though only a new mount reads it.
const scenes = new WeakMap<Snapshot, { readonly revision: number; readonly scene: LiveScene }>();
export const liveScene = (snapshot: Snapshot, revision: number): LiveScene => {
  const cached = scenes.get(snapshot);
  if (cached?.revision === revision) return cached.scene;
  const view = worldView(snapshot);
  const scene = {
    unitsPerH: view.unitsPerH,
    stationsPerPost: snapshot.model.layout.stationsPerPost,
    monitorsPerPost: snapshot.model.layout.monitorsPerPost,
    posts: postCapacity(snapshot),
    rooms: view.floors.map(floor => ({ areas: floor.areas, blueprint: floor.blueprint })),
    lobby: view.lobby,
    doors: view.doors,
    places: view.places,
    plots: view.plots,
    postAnchors: view.posts.map(post => ({ x: post.x, z: post.z })),
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
      // Where the layout positions no such place, the viewer says so instead
      // of drawing the agent somewhere it is not.
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
