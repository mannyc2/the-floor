import { AgentId, ChainRef, FloorId, WorldId } from "@floor/contract/identifiers";
import { AgentLocation, FloorPlace, type World } from "@floor/contract/world";
import { assignAgent, createWorld, defaultLayout } from "@floor/world";
import { canonicalLayout, locate, type PlanArea, type PlanPoint, type WorldPlan } from "@floor/world/layout";
import {
  createLayoutProposal,
  type LayoutProposal,
  proposalAnchors,
  proposalDimensions,
  proposalLayout,
  proposalPointIsExterior,
} from "@floor/world/proposal";
import { expect, test } from "bun:test";
import { Array, Option, Result } from "effect";

// The checker below never calls the generator's edge, hull or collision
// helpers, so a bug in one cannot validate itself.
type Plan = LayoutProposal;
type Rectangle = PlanArea;
type Point = PlanPoint;
type Room = Plan["rooms"][number];
type Body = {
  readonly index: number;
  readonly areas: ReadonlyArray<Rectangle>;
  readonly routes: ReadonlyArray<Rectangle>;
};
const { unit, postDistance, postEnvelope, stationStance, routeWidth, doorWidth, plotDistance, plotHalfWidth } =
  proposalDimensions;
const make = (seed: number, floors = 12, postsPerFloor = 6, stationsPerPost = 10, lobbyPlots = 8): Plan =>
  Result.getOrThrow(createLayoutProposal({ seed, rooms: floors + 1, postsPerFloor, stationsPerPost, lobbyPlots }));

const intersection = (left: Rectangle, right: Rectangle) => ({
  width: Math.min(left.x1, right.x1) - Math.max(left.x0, right.x0),
  height: Math.min(left.z1, right.z1) - Math.max(left.z0, right.z0),
});
const contains = (area: Rectangle, point: Point, margin = 0) =>
  point.x - margin >= area.x0 && point.x + margin <= area.x1
  && point.z - margin >= area.z0 && point.z + margin <= area.z1;
const distanceSquared = (left: Point, right: Point) => BigInt(left.x - right.x) ** 2n + BigInt(left.z - right.z) ** 2n;
const side = (a: Point, b: Point, c: Point) =>
  BigInt(b.x - a.x) * BigInt(c.z - a.z) - BigInt(b.z - a.z) * BigInt(c.x - a.x);
const disjoint = (left: Rectangle, right: Rectangle) => {
  const overlap = intersection(left, right);
  return overlap.width <= 0 || overlap.height <= 0;
};

const verifyRoutes = (routes: ReadonlyArray<Rectangle>) => {
  // Positive-width contact establishes a continuous strip, including the
  // lobby-to-wing transition, without treating corner-only contact as access.
  const reached = new Set([0]);
  for (let pass = 0; pass < routes.length; pass++) {
    for (const [index, route] of routes.entries()) {
      if (
        routes.some((other, otherIndex) => {
          const contact = intersection(route, other);
          return reached.has(otherIndex) && contact.width >= 0 && contact.height >= 0
            && Math.max(contact.width, contact.height) >= unit;
        })
      ) reached.add(index);
    }
  }
  expect(reached.size).toBe(routes.length);
};

const passagesFor = (plan: Plan, index: number) =>
  plan.rooms.flatMap(room =>
    room.index === index
      ? [room.door.passages[1]]
      : room.door.parent === index
      ? [room.door.passages[0]]
      : []
  );

const verifyBody = (body: Body, earlier: ReadonlyArray<Body>) => {
  verifyRoutes(body.routes);
  for (const route of body.routes) {
    expect(route.x1 - route.x0).toBeGreaterThanOrEqual(routeWidth);
    expect(route.z1 - route.z0).toBeGreaterThanOrEqual(routeWidth);
    expect(body.areas.some(area =>
      area.x0 <= route.x0 && area.x1 >= route.x1
      && area.z0 <= route.z0 && area.z1 >= route.z1
    )).toBe(true);
  }
  for (const area of [...body.areas, ...body.routes]) {
    expect(Object.values(area).every(Number.isSafeInteger)).toBe(true);
    expect(area.x1).toBeGreaterThan(area.x0);
    expect(area.z1).toBeGreaterThan(area.z0);
  }
  for (const [areaIndex, area] of body.areas.entries()) {
    for (const previous of body.areas.slice(0, areaIndex)) expect(disjoint(area, previous)).toBe(true);
  }
  for (const previous of earlier) {
    for (const area of body.areas) {
      for (const other of previous.areas) expect(disjoint(area, other)).toBe(true);
    }
  }
};

