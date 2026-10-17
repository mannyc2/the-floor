import { LobbyPlots, PostsPerFloor, StationsPerPost } from "@floor/contract/settings";
import { canonicalStationPosition, FloorPlace, type World } from "@floor/contract/world";
import { Array, Option, Result, Schema } from "effect";
import type { FloorPlan, PlanArea, PlanPoint, WorldLayout, WorldPlan } from "./layout";

// The seeded irregular layout proposed under the 14 Oct decision, described in
// docs/world-layout-proposal.md. It is not adopted: production reads the square
// spiral through `canonicalLayout`, and only the development world draws this.

type Point = PlanPoint;
type Rectangle = PlanArea;
type Rectangles = Array.NonEmptyReadonlyArray<Rectangle>;

// Every coordinate is an integer number of millionths of H, the nominal standing
// figure height, so construction, collision checks and ordering agree across
// engines. The clearances are provisional reservations, not approved sizes.
const unit = 1_000_000;
export const proposalDimensions = {
  unit,
  // The approved Roomy post pitch, read as a minimum rather than a repeated pitch.
  postDistance: 4_250_000,
  postEnvelope: 2_000_000,
  stationStance: 1_490_000,
  plotDistance: 1_750_000,
  plotHalfWidth: 500_000,
  routeWidth: unit,
  doorWidth: 2_000_000,
  wallThickness: 120_000,
} as const;
const { postDistance, postEnvelope, routeWidth, doorWidth, wallThickness } = proposalDimensions;
const wallHalf = wallThickness / 2;

export const ProposalSeed = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 4_294_967_295 }));
export const ProposalConfig = Schema.Struct({
  seed: ProposalSeed,
  // Rooms in creation order: every occupied floor, then the one blueprint.
  rooms: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  postsPerFloor: PostsPerFloor,
  stationsPerPost: StationsPerPost,
  lobbyPlots: LobbyPlots,
});

export interface ProposalPost {
  readonly index: number;
  readonly anchor: Point;
  readonly stations: Array.NonEmptyReadonlyArray<Point>;
}
export interface ProposalDoor {
  // The earlier room, or -1 for the lobby.
  readonly parent: number;
  readonly axis: "x" | "z";
  readonly at: number;
  readonly from: number;
  readonly to: number;
  // Clear passages on the parent's side and on this room's side of the wall.
  readonly passages: readonly [Rectangle, Rectangle];
}
export interface ProposalRoom {
  readonly index: number;
  readonly origin: Point;
  // A hall and one side wing with disjoint interiors and a shared boundary.
  readonly areas: Rectangles;
  // The reserved perimeter circulation that posts and places keep clear of.
  readonly routes: Rectangles;
  readonly posts: Array.NonEmptyReadonlyArray<ProposalPost>;
  readonly places: ReadonlyArray<{ readonly label: typeof FloorPlace.Type; readonly area: Rectangle }>;
  readonly door: ProposalDoor;
}
export interface LayoutProposal {
  readonly config: typeof ProposalConfig.Type;
  readonly lobby: {
    readonly areas: Rectangles;
    readonly routes: Rectangles;
    readonly plots: Array.NonEmptyReadonlyArray<Point>;
  };
  readonly rooms: Array.NonEmptyReadonlyArray<ProposalRoom>;
}

export class LayoutProposalError extends Schema.TaggedError<LayoutProposalError>()("LayoutProposalError", {
  reason: Schema.Literals(["invalidConfig", "noStationRing", "noPostCandidate", "noRoomCandidate"]),
  index: Schema.Int,
  cause: Schema.Defect(),
}) {}

type Edge = {
  readonly axis: "x" | "z";
  readonly at: number;
  readonly from: number;
  readonly to: number;
  readonly normal: -1 | 1;
};
type Shape = {
  readonly areas: Rectangles;
  readonly routes: Rectangles;
  readonly posts: Array.NonEmptyReadonlyArray<Point>;
  readonly places: ProposalRoom["places"];
};
type Scored<A> = { readonly value: A; readonly score: ReadonlyArray<number> };
type Body = { readonly index: number; readonly areas: Rectangles };

// A counter mixer, frozen with these rules: keying each candidate by its own
// indices means rejecting one never shifts the randomness of later placements.
const mix = (seed: number, index: number): number => {
  let value = (seed ^ Math.imul(index + 1, 0x9e3779b9)) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x85ebca6b) >>> 0;
  value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35) >>> 0;
  return (value ^ (value >>> 16)) >>> 0;
};

const cross = (a: Point, b: Point, c: Point) =>
  BigInt(b.x - a.x) * BigInt(c.z - a.z) - BigInt(b.z - a.z) * BigInt(c.x - a.x);

const hull = (points: ReadonlyArray<Point>): ReadonlyArray<Point> => {
  const sorted = points.toSorted((a, b) => a.x - b.x || a.z - b.z);
  const chain = (values: ReadonlyArray<Point>): Array<Point> => {
    const output: Array<Point> = [];
    for (const point of values) {
      while (output.length >= 2) {
        const a = Option.fromUndefinedOr(output[output.length - 2]),
          b = Option.fromUndefinedOr(output[output.length - 1]);
        if (Option.isNone(a) || Option.isNone(b) || cross(a.value, b.value, point) > 0n) break;
        output.pop();
      }
      output.push(point);
    }
    return output;
  };
  return points.length < 3 ? sorted : [...chain(sorted).slice(0, -1), ...chain(sorted.toReversed()).slice(0, -1)];
};

// Strictly outside: a point on a hull edge or vertex is inside, including the
// degenerate one- and two-point hulls.
const outside = (polygon: ReadonlyArray<Point>, point: Point) => {
  const first = Option.fromUndefinedOr(polygon[0]), second = Option.fromUndefinedOr(polygon[1]);
  if (Option.isNone(first)) return true;
  if (Option.isNone(second)) return point.x !== first.value.x || point.z !== first.value.z;
  if (polygon.length === 2) {
    return cross(first.value, second.value, point) !== 0n
      || point.x < Math.min(first.value.x, second.value.x) || point.x > Math.max(first.value.x, second.value.x)
      || point.z < Math.min(first.value.z, second.value.z) || point.z > Math.max(first.value.z, second.value.z);
  }
  return polygon.some((a, index) =>
    Option.exists(Option.fromUndefinedOr(polygon[(index + 1) % polygon.length]), b => cross(a, b, point) < 0n)
  );
};

export const proposalPointIsExterior = (points: ReadonlyArray<Point>, point: Point) => outside(hull(points), point);

const separated = (a: Point, b: Point, distance: number) => {
  const x = Math.abs(a.x - b.x), z = Math.abs(a.z - b.z);
  // After this bound, the squared products are exact safe integers even when
  // the whole exchange has coordinates large enough to require BigInt areas.
  return x >= distance || z >= distance || x * x + z * z >= distance * distance;
};

const boundsOf = (points: ReadonlyArray<Point>): Rectangle => ({
  x0: Math.min(...points.map(point => point.x)),
  z0: Math.min(...points.map(point => point.z)),
  x1: Math.max(...points.map(point => point.x)),
  z1: Math.max(...points.map(point => point.z)),
});
const areaBounds = (areas: ReadonlyArray<Rectangle>): Rectangle => ({
  x0: Math.min(...areas.map(area => area.x0)),
  z0: Math.min(...areas.map(area => area.z0)),
  x1: Math.max(...areas.map(area => area.x1)),
  z1: Math.max(...areas.map(area => area.z1)),
});

// Scores compare lexicographically, and every score ends in the candidate's own
// indices, so the order is total even when seeded tie keys collide.
const scoreLess = (left: ReadonlyArray<number>, right: ReadonlyArray<number>): boolean => {
  for (let index = 0; index < left.length; index++) {
    const a = Option.fromUndefinedOr(left[index]), b = Option.fromUndefinedOr(right[index]);
    if (Option.isSome(a) && Option.isSome(b) && a.value !== b.value) return a.value < b.value;
  }
  return false;
};
const prefer = <A>(current: Option.Option<Scored<A>>, candidate: Scored<A>): Option.Option<Scored<A>> =>
  Option.isNone(current) || scoreLess(candidate.score, current.value.score) ? Option.some(candidate) : current;