const verifyDoor = (room: Room, roomRoutes: ReadonlyArray<Rectangle>, bodies: ReadonlyArray<Body>) => {
  expect(room.door.parent).toBeLessThan(room.index);
  expect(room.door.parent).toBeGreaterThanOrEqual(-1);
  if (room.index < 4) expect(room.door.parent).toBe(-1);
  expect(room.door.to - room.door.from).toBe(doorWidth);
  const parent = Option.getOrThrow(Option.fromUndefinedOr(bodies.find(body => body.index === room.door.parent)));
  const midpoint = room.door.axis === "x"
    ? { x: room.door.at, z: (room.door.from + room.door.to) / 2 }
    : { x: (room.door.from + room.door.to) / 2, z: room.door.at };
  for (const end of [room.door.from, room.door.to]) {
    const point = room.door.axis === "x" ? { x: room.door.at, z: end } : { x: end, z: room.door.at };
    expect(parent.areas.some(area => contains(area, point))).toBe(true);
    expect(room.areas.some(area => contains(area, point))).toBe(true);
    expect(parent.routes.some(route => contains(route, point))).toBe(true);
    expect(roomRoutes.some(route => contains(route, point))).toBe(true);
  }
  expect(parent.routes.some(route => contains(route, midpoint))).toBe(true);
  expect(roomRoutes.some(route => contains(route, midpoint))).toBe(true);
};

const verifyPlaces = (room: Room, roomRoutes: ReadonlyArray<Rectangle>) => {
  expect(room.places.map(place => place.label)).toEqual([...FloorPlace.literals]);
  for (const [index, place] of room.places.entries()) {
    expect(room.areas.some(area =>
      area.x0 <= place.area.x0 && area.x1 >= place.area.x1
      && area.z0 <= place.area.z0 && area.z1 >= place.area.z1
    )).toBe(true);
    for (const route of [...roomRoutes, ...room.places.slice(0, index).map(previous => previous.area)]) {
      expect(disjoint(place.area, route)).toBe(true);
    }
  }
};

const verifyPostClearance = (anchor: Point, areas: ReadonlyArray<Rectangle>) => {
  for (const area of areas) {
    const closest = {
      x: Math.max(area.x0, Math.min(area.x1, anchor.x)),
      z: Math.max(area.z0, Math.min(area.z1, anchor.z)),
    };
    expect(distanceSquared(closest, anchor)).toBeGreaterThanOrEqual(BigInt(postEnvelope) ** 2n);
  }
};

const verifyPosts = (plan: Plan, room: Room, roomRoutes: ReadonlyArray<Rectangle>) => {
  expect(room.posts).toHaveLength(plan.config.postsPerFloor);
  for (const [index, post] of room.posts.entries()) {
    expect(post.index).toBe(index);
    expect(room.areas.some(area => contains(area, post.anchor, postEnvelope))).toBe(true);
    for (const previous of room.posts.slice(0, index)) {
      expect(distanceSquared(post.anchor, previous.anchor)).toBeGreaterThanOrEqual(BigInt(postDistance) ** 2n);
    }
    expect(post.stations).toHaveLength(plan.config.stationsPerPost);
    for (const station of post.stations) {
      expect(Number.isSafeInteger(station.x) && Number.isSafeInteger(station.z)).toBe(true);
      const radialError = distanceSquared(station, post.anchor) - BigInt(stationStance) ** 2n;
      expect(radialError < 0n ? -radialError : radialError).toBeLessThan(4_000_000n);
    }
    verifyPostClearance(post.anchor, roomRoutes);
    verifyPostClearance(post.anchor, room.places.map(place => place.area));
  }
};