// Four cardinal displacements and eight others in the same annulus, with seeded
// lengths: no repeated pitch and no jittered rows.
const displacement = (key: number, direction: number, distance: number): Point => {
  const length = distance + key % Math.floor(distance / 2);
  switch (direction) {
    case 0:
      return { x: length, z: 0 };
    case 1:
      return { x: 0, z: length };
    case 2:
      return { x: -length, z: 0 };
    case 3:
      return { x: 0, z: -length };
    default:
      return { x: key % (2 * length + 1) - length, z: mix(key, direction) % (2 * length + 1) - length };
  }
};

// A new anchor opens outside the current hull, clear of every earlier anchor,
// and keeps the arrangement compact. Existing anchors never move. The positive-x
// displacement from an anchor of greatest x always qualifies, so the search
// cannot run dry.
const nextAnchor = (seed: number, points: Array.NonEmptyReadonlyArray<Point>, distance: number) => {
  const polygon = hull(points), bounds = boundsOf(points), index = points.length;
  let best = Option.none<Scored<Point>>();
  for (const [anchorIndex, anchor] of points.entries()) {
    for (let direction = 0; direction < 12; direction++) {
      const key = mix(seed, anchorIndex * 12 + direction);
      const vector = displacement(key, direction, distance);
      if (!separated(vector, { x: 0, z: 0 }, distance)) continue;
      const point = { x: anchor.x + vector.x, z: anchor.z + vector.z };
      if (!outside(polygon, point) || !points.every(previous => separated(previous, point, distance))) continue;
      const width = Math.max(bounds.x1, point.x) - Math.min(bounds.x0, point.x);
      const height = Math.max(bounds.z1, point.z) - Math.min(bounds.z0, point.z);
      best = prefer(best, {
        value: point,
        score: [Math.max(width, height), width + height, mix(key, index), anchorIndex, direction],
      });
    }
  }
  return best;
};

const anchors = (seed: number, count: number, distance: number) => {
  const points: [Point, ...Array<Point>] = [{ x: 0, z: 0 }];
  for (let index = 1; index < count; index++) {
    const best = nextAnchor(seed, points, distance);
    if (Option.isNone(best)) {
      return Result.fail(new LayoutProposalError({ reason: "noPostCandidate", index, cause: { seed, count } }));
    }
    points.push(best.value.value);
  }
  return Result.succeed(points);
};

const AnchorConfig = Schema.Struct({ seed: ProposalSeed, count: PostsPerFloor });
export const proposalAnchors = (seed: number, count: number) =>
  Schema.decodeResult(AnchorConfig)({ seed, count }).pipe(
    Result.mapError(cause => new LayoutProposalError({ reason: "invalidConfig", index: -1, cause })),
    Result.flatMap(config => anchors(config.seed, config.count, postDistance)),
  );

const rectangleEdges = (rectangle: Rectangle): ReadonlyArray<Edge> => [
  { axis: "x", at: rectangle.x0, from: rectangle.z0, to: rectangle.z1, normal: -1 },
  { axis: "x", at: rectangle.x1, from: rectangle.z0, to: rectangle.z1, normal: 1 },
  { axis: "z", at: rectangle.z0, from: rectangle.x0, to: rectangle.x1, normal: -1 },
  { axis: "z", at: rectangle.z1, from: rectangle.x0, to: rectangle.x1, normal: 1 },
];

// Exterior edge intervals: each rectangle edge less the boundary it shares with
// a sibling rectangle, so no separate outline has to be kept in step.
const exteriorEdges = (areas: ReadonlyArray<Rectangle>): ReadonlyArray<Edge> => {
  const edges = areas.flatMap(rectangleEdges);
  return edges.flatMap(edge => {
    let intervals = [{ from: edge.from, to: edge.to }];
    for (const other of edges) {
      if (other.axis !== edge.axis || other.at !== edge.at || other.normal === edge.normal) continue;
      intervals = intervals.flatMap(interval => {
        if (other.to <= interval.from || other.from >= interval.to) return [interval];
        return [
          ...(other.from > interval.from ? [{ from: interval.from, to: other.from }] : []),
          ...(other.to < interval.to ? [{ from: other.to, to: interval.to }] : []),
        ];
      });
    }
    return intervals.map(interval => ({ ...edge, ...interval }));
  });
};