const verifyPlots = (plan: Plan) => {
  expect(plan.lobby.plots).toHaveLength(plan.config.lobbyPlots);
  for (const [index, plot] of plan.lobby.plots.entries()) {
    expect(plan.lobby.areas.some(area => contains(area, plot, plotHalfWidth))).toBe(true);
    for (const previous of plan.lobby.plots.slice(0, index)) {
      expect(distanceSquared(previous, plot)).toBeGreaterThanOrEqual(BigInt(plotDistance) ** 2n);
    }
    const footprint = {
      x0: plot.x - plotHalfWidth,
      x1: plot.x + plotHalfWidth,
      z0: plot.z - plotHalfWidth,
      z1: plot.z + plotHalfWidth,
    };
    for (const route of [...plan.lobby.routes, ...passagesFor(plan, -1)]) expect(disjoint(footprint, route)).toBe(true);
  }
};

const verify = (plan: Plan) => {
  expect(plan.rooms).toHaveLength(plan.config.rooms);
  const bodies = [{ index: -1, areas: plan.lobby.areas, routes: plan.lobby.routes }, ...plan.rooms].map(body => ({
    ...body,
    routes: [...body.routes, ...passagesFor(plan, body.index)],
  }));
  for (const [index, body] of bodies.entries()) verifyBody(body, bodies.slice(0, index));
  for (const room of plan.rooms) {
    const roomRoutes = [...room.routes, ...passagesFor(plan, room.index)];
    verifyDoor(room, roomRoutes, bodies);
    verifyPlaces(room, roomRoutes);
    verifyPosts(plan, room, roomRoutes);
  }
  verifyPlots(plan);
};

test("seeded room plans preserve doors, circulation, reservations and station geometry", () => {
  for (const seed of [0, 1, 7, 42, 116, 20261014, 0x7fffffff, 0xffffffff]) verify(make(seed));
});

test("the production configuration places ten floors and a blueprint for many seeds", () => {
  // Ten default floors are the most the viewer draws.
  for (const seed of [0, 3, 20261014, 0xffffffff]) verify(make(seed, 10, 40, 10, 8));
}, 60000);

test("new rooms leave earlier room records and lobby anchors unchanged", () => {
  for (const seed of [0, 7, 20261014, 0xffffffff]) {
    const full = make(seed);
    for (const floors of [1, 4, 8]) {
      const prefix = make(seed, floors);
      expect(prefix.lobby).toEqual(full.lobby);
      expect([...prefix.rooms]).toEqual(full.rooms.slice(0, floors + 1));
    }
  }
});

test("capacity extremes and every station count retain the layout invariants", () => {
  for (const stations of [8, 9, 10, 11, 12]) verify(make(42, 1, 1, stations, 32));
  verify(make(42, 1, 128, 12, 32));
  verify(make(0xffffffff, 12, 40, 10, 8));
}, 120000);

test("every post capacity 1 through 128 preserves the generated anchor prefix", () => {
  const complete = Result.getOrThrow(proposalAnchors(42, 128));
  for (let count = 1; count <= 128; count++) {
    expect([...Result.getOrThrow(proposalAnchors(42, count))]).toEqual(complete.slice(0, count));
  }
}, 120000);

test("every added post has a strict separating line from the previous occupied hull", () => {
  const points = Result.getOrThrow(proposalAnchors(42, 128));
  for (const [offset, point] of points.slice(1).entries()) {
    const previous = points.slice(0, offset + 1);
    // Enumerate supporting lines directly instead of repeating the generator's
    // monotone-hull construction.
    const outsideAxisBounds = point.x < Math.min(...previous.map(value => value.x))
      || point.x > Math.max(...previous.map(value => value.x))
      || point.z < Math.min(...previous.map(value => value.z))
      || point.z > Math.max(...previous.map(value => value.z));
    const separatedByEdge = previous.some((a, first) =>
      previous.slice(first + 1).some(b => {
        const pointSide = side(a, b, point);
        return pointSide !== 0n && previous.every(other => side(a, b, other) * pointSide <= 0n);
      })
    );
    expect(outsideAxisBounds || separatedByEdge).toBe(true);
  }
}, 120000);

test("point and segment hulls reject their boundary and interior", () => {
  const start = { x: 0, z: 0 }, end = { x: 10 * unit, z: 0 };
  expect(proposalPointIsExterior([start], start)).toBe(false);
  expect(proposalPointIsExterior([start], end)).toBe(true);
  for (const points of [[start, end], [start, { x: 5 * unit, z: 0 }, end]]) {
    for (const point of [start, end, { x: 5 * unit, z: 0 }]) {
      expect(proposalPointIsExterior(points, point)).toBe(false);
    }
    for (const point of [{ x: -1, z: 0 }, { x: 10 * unit + 1, z: 0 }, { x: 5 * unit, z: 1 }]) {
      expect(proposalPointIsExterior(points, point)).toBe(true);
    }
  }
});

test("every lobby plot count keeps the irregular full-capacity prefix and lobby unchanged", () => {
  const complete = make(20261014, 1, 1, 8, 32);
  for (let count = 1; count <= 32; count++) {
    const smaller = make(20261014, 1, 1, 8, count);
    expect(smaller.lobby.areas).toEqual(complete.lobby.areas);
    expect(smaller.lobby.routes).toEqual(complete.lobby.routes);
    expect([...smaller.lobby.plots]).toEqual(complete.lobby.plots.slice(0, count));
  }
  expect(new Set(complete.lobby.plots.map(plot => plot.x)).size).toBeGreaterThan(8);
  expect(new Set(complete.lobby.plots.map(plot => plot.z)).size).toBeGreaterThan(8);
});

test("independent geometry checks reject broken doors, post separation and route connectivity", () => {
  const baseline = make(42, 1);
  verify(baseline);
  const first = baseline.rooms[0];
  expect(() =>
    verify({
      ...baseline,
      rooms: [{ ...first, door: { ...first.door, at: first.door.at + unit } }, ...baseline.rooms.slice(1)],
    })
  ).toThrow();
  expect(() =>
    verify({
      ...baseline,
      rooms: [
        { ...first, posts: [first.posts[0], { ...first.posts[0], index: 1 }, ...first.posts.slice(2)] },
        ...baseline.rooms.slice(1),
      ],
    })
  ).toThrow();
  const isolated = { x0: 0, z0: 0, x1: unit, z1: unit };
  expect(() => verifyRoutes([isolated, { x0: unit, z0: unit, x1: 2 * unit, z1: 2 * unit }])).toThrow();
  expect(() => verify({ ...baseline, lobby: { ...baseline.lobby, routes: [isolated, ...baseline.lobby.routes] } }))
    .toThrow();
});

test("changing the seed changes geometry without changing declared capacities", () => {
  const first = make(7, 4), second = make(116, 4);
  expect(first.rooms.map(room => room.posts)).not.toEqual(second.rooms.map(room => room.posts));
  expect(first.rooms.map(room => room.areas)).not.toEqual(second.rooms.map(room => room.areas));
  expect(first.rooms.map(room => room.posts.length)).toEqual(second.rooms.map(room => room.posts.length));
});

test("unsupported inputs fail at the Schema boundary", () => {
  expect(Result.isFailure(proposalAnchors(7, 0))).toBe(true);
  expect(Result.isFailure(proposalAnchors(7, 129))).toBe(true);
  expect(Result.isFailure(proposalAnchors(-1, 8))).toBe(true);
  const valid = { seed: 7, rooms: 5, postsPerFloor: 6, stationsPerPost: 10, lobbyPlots: 8 };
  for (
    const patch of [
      { seed: -1 },
      { seed: 0x100000000 },
      { seed: .5 },
      { rooms: 0 },
      { postsPerFloor: 0 },
      { postsPerFloor: 129 },
      { stationsPerPost: 7 },
      { stationsPerPost: 13 },
      { lobbyPlots: 0 },
      { lobbyPlots: 33 },
    ]
  ) {
    const result = createLayoutProposal({ ...valid, ...patch });
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) expect(result.failure.reason).toBe("invalidConfig");
  }
});