const overlaps = (a: Rectangle, b: Rectangle) => a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1;
const shift = (rectangle: Rectangle, origin: Point): Rectangle => ({
  x0: rectangle.x0 + origin.x,
  z0: rectangle.z0 + origin.z,
  x1: rectangle.x1 + origin.x,
  z1: rectangle.z1 + origin.z,
});
const shiftAll = (areas: Rectangles, origin: Point): Rectangles => Array.map(areas, area => shift(area, origin));

const perimeterRoutes = (area: Rectangle): Rectangles => {
  const inside = { x0: area.x0 + wallHalf, x1: area.x1 - wallHalf, z0: area.z0 + wallHalf, z1: area.z1 - wallHalf };
  return [
    { ...inside, x1: inside.x0 + routeWidth },
    { ...inside, x0: inside.x1 - routeWidth },
    { ...inside, z1: inside.z0 + routeWidth },
    { ...inside, z0: inside.z1 - routeWidth },
  ];
};
// Two half-bridges join the hall's and wing's perimeter routes across the
// boundary they share.
const joinedRoutes = (hall: Rectangle, wing: Rectangle): Rectangles => {
  const at = wing.x0 === hall.x1 ? hall.x1 : hall.x0;
  const z0 = Math.floor((wing.z0 + wing.z1 - routeWidth) / 2);
  return [...perimeterRoutes(hall), ...perimeterRoutes(wing), {
    x0: at - wallHalf - routeWidth,
    x1: at,
    z0,
    z1: z0 + routeWidth,
  }, { x0: at, x1: at + wallHalf + routeWidth, z0, z1: z0 + routeWidth }];
};

// A room's hall encloses every post reservation and its perimeter route; one
// seeded side wing, 3–6H deep and 5–9H long, holds the five named places.
const roomShape = (seed: number, count: number): Result.Result<Shape, LayoutProposalError> =>
  Result.map(anchors(seed, count, postDistance), (posts): Shape => {
    const bounds = boundsOf(posts);
    const margin = postEnvelope + 2 * routeWidth;
    const hall = { x0: bounds.x0 - margin, z0: bounds.z0 - margin, x1: bounds.x1 + margin, z1: bounds.z1 + margin };
    const depth = (3 + mix(seed, 99) % 4) * unit;
    const length = Math.min(hall.z1 - hall.z0 - 2 * unit, (5 + mix(seed, 100) % 5) * unit);
    const wing = mix(seed, 101) % 2 === 0
      ? { x0: hall.x1, x1: hall.x1 + depth, z0: hall.z0 + unit, z1: hall.z0 + unit + length }
      : { x0: hall.x0 - depth, x1: hall.x0, z0: hall.z1 - unit - length, z1: hall.z1 - unit };
    // Reservations stay inside the wing's clear route, so doors added later
    // never have to pass through one.
    const usableLength = wing.z1 - wing.z0 - 2 * (routeWidth + wallHalf);
    const places = FloorPlace.literals.map((label, index) => ({
      label,
      area: {
        x0: wing.x0 + routeWidth + wallHalf + 100_000,
        x1: wing.x1 - routeWidth - wallHalf - 100_000,
        z0: wing.z0 + routeWidth + wallHalf + Math.floor(index * usableLength / 5) + 50_000,
        z1: wing.z0 + routeWidth + wallHalf + Math.floor((index + 1) * usableLength / 5) - 50_000,
      },
    }));
    return { areas: [hall, wing], routes: joinedRoutes(hall, wing), posts, places };
  });

const middle = (edge: Edge) => Math.floor((edge.from + edge.to) / 2);
const docks = (areas: ReadonlyArray<Rectangle>) =>
  exteriorEdges(areas).filter(edge => edge.to - edge.from >= doorWidth + wallThickness);