// The WorldLayout contract the viewer relies on, through the same seam as the
// square spiral: topology from the World, positions from the proposal.
const chain = ChainRef.make("solana:proposal");
const small = { ...defaultLayout, postsPerFloor: 3, stationsPerPost: 8 };
const grow = (arrivals: number, from = Result.getOrThrow(createWorld(WorldId.make("proposal"), chain, small))) =>
  Array.range(from.agents.length, from.agents.length + arrivals - 1).reduce(
    (world, index) => Result.getOrThrow(assignAgent(world, AgentId.make(`agent_${index}`), chain)),
    from,
  );
const layout = proposalLayout({ seed: 20261014, unitsPerH: 2 });
const floorAreas = (plan: WorldPlan) => [...plan.floors.flatMap(floor => floor.areas), ...plan.lobby.areas];
const strictlyInside = (areas: ReadonlyArray<Rectangle>, point: Point) =>
  areas.some(area => point.x > area.x0 && point.x < area.x1 && point.z > area.z0 && point.z < area.z1);

const identities = (plan: WorldPlan) => ({
  floors: plan.floors.map(floor => [floor.id, floor.index, floor.chain, floor.blueprint]),
  posts: plan.floors.map(floor => floor.posts.map(post => [post.id, post.index, post.open])),
  stations: plan.stations.map(station => [station.floor, station.post, station.station, station.desk, station.agent]),
});

test("the proposal plans the same topology and identities as the square spiral", () => {
  // Two full floors and a third partly occupied, beside a blueprint.
  const world = grow(2 * 24 + 5);
  const proposed = layout.plan(world), canonical = canonicalLayout.plan(world);
  expect(identities(proposed)).toEqual(identities(canonical));
  expect(proposed.stations).toHaveLength(53);
  expect(new Set(proposed.stations.map(station => `${station.position.x},${station.position.z}`)).size).toBe(53);
  expect(proposed.floors.at(-1)?.blueprint).toBe(true);
  // Every floor reserves the five named places and has one incoming door.
  for (const floor of proposed.floors) {
    expect(floor.places.map(place => place.place)).toEqual([...FloorPlace.literals]);
    expect(floor.doors).toHaveLength(2);
    expect(floor.posts.every(post => Option.isSome(post.envelope))).toBe(true);
  }
  expect(proposed.lobby.plots).toHaveLength(small.lobbyPlots);
  expect(proposed.lobby.places).toEqual([]);
});

test("proposal grounds never overlap and hold their posts, stations, places and plots", () => {
  const world = grow(2 * 24 + 5);
  const plan = layout.plan(world);
  const areas = floorAreas(plan);
  for (const [index, area] of areas.entries()) {
    expect(areas.slice(index + 1).every(other => disjoint(area, other))).toBe(true);
  }
  for (const floor of plan.floors) {
    for (const post of floor.posts) expect(strictlyInside(floor.areas, post.anchor)).toBe(true);
    for (const place of floor.places) {
      expect(strictlyInside(floor.areas, place.position)).toBe(true);
      expect(place.position.x).toBeCloseTo((place.area.x0 + place.area.x1) / 2, 9);
      expect(place.position.z).toBeCloseTo((place.area.z0 + place.area.z1) / 2, 9);
    }
    // A door's passages lie on both sides of the wall it crosses.
    const passages = Array.map(floor.doors, door => ({ x: (door.x0 + door.x1) / 2, z: (door.z0 + door.z1) / 2 }));
    expect(passages).toHaveLength(2);
    const outer = Option.getOrThrow(Array.get(passages, 0)), inner = Option.getOrThrow(Array.get(passages, 1));
    expect(strictlyInside(floor.areas, inner)).toBe(true);
    expect(!strictlyInside(floor.areas, outer) && strictlyInside(areas, outer)).toBe(true);
  }
  for (const station of plan.stations) {
    const floor = Option.getOrThrow(Array.get(plan.floors, station.floor));
    expect(strictlyInside(floor.areas, station.position)).toBe(true);
  }
  for (const plot of plan.lobby.plots) {
    expect(
      plan.lobby.areas.some(area =>
        area.x0 <= plot.x0 && area.x1 >= plot.x1 && area.z0 <= plot.z0 && area.z1 >= plot.z1
      ),
    ).toBe(true);
  }
});