const doorPassage = (edge: Edge, direction: -1 | 1): Rectangle => {
  const into = edge.at + direction * (wallHalf + routeWidth);
  const across = { from: middle(edge) - doorWidth / 2, to: middle(edge) + doorWidth / 2 };
  return edge.axis === "x"
    ? { x0: Math.min(edge.at, into), x1: Math.max(edge.at, into), z0: across.from, z1: across.to }
    : { z0: Math.min(edge.at, into), z1: Math.max(edge.at, into), x0: across.from, x1: across.to };
};

type Dock = { readonly edge: Edge; readonly index: number };
type RoomSearch = {
  readonly index: number;
  readonly seed: number;
  readonly local: Shape;
  readonly stationOffsets: Array.NonEmptyReadonlyArray<Point>;
  readonly existingAreas: ReadonlyArray<Rectangle>;
};

const roomAt = (search: RoomSearch, origin: Point, areas: Rectangles, parent: Body, edge: Edge): ProposalRoom => ({
  index: search.index,
  origin,
  areas,
  routes: shiftAll(search.local.routes, origin),
  posts: Array.map(search.local.posts, (anchor, postIndex) => ({
    index: postIndex,
    anchor: { x: anchor.x + origin.x, z: anchor.z + origin.z },
    stations: Array.map(search.stationOffsets, offset => ({
      x: anchor.x + origin.x + offset.x,
      z: anchor.z + origin.z + offset.z,
    })),
  })),
  places: search.local.places.map(place => ({ ...place, area: shift(place.area, origin) })),
  door: {
    parent: parent.index,
    axis: edge.axis,
    at: edge.at,
    from: middle(edge) - doorWidth / 2,
    to: middle(edge) + doorWidth / 2,
    passages: [doorPassage(edge, edge.normal === 1 ? -1 : 1), doorPassage(edge, edge.normal)],
  },
});

// One integer translation per pair of facing docks, aligning their midpoints.
// Smallest exchange extent wins, then total extent, then distance from the
// lobby; the first two discourage a long corridor of rooms.
const roomCandidate = (
  search: RoomSearch,
  parent: Body,
  parentDock: Dock,
  localDock: Dock,
): Option.Option<Scored<ProposalRoom>> => {
  const parentEdge = parentDock.edge, localEdge = localDock.edge;
  if (parentEdge.axis !== localEdge.axis || parentEdge.normal === localEdge.normal) return Option.none();
  const origin = parentEdge.axis === "x"
    ? { x: parentEdge.at - localEdge.at, z: middle(parentEdge) - middle(localEdge) }
    : { x: middle(parentEdge) - middle(localEdge), z: parentEdge.at - localEdge.at };
  const areas = shiftAll(search.local.areas, origin);
  if (areas.some(area => search.existingAreas.some(previous => overlaps(area, previous)))) return Option.none();
  const bounds = areaBounds([...areas, ...search.existingAreas]);
  const width = bounds.x1 - bounds.x0, height = bounds.z1 - bounds.z0;
  return Option.some({
    value: roomAt(search, origin, areas, parent, parentEdge),
    score: [
      Math.max(width, height),
      width + height,
      Math.abs(origin.x) + Math.abs(origin.z),
      mix(search.seed, (parent.index + 1) * 1000 + parentDock.index * 32 + localDock.index),
      parent.index,
      parentDock.index,
      localDock.index,
    ],
  });
};

// The first four rooms open directly off the lobby, one per side; later rooms
// dock anywhere on the exterior.
const parentDocks = (index: number, parent: Body) => {
  const initialAxis = index % 2 === 0 ? "x" : "z", initialNormal = index < 2 ? 1 : -1;
  // Original dock indices survive the compass filter: they are part of the
  // frozen tie key, not loop bookkeeping.
  return docks(parent.areas).map((edge, dockIndex) => ({ edge, index: dockIndex })).filter(dock =>
    index >= 4 || dock.edge.axis === initialAxis && dock.edge.normal === initialNormal
  );
};

const placeRoom = (
  search: RoomSearch,
  existing: ReadonlyArray<Body>,
): Result.Result<ProposalRoom, LayoutProposalError> => {
  const localDocks = docks(search.local.areas).map((edge, dockIndex) => ({ edge, index: dockIndex }));
  let best = Option.none<Scored<ProposalRoom>>();
  for (const parent of existing.filter(body => search.index >= 4 || body.index === -1)) {
    for (const parentDock of parentDocks(search.index, parent)) {
      for (const localDock of localDocks) {
        const candidate = roomCandidate(search, parent, parentDock, localDock);
        if (Option.isSome(candidate)) best = prefer(best, candidate.value);
      }
    }
  }
  return Result.fromOption(
    Option.map(best, candidate => candidate.value),
    () => new LayoutProposalError({ reason: "noRoomCandidate", index: search.index, cause: { seed: search.seed } }),
  );
};

// The radius-2 canonical rings, scaled once to the approved 1.49H stance.
const stationRing = (count: typeof StationsPerPost.Type) =>
  Result.fromOption(
    Option.all(Array.makeBy(count, index => canonicalStationPosition(0, index, count))),
    () => new LayoutProposalError({ reason: "noStationRing", index: count, cause: count }),
  ).pipe(Result.map(ring =>
    Array.map(ring, point => ({
      x: Math.round(Math.round(point.x * unit) * 149 / 200),
      z: Math.round(Math.round(point.z * unit) * 149 / 200),
    }))
  ));

// The lobby is sized from the first four room shapes and all 32 plot positions
// before anything is placed, so later arrivals never resize it.
const makeLobby = (config: typeof ProposalConfig.Type, initialShapes: ReadonlyArray<Shape>) =>
  Result.map(anchors(mix(config.seed, 400), 32, proposalDimensions.plotDistance), plotAnchors => {
    const maximumSpan = Math.max(...initialShapes.map(local => {
      const bounds = areaBounds(local.areas);
      return Math.max(bounds.x1 - bounds.x0, bounds.z1 - bounds.z0);
    }));
    const plotBounds = boundsOf(plotAnchors);
    const plotCentre = {
      x: Math.floor((plotBounds.x0 + plotBounds.x1) / 2),
      z: Math.floor((plotBounds.z0 + plotBounds.z1) / 2),
    };
    const plots = Array.map(plotAnchors, point => ({ x: point.x - plotCentre.x, z: point.z - plotCentre.z }));
    const half = Math.max(
      Math.ceil(maximumSpan / 2) + 8 * unit,
      ...plots.flatMap(point => [Math.abs(point.x) + 3 * unit, Math.abs(point.z) + 3 * unit]),
    );
    const hall = { x0: -half, x1: half, z0: -half, z1: half };
    const wing = { x0: half, x1: half + 4 * unit, z0: -half + unit, z1: -half + 7 * unit };
    return {
      areas: [hall, wing] satisfies Rectangles,
      routes: joinedRoutes(hall, wing),
      // The whole plot plan is fixed, centred once; a world reveals a prefix.
      plots: [Array.headNonEmpty(plots), ...plots.slice(1, config.lobbyPlots)] satisfies Array.NonEmptyReadonlyArray<
        Point
      >,
    };
  });

export const createLayoutProposal = (
  input: typeof ProposalConfig.Type,
): Result.Result<LayoutProposal, LayoutProposalError> =>
  Result.gen(function*() {
    const config = yield* Schema.decodeResult(ProposalConfig)(input).pipe(
      Result.mapError(cause => new LayoutProposalError({ reason: "invalidConfig", index: -1, cause })),
    );
    const stationOffsets = yield* stationRing(config.stationsPerPost);
    const initialShapes = yield* Result.all(
      Array.makeBy(4, index => roomShape(mix(config.seed, index), config.postsPerFloor)),
    );
    const lobby = yield* makeLobby(config, initialShapes);
    const placed: Array<ProposalRoom> = [];
    for (let index = 0; index < config.rooms; index++) {
      const seed = mix(config.seed, index);
      const local = initialShapes[index] ?? (yield* roomShape(seed, config.postsPerFloor));
      const existing = [{ index: -1, areas: lobby.areas }, ...placed];
      placed.push(
        yield* placeRoom(
          { index, seed, local, stationOffsets, existingAreas: existing.flatMap(body => body.areas) },
          existing,
        ),
      );
    }
    return yield* Array.match(placed, {
      onEmpty: () => Result.fail(new LayoutProposalError({ reason: "noRoomCandidate", index: 0, cause: config })),
      onNonEmpty: rooms => Result.succeed({ config, lobby, rooms }),
    });
  });