test("proposal positions stay fixed as agents arrive and floors are added", () => {
  let world = grow(1);
  let previous = layout.plan(world);
  for (const arrivals of [7, 16, 1, 24, 30]) {
    world = grow(arrivals, world);
    const plan = layout.plan(world);
    expect(plan.floors.length).toBeGreaterThanOrEqual(previous.floors.length);
    expect(plan.lobby).toEqual(previous.lobby);
    for (const [index, before] of previous.floors.entries()) {
      const after = Option.getOrThrow(Array.get(plan.floors, index));
      expect({ ...after, chain: before.chain, blueprint: before.blueprint, posts: [] }).toEqual({
        ...before,
        posts: [],
      });
      expect(after.posts.map(post => post.anchor)).toEqual(before.posts.map(post => post.anchor));
    }
    for (const station of previous.stations) {
      expect(plan.stations.find(item => item.desk === station.desk)?.position).toEqual(station.position);
    }
    previous = plan;
  }
  expect(previous.floors.length).toBe(5);
});

test("interleaved chains open rooms by floor index and never move an earlier one", () => {
  // One eight-station post per floor forces a room for almost every arrival.
  const second = ChainRef.make("eip155:proposal");
  const config = { ...defaultLayout, postsPerFloor: 1, stationsPerPost: 8 };
  let world = Result.getOrThrow(createWorld(WorldId.make("interleaved"), chain, config));
  let previous = layout.plan(world);
  for (let index = 0; index < 80; index++) {
    const arriving = index % 3 === 0 ? second : chain;
    world = Result.getOrThrow(assignAgent(world, AgentId.make(`interleaved_${index}`), arriving));
    const plan = layout.plan(world);
    expect(plan.floors.filter(floor => floor.blueprint)).toHaveLength(1);
    expect(plan.floors.map(floor => [floor.areas, floor.doors, floor.places]).slice(0, previous.floors.length))
      .toEqual(previous.floors.map(floor => [floor.areas, floor.doors, floor.places]));
    for (const station of previous.stations) {
      expect(plan.stations.find(item => item.desk === station.desk)?.position).toEqual(station.position);
    }
    expect(plan.stations).toHaveLength(index + 1);
    previous = plan;
  }
});

test("the proposal positions named places on its floors and scales by the chosen unit", () => {
  const world = grow(9);
  const plan = layout.plan(world);
  const board = AgentLocation.cases.AtPlace.make({ floorId: FloorId.make("floor_0"), place: "board" });
  const reserved = Option.getOrThrow(
    Array.findFirst(Option.getOrThrow(Array.head(plan.floors)).places, place => place.place === "board"),
  );
  expect(locate(plan, board)).toEqual(Option.some(reserved.position));
  // The square spiral has no rule for named places, so the same location is unplaced.
  expect(Option.isNone(locate(canonicalLayout.plan(world), board))).toBe(true);
  expect(Option.isNone(locate(plan, AgentLocation.cases.InLobby.make({ place: "plots" })))).toBe(true);
  const doubled = proposalLayout({ seed: 20261014, unitsPerH: 4 }).plan(world);
  expect(doubled.stations.map(station => station.position)).toEqual(
    plan.stations.map(station => ({ x: station.position.x * 2, z: station.position.z * 2 })),
  );
  expect(doubled.floors.map(floor => floor.posts.map(post => post.envelope))).toEqual(
    plan.floors.map(floor => floor.posts.map(() => Option.some(postEnvelope / unit * 4))),
  );
});

test("the seed changes the proposal's positions but not its identities", () => {
  const world: typeof World.Type = grow(30);
  const first = layout.plan(world), second = proposalLayout({ seed: 7, unitsPerH: 2 }).plan(world);
  expect(second.stations.map(station => station.desk)).toEqual(first.stations.map(station => station.desk));
  expect(second.stations.map(station => station.position)).not.toEqual(first.stations.map(station => station.position));
});