const centre = (area: Rectangle): Point => ({ x: (area.x0 + area.x1) / 2, z: (area.z0 + area.z1) / 2 });

// The proposal as a `WorldLayout`. The World supplies topology (which floors,
// posts and stations exist and who sits where); the proposal supplies every
// position, joined by floor, post and station index. One H becomes `unitsPerH`
// plan units: the viewer draws a figure H tall.
export const proposalLayout = (options: {
  readonly seed: typeof ProposalSeed.Type;
  readonly unitsPerH: number;
}): WorldLayout => {
  const scale = (value: number) => value * options.unitsPerH / unit;
  const point = (value: Point): PlanPoint => ({ x: scale(value.x), z: scale(value.z) });
  const area = (value: Rectangle): PlanArea => ({
    x0: scale(value.x0),
    z0: scale(value.z0),
    x1: scale(value.x1),
    z1: scale(value.z1),
  });
  // A plan depends only on the configuration and room count, and snapshots of
  // one world share both, so each is generated once.
  const proposals = new Map<string, LayoutProposal>();
  const proposalFor = (world: typeof World.Type) => {
    const config = {
      seed: options.seed,
      rooms: world.floors.length,
      postsPerFloor: world.layout.postsPerFloor,
      stationsPerPost: world.layout.stationsPerPost,
      lobbyPlots: world.layout.lobbyPlots,
    };
    const key = [config.rooms, config.postsPerFloor, config.stationsPerPost, config.lobbyPlots].join("/");
    const known = proposals.get(key);
    if (known) return known;
    // Every input comes from a validated World and a decoded seed, and both
    // searches always find a candidate (see the proposal's progress arguments),
    // so a failure is a generator defect. The plan seam is synchronous and
    // total, and drawing another layout instead would misrepresent this one.
    const proposal = Result.getOrThrow(createLayoutProposal(config));
    proposals.set(key, proposal);
    return proposal;
  };
  return {
    plan: (world): WorldPlan => {
      const proposal = proposalFor(world);
      const rooms = Array.zip(world.floors, proposal.rooms);
      const floors = Array.map(rooms, ([floor, room]): FloorPlan => ({
        id: floor.id,
        index: floor.index,
        chain: floor.chain,
        blueprint: floor._tag === "BlueprintFloor",
        origin: point(room.origin),
        areas: room.areas.map(area),
        doors: room.door.passages.map(area),
        posts: Array.zip(floor.posts, room.posts).map(([post, reserved]) => ({
          id: post.id,
          index: post.index,
          anchor: point(reserved.anchor),
          open: post._tag === "OpenTradingPost",
          envelope: Option.some(scale(postEnvelope)),
        })),
        places: room.places.map(place => ({
          place: place.label,
          position: point(centre(place.area)),
          area: area(place.area),
        })),
      }));
      return {
        postPitch: Option.some(scale(postDistance)),
        floors,
        stations: rooms.flatMap(([floor, room]) =>
          Array.zip(floor.posts, room.posts).flatMap(([post, reserved]) =>
            post._tag === "BlueprintTradingPost" ? [] : Array.zip(post.stations, reserved.stations).map(
              ([station, position]) => ({
                floor: floor.index,
                post: post.index,
                station: station.index,
                desk: station.desk.id,
                agent: station.desk.agentId,
                position: point(position),
              }),
            )
          )
        ),
        lobby: {
          areas: proposal.lobby.areas.map(area),
          plots: proposal.lobby.plots.map(plot =>
            area({
              x0: plot.x - proposalDimensions.plotHalfWidth,
              z0: plot.z - proposalDimensions.plotHalfWidth,
              x1: plot.x + proposalDimensions.plotHalfWidth,
              z1: plot.z + proposalDimensions.plotHalfWidth,
            })
          ),
          // Plots and the lobby's ground are reserved, but the proposal fixes no
          // entrance or single standing point among the plots.
          places: [],
        },
      };
    },
  };
};
