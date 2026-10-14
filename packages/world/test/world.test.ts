import {
  AgentId,
  AssetRef,
  ChainRef,
  DeskId,
  FloorId,
  OwnerId,
  PlotId,
  TradingPostId,
  WorldId,
} from "@floor/contract/identifiers";
import {
  AgentLocation,
  AgentPlacement,
  BlueprintFloor,
  BlueprintTradingPost,
  canonicalFloorOrigin,
  canonicalPostAnchor,
  canonicalStationPosition,
  Desk,
  DeskPlot,
  Floor,
  FloorPlace,
  LobbyPlot,
  OpenFloor,
  OpenTradingPost,
  Plot,
  Station,
  TradingPost,
  World,
  WorldChangeError,
  WorldLayoutConfig,
  WorldPoint,
  WorldValidationError,
} from "@floor/contract/world";
import {
  agentLocation,
  allPlots,
  allStations,
  assignAgent,
  assignPlot,
  createWorld as tryCreateWorld,
  defaultLayout,
  moveAgent,
} from "@floor/world";
import { expect, test } from "bun:test";
import { Arbitrary, Array, Effect, Option, Result, Schema } from "effect";
import { expectPassed, roundTrip, runTest } from "./_runtime";

const createWorld = (...args: Parameters<typeof tryCreateWorld>) => Result.getOrThrow(tryCreateWorld(...args));

const checkRoundTrips = <A, I>(schema: Schema.Codec<A, I>) =>
  Arbitrary.checkEffect(Arbitrary.schema(schema), value => roundTrip(schema, value), {
    seed: 1701,
    runs: 40,
    size: 8,
  }).pipe(Effect.map(expectPassed));

test("all spatial contract types round trip generated values through JSON", () =>
  runTest(Effect.gen(function*() {
    yield* checkRoundTrips(WorldPoint);
    yield* checkRoundTrips(WorldLayoutConfig);
    yield* checkRoundTrips(DeskPlot);
    yield* checkRoundTrips(LobbyPlot);
    yield* checkRoundTrips(Plot);
    yield* checkRoundTrips(Desk);
    yield* checkRoundTrips(Station);
    yield* checkRoundTrips(BlueprintTradingPost);
    yield* checkRoundTrips(OpenTradingPost);
    yield* checkRoundTrips(TradingPost);
    yield* checkRoundTrips(BlueprintFloor);
    yield* checkRoundTrips(OpenFloor);
    yield* checkRoundTrips(Floor);
    yield* checkRoundTrips(FloorPlace);
    yield* checkRoundTrips(AgentLocation);
    yield* checkRoundTrips(AgentPlacement);
    yield* checkRoundTrips(WorldChangeError);
  })));

const AllocationScenario = Schema.Struct({
  worldId: WorldId,
  chain: ChainRef,
  config: WorldLayoutConfig.mapFields(fields => ({
    ...fields,
    postsPerFloor: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 4 })),
  })),
  agents: Schema.NonEmptyArray(AgentId).check(Schema.isMaxLength(64), Schema.isUnique()),
});

test("generated arrival sequences preserve desks and fill posts, floors and blueprints deterministically", () =>
  runTest(
    Arbitrary.checkEffect(Arbitrary.schema(AllocationScenario), scenario =>
      Effect.gen(function*() {
        let world = createWorld(scenario.worldId, scenario.chain, scenario.config);
        for (const agent of scenario.agents) {
          const previous = world;
          const result = assignAgent(world, agent, scenario.chain);
          if (Result.isFailure(result)) return false;
          world = result.success;
          if (!Schema.is(World)(world)) return false;
          if (!Schema.toEquivalence(World)(world, Result.getOrThrow(assignAgent(previous, agent, scenario.chain)))) {
            return false;
          }
          const stations = allStations(world);
          if (stations.length !== world.agents.length) return false;
          if (
            !allStations(previous).every(station =>
              Option.exists(
                Array.findFirst(stations, current => current.id === station.id),
                current => Schema.toEquivalence(Station)(station, current),
              )
            )
          ) return false;
          if (world.agents.length !== previous.agents.length + 1) return false;
          const openFloors = world.floors.filter(floor => floor._tag === "OpenFloor");
          if (
            openFloors.length
              !== Math.ceil(world.agents.length / (scenario.config.postsPerFloor * scenario.config.stationsPerPost))
          ) return false;
          const actualOpenPosts = openFloors.flatMap(floor => floor.posts).filter(post =>
            post._tag === "OpenTradingPost"
          );
          if (actualOpenPosts.length !== Math.ceil(world.agents.length / scenario.config.stationsPerPost)) return false;
          if (Option.isNone(agentLocation(world, agent))) return false;
        }
        return yield* roundTrip(World, world);
      }), { seed: 1702, runs: 80, size: 64 }).pipe(Effect.map(expectPassed)),
  ));

test("default capacity opens the forty-first post on the next floor and retains the original chain", () => {
  let world = createWorld(WorldId.make("floor"), ChainRef.make("solana:mainnet"));
  for (let index = 0; index < 401; index++) {
    world = Result.getOrThrow(assignAgent(world, AgentId.make(`agent_${index}`), ChainRef.make("solana:mainnet")));
  }
  expect(Schema.is(World)(world)).toBe(true);
  expect(allStations(world)).toHaveLength(401);
  expect(world.floors.map(floor => floor._tag)).toEqual(["OpenFloor", "OpenFloor", "BlueprintFloor"]);
  expect(world.floors.map(floor => floor.chain)).toEqual(Array.makeBy(3, () => ChainRef.make("solana:mainnet")));
  expect(defaultLayout).toEqual({ stationsPerPost: 10, postsPerFloor: 40, monitorsPerPost: 7, lobbyPlots: 8 });
});

test("new chains and overflow only add floors at later indices, leaving existing floors in place", () => {
  const first = ChainRef.make("solana:mainnet");
  const second = ChainRef.make("eip155:1");
  let world = createWorld(WorldId.make("floor"), first, { ...defaultLayout, postsPerFloor: 1, stationsPerPost: 8 });
  world = Result.getOrThrow(assignAgent(world, AgentId.make("second"), second));
  const secondFloor = Array.headNonEmpty(world.floors);
  for (let index = 0; index < 9; index++) {
    world = Result.getOrThrow(assignAgent(world, AgentId.make(`first_${index}`), first));
  }
  expect(Array.headNonEmpty(world.floors)).toEqual(secondFloor);
  expect(world.floors.map(floor => floor.chain)).toEqual([second, first, first, first]);
  expect(world.floors.map(floor => floor.index)).toEqual([0, 1, 2, 3]);
  expect(Schema.is(World)(world)).toBe(true);
});

test("fixed anchors are unique, grow outwards and keep stations clear of neighbouring posts", () => {
  const world = createWorld(WorldId.make("anchors"), ChainRef.make("solana:mainnet"), {
    ...defaultLayout,
    postsPerFloor: 128,
  });
  const anchors = Array.headNonEmpty(world.floors).posts.map(post => post.anchor);
  expect(Array.dedupe(anchors.map(point => `${point.x},${point.z}`))).toHaveLength(128);
  for (const [index, point] of anchors.entries()) {
    const previousAnchor = Array.get(anchors, index - 1);
    if (Option.isNone(previousAnchor)) continue;
    const previous = previousAnchor.value;
    expect(Math.max(Math.abs(point.x), Math.abs(point.z))).toBeGreaterThanOrEqual(
      Math.max(Math.abs(previous.x), Math.abs(previous.z)),
    );
    for (const other of anchors.slice(0, index)) {
      expect(Math.hypot(point.x - other.x, point.z - other.z)).toBeGreaterThanOrEqual(8);
    }
  }
});

// Footprints are squares one pitch wide, so two floors overlap exactly when
// their origins are less than a pitch apart along both axes.
const chebyshev = (a: typeof WorldPoint.Type, b: typeof WorldPoint.Type) =>
  Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
const manhattan = (a: typeof WorldPoint.Type, b: typeof WorldPoint.Type) => Math.abs(a.x - b.x) + Math.abs(a.z - b.z);
const lobby = { x: 0, z: 0 };

test("floors open off the lobby first, share a wall with an earlier floor and never overlap", () => {
  const chain = ChainRef.make("solana:mainnet");
  const config = { ...defaultLayout, postsPerFloor: 1, stationsPerPost: 8 };
  let world = createWorld(WorldId.make("plan"), chain, config);
  // Fills three rings of floors around the lobby, plus the next blueprint.
  for (let index = 0; index < 48 * config.stationsPerPost; index++) {
    world = Result.getOrThrow(assignAgent(world, AgentId.make(`agent_${index}`), chain));
  }
  const origins = Array.map(world.floors, floor => floor.origin);
  const pitch = Array.headNonEmpty(origins).x;
  expect(origins).toHaveLength(49);
  expect(origins.slice(0, 4).every(origin => manhattan(origin, lobby) === pitch)).toBe(true);
  for (const [index, origin] of origins.entries()) {
    expect(chebyshev(origin, lobby)).toBeGreaterThanOrEqual(pitch);
    const earlier = [lobby, ...origins.slice(0, index)];
    expect(earlier.every(other => chebyshev(origin, other) >= pitch)).toBe(true);
    expect(earlier.some(other => manhattan(origin, other) === pitch)).toBe(true);
    if (index > 0) {
      expect(chebyshev(origin, lobby)).toBeGreaterThanOrEqual(chebyshev(Array.getUnsafe(origins, index - 1), lobby));
    }
  }
});

test("every post count leaves an aisle between a floor's posts and its footprint's edge", () => {
  for (const postsPerFloor of Array.range(1, 128)) {
    const world = createWorld(WorldId.make("footprint"), ChainRef.make("solana:mainnet"), {
      ...defaultLayout,
      postsPerFloor,
    });
    // Post anchors are relative to the floor's origin, so the floor's own centre is zero.
    const floor = Array.headNonEmpty(world.floors);
    const half = floor.origin.x / 2;
    expect(floor.posts.every(post => chebyshev(post.anchor, { x: 0, z: 0 }) + 8 <= half)).toBe(true);
  }
});

test("moving agents changes their location while their station and plot stay put", () =>
  runTest(
    Arbitrary.checkEffect(Arbitrary.schema(AllocationScenario), scenario => {
      const agent = Array.headNonEmpty(scenario.agents);
      const world = Result.getOrThrow(
        assignAgent(createWorld(scenario.worldId, scenario.chain, scenario.config), agent, scenario.chain),
      );
      const moved = Result.getOrThrow(moveAgent(world, agent, AgentLocation.cases.InLobby.make({ place: "plots" })));
      return Schema.is(World)(moved)
        && Schema.toEquivalence(Schema.Array(Station))(allStations(world), allStations(moved))
        && Option.exists(agentLocation(moved, agent), location => location._tag === "InLobby")
        && Result.isFailure(assignAgent(moved, agent, scenario.chain))
        && Result.isFailure(
          moveAgent(moved, AgentId.make("absent_agent"), AgentLocation.cases.InLobby.make({ place: "entrance" })),
        )
        && Result.isFailure(
          moveAgent(moved, agent, AgentLocation.cases.AtDesk.make({ deskId: DeskId.make("absent_desk") })),
        )
        && Result.isFailure(
          moveAgent(
            moved,
            agent,
            AgentLocation.cases.AtPlace.make({ floorId: Array.lastNonEmpty(moved.floors).id, place: "bell" }),
          ),
        );
    }, { seed: 1703, runs: 50, size: 16 }).pipe(Effect.map(expectPassed)),
  ));

test("plot assignment is bounded to existing lobby and desk plots", () => {
  const chain = ChainRef.make("solana:mainnet");
  const world = Result.getOrThrow(assignAgent(createWorld(WorldId.make("floor"), chain), AgentId.make("agent"), chain));
  const token = Option.some(AssetRef.make("solana:mainnet/token:mint"));
  const holder = Option.some(OwnerId.make("owner"));
  for (const plot of allPlots(world)) {
    const changed = Result.getOrThrow(assignPlot(world, plot.id, token, holder));
    expect(Schema.is(World)(changed)).toBe(true);
    expect(
      Option.exists(
        Array.findFirst(allPlots(changed), candidate => candidate.id === plot.id),
        candidate =>
          Option.getOrNull(candidate.token) === Option.getOrNull(token)
          && Option.getOrNull(candidate.holder) === Option.getOrNull(holder),
      ),
    ).toBe(true);
    expect(allPlots(changed).filter(candidate => Option.isSome(candidate.token))).toHaveLength(1);
    expect(allPlots(world).every(candidate => Option.isNone(candidate.token))).toBe(true);
  }
  expect(Result.isFailure(assignPlot(world, PlotId.make("absent"), token, holder))).toBe(true);
});

test("generated foreign assets cannot occupy a desk on another chain; lobby plots remain chain neutral", () =>
  runTest(
    Arbitrary.checkEffect(Arbitrary.schema(AssetRef), token => {
      const chain = ChainRef.make("solana:mainnet");
      if (token.startsWith(`${chain}/`)) return true;
      const world = Result.getOrThrow(
        assignAgent(createWorld(WorldId.make("floor"), chain), AgentId.make("agent"), chain),
      );
      const holder = Option.some(OwnerId.make("owner"));
      return allPlots(world).every(plot => {
        const assigned = assignPlot(world, plot.id, Option.some(token), holder);
        if (plot._tag === "DeskPlot") return Result.isFailure(assigned) && assigned.failure.reason === "wrongChain";
        return Result.isSuccess(assigned) && Schema.is(World)(assigned.success);
      });
    }, { seed: 1704, runs: 60, size: 24 }).pipe(Effect.map(expectPassed)),
  ));

test("interleaved chain arrivals preserve every previous station and only fill their own chain", () =>
  runTest(
    Arbitrary.checkEffect(Arbitrary.schema(AllocationScenario), scenario => {
      const otherChain = ChainRef.make("eip155:1");
      let world = createWorld(scenario.worldId, scenario.chain, scenario.config);
      for (const [index, agent] of scenario.agents.entries()) {
        const previous = world;
        const chain = index % 2 === 0 ? scenario.chain : otherChain;
        world = Result.getOrThrow(assignAgent(world, agent, chain));
        const stations = allStations(world);
        if (
          !Schema.is(World)(world) || !allStations(previous).every(station =>
            Option.exists(
              Array.findFirst(stations, current => current.id === station.id),
              current => Schema.toEquivalence(Station)(station, current),
            )
          )
        ) {
          return false;
        }
        const assignedFloor = Array.findFirst(world.floors, floor =>
          floor.posts.some(post =>
            post._tag === "OpenTradingPost" && post.stations.some(station =>
              station.desk.agentId === agent
            )
          ));
        if (
          !Option.exists(assignedFloor, floor => floor.chain === chain)
        ) return false;
      }
      return true;
    }, { seed: 1705, runs: 60, size: 64 }).pipe(Effect.map(expectPassed)),
  ));

test("every occupied desk, post, floor place and lobby destination is a valid movement target", () => {
  const chain = ChainRef.make("solana:mainnet");
  const agent = AgentId.make("agent");
  const world = Result.getOrThrow(assignAgent(createWorld(WorldId.make("floor"), chain), agent, chain));
  const locations: ReadonlyArray<typeof AgentLocation.Type> = [
    ...allStations(world).map(station => AgentLocation.cases.AtDesk.make({ deskId: station.desk.id })),
    ...world.floors.flatMap(floor =>
      floor.posts.flatMap(post =>
        post._tag === "OpenTradingPost"
          ? [AgentLocation.cases.AtPost.make({ postId: post.id })]
          : []
      )
    ),
    ...world.floors.flatMap(floor =>
      floor._tag === "OpenFloor"
        ? FloorPlace.literals.map(place => AgentLocation.cases.AtPlace.make({ floorId: floor.id, place }))
        : []
    ),
    AgentLocation.cases.InLobby.make({ place: "entrance" }),
    AgentLocation.cases.InLobby.make({ place: "plots" }),
  ];
  for (const location of locations) {
    const moved = Result.getOrThrow(moveAgent(world, agent, location));
    expect(Schema.is(World)(moved)).toBe(true);
    expect(agentLocation(moved, agent)).toEqual(Option.some(location));
    expect(allStations(moved)).toEqual(allStations(world));
  }
});

test("World rejects duplicate agents, broken desk references, missing locations and misplaced blueprints", () => {
  const chain = ChainRef.make("solana:mainnet");
  const world = Result.getOrThrow(assignAgent(createWorld(WorldId.make("floor"), chain), AgentId.make("agent"), chain));
  expect(Schema.is(World)({ ...world, agents: [...world.agents, ...world.agents] })).toBe(false);
  expect(Schema.is(World)({ ...world, agents: [] })).toBe(false);
  expect(
    Schema.is(World)({
      ...world,
      agents: [{
        agentId: AgentId.make("agent"),
        location: AgentLocation.cases.AtDesk.make({ deskId: DeskId.make("absent") }),
      }],
    }),
  ).toBe(false);
  expect(Schema.is(World)({ ...world, floors: world.floors.toReversed() })).toBe(false);
  expect(Schema.is(World)({ ...world, floors: world.floors.filter(floor => floor._tag === "OpenFloor") })).toBe(false);
  expect(Schema.is(World)({ ...world, lobbyPlots: [...world.lobbyPlots, ...world.lobbyPlots] })).toBe(false);
  expect(
    Schema.is(World)({
      ...world,
      floors: Array.map(world.floors, floor => ({ ...floor, origin: Array.headNonEmpty(world.floors).origin })),
    }),
  ).toBe(false);
  const invalidDeskWorld = {
    ...world,
    floors: Array.map(world.floors, floor =>
      floor._tag === "BlueprintFloor" ? floor : {
        ...floor,
        posts: Array.map(floor.posts, post =>
          post._tag === "BlueprintTradingPost" ? post : {
            ...post,
            stations: Array.map(post.stations, station => ({
              ...station,
              desk: { ...station.desk, plot: { ...station.desk.plot, deskId: DeskId.make("other_desk") } },
            })),
          }),
      }),
  };
  expect(Schema.is(World)(invalidDeskWorld)).toBe(false);
  expect(Schema.is(WorldLayoutConfig)({ ...defaultLayout, stationsPerPost: 7 })).toBe(false);
  expect(Schema.is(WorldLayoutConfig)({ ...defaultLayout, stationsPerPost: 13 })).toBe(false);
  expect(Schema.is(WorldPoint)({ x: Number.POSITIVE_INFINITY, z: 0 })).toBe(false);
});

const validationChain = ChainRef.make("solana:mainnet");
const validationAgent = AgentId.make("validation_agent_0");
const validationWorld = () => {
  let world = createWorld(WorldId.make("validation"), validationChain, {
    ...defaultLayout,
    postsPerFloor: 2,
    stationsPerPost: 8,
  });
  for (const agent of [validationAgent, AgentId.make("validation_agent_1")]) {
    world = Result.getOrThrow(assignAgent(world, agent, validationChain));
  }
  return world;
};

const changeStations = (
  world: typeof World.Type,
  change: (station: typeof Station.Type) => typeof Station.Type,
): typeof World.Type => ({
  ...world,
  floors: Array.map(world.floors, floor =>
    floor._tag === "BlueprintFloor" ? floor : {
      ...floor,
      posts: Array.map(floor.posts, post =>
        post._tag === "BlueprintTradingPost" ? post : {
          ...post,
          stations: Array.map(post.stations, change),
        }),
    }),
});

const invalidSnapshots: ReadonlyArray<{
  readonly name: string;
  readonly change: (world: typeof World.Type) => typeof World.Type;
}> = [
  {
    name: "a station moved onto its neighbour",
    change: world => changeStations(world, station => ({ ...station, position: { x: 2, z: 0 } })),
  },
  {
    name: "a station moved off its canonical ring without colliding",
    change: world =>
      changeStations(world, station =>
        station.index === 0
          ? { ...station, position: { ...station.position, x: station.position.x + 0.01 } }
          : station),
  },
  {
    name: "an occupied post anchor moved without its stations",
    change: world => ({
      ...world,
      floors: Array.map(world.floors, floor =>
        floor._tag === "BlueprintFloor" ? floor : {
          ...floor,
          posts: Array.map(floor.posts, post =>
            post._tag === "BlueprintTradingPost" ? post : {
              ...post,
              anchor: { x: post.anchor.x + 1, z: post.anchor.z },
            }),
        }),
    }),
  },
  {
    name: "a blueprint post anchor moved",
    change: world => ({
      ...world,
      floors: Array.map(world.floors, floor =>
        floor._tag === "OpenFloor" ? floor : {
          ...floor,
          posts: Array.map(floor.posts, post =>
            post.index === 0
              ? { ...post, anchor: { x: post.anchor.x + 1, z: post.anchor.z } }
              : post),
        }),
    }),
  },
  {
    name: "a floor moved to a distinct noncanonical origin",
    change: world => ({
      ...world,
      floors: Array.map(world.floors, floor =>
        floor.index === 0
          ? { ...floor, origin: { ...floor.origin, x: floor.origin.x + 1 } }
          : floor),
    }),
  },
  {
    name: "station capacity changed under an existing ring",
    change: world => ({ ...world, layout: { ...world.layout, stationsPerPost: 9 } }),
  },
  {
    name: "the trailing blueprint is missing",
    change: world => ({ ...world, floors: Array.of(Array.headNonEmpty(world.floors)) }),
  },
  {
    name: "a desk plot points at another desk",
    change: world =>
      changeStations(world, station =>
        station.index === 0
          ? { ...station, desk: { ...station.desk, plot: { ...station.desk.plot, deskId: DeskId.make("wrong_desk") } } }
          : station),
  },
  {
    name: "two placements name the same agent without changing the count",
    change: world => ({ ...world, agents: world.agents.map(agent => ({ ...agent, agentId: validationAgent })) }),
  },
  {
    name: "a lobby plot index no longer matches its place",
    change: world => ({
      ...world,
      lobbyPlots: world.lobbyPlots.map(plot => plot.index === 0 ? { ...plot, index: 1 } : plot),
    }),
  },
];

// Encoding only the leaf shapes lets a test carry exactly one broken world
// invariant across JSON without accidentally failing on Option's debug format.
const encodeSnapshotResult = Schema.encodeResult(
  Schema.fromJsonString(Schema.toCodecJson(Schema.Struct(World.fields))),
);
const encodeSnapshot = (world: typeof World.Type) => Result.getOrThrow(encodeSnapshotResult(world));
const decodeSnapshot = Schema.decodeResult(Schema.fromJsonString(Schema.toCodecJson(World)));

for (const { name, change } of invalidSnapshots) {
  test(`World rejects ${name} at both the value and wire boundaries`, () => {
    const valid = validationWorld();
    expect(Schema.is(World)(valid)).toBe(true);
    expect(Result.isSuccess(decodeSnapshot(encodeSnapshot(valid)))).toBe(true);
    const invalid = change(valid);
    expect(Schema.is(World)(invalid)).toBe(false);
    expect(Result.isFailure(decodeSnapshot(encodeSnapshot(invalid)))).toBe(true);
  });

  test(`world operations reject ${name} before allocating or moving anything`, () => {
    const invalid = change(validationWorld());
    const previous = encodeSnapshot(invalid);
    const results: ReadonlyArray<{
      readonly operation: WorldValidationError["operation"];
      readonly result: Result.Result<typeof World.Type, WorldValidationError | WorldChangeError>;
    }> = [
      { operation: "assignAgent", result: assignAgent(invalid, AgentId.make("new_agent"), ChainRef.make("eip155:1")) },
      {
        operation: "moveAgent",
        result: moveAgent(invalid, validationAgent, AgentLocation.cases.InLobby.make({ place: "plots" })),
      },
      {
        operation: "assignPlot",
        result: assignPlot(invalid, PlotId.make("lobby_plot_0"), Option.none(), Option.none()),
      },
    ];
    for (const { operation, result } of results) {
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isSuccess(result)) continue;
      expect(result.failure).toBeInstanceOf(WorldValidationError);
      if (result.failure._tag !== "WorldValidationError") continue;
      expect(result.failure.operation).toBe(operation);
      expect(result.failure.reason).toBe("invalidWorld");
      expect(result.failure.reference).toBe(invalid.id);
      expect(result.failure.cause).toBeInstanceOf(Error);
    }
    expect(encodeSnapshot(invalid)).toBe(previous);
  });
}

for (
  const layout of [
    { ...defaultLayout, stationsPerPost: 7 },
    { ...defaultLayout, stationsPerPost: 13 },
    { ...defaultLayout, postsPerFloor: 0 },
    { ...defaultLayout, postsPerFloor: 129 },
    { ...defaultLayout, monitorsPerPost: 0 },
    { ...defaultLayout, monitorsPerPost: 9 },
    { ...defaultLayout, lobbyPlots: -1 },
    { ...defaultLayout, lobbyPlots: 33 },
    { ...defaultLayout, stationsPerPost: 8.5 },
  ]
) {
  test(`createWorld returns a tagged layout failure for ${layout.stationsPerPost}/${layout.postsPerFloor}/${layout.monitorsPerPost}/${layout.lobbyPlots}`, () => {
    const worldId = WorldId.make("invalid_layout");
    const result = tryCreateWorld(worldId, validationChain, layout);
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isSuccess(result)) return;
    expect(result.failure).toBeInstanceOf(WorldValidationError);
    if (result.failure._tag !== "WorldValidationError") return;
    expect(result.failure.operation).toBe("createWorld");
    expect(result.failure.reason).toBe("invalidLayout");
    expect(result.failure.reference).toBe(worldId);
    expect(result.failure.cause).toBeInstanceOf(Error);
  });
}

test("station index bounds are checked independently of every other station field", () => {
  const station = Array.getUnsafe(allStations(validationWorld()), 0);
  expect(Schema.is(Station)(station)).toBe(true);
  for (const index of [-1, 12, 1.5]) {
    expect(Schema.is(Station)({ ...station, index })).toBe(false);
  }
  expect(Schema.is(Station)({ ...station, index: 11 })).toBe(true);
});

test("canonical topology rejects unsupported indices and capacities", () => {
  for (const index of [-1, 128, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(Option.isNone(canonicalPostAnchor(index))).toBe(true);
    expect(Option.isNone(canonicalStationPosition(index, 0, 8))).toBe(true);
  }
  for (const index of [-1, 12, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(Option.isNone(canonicalStationPosition(0, index, 12))).toBe(true);
  }
  for (const capacity of [7, 13, 8.5]) {
    expect(Option.isNone(canonicalStationPosition(0, 0, capacity))).toBe(true);
  }
  expect(Option.isNone(canonicalStationPosition(0, 8, 8))).toBe(true);
  for (const index of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(Option.isNone(canonicalFloorOrigin(index, 1))).toBe(true);
  }
  expect(Option.isNone(canonicalFloorOrigin(0, 0))).toBe(true);
  expect(Option.isNone(canonicalFloorOrigin(0, 129))).toBe(true);
});

test("every supported station ring is canonical, unique and within rounding distance of radius two", () => {
  for (const stationsPerPost of Array.range(8, 12)) {
    let world = createWorld(WorldId.make("rings"), validationChain, {
      ...defaultLayout,
      postsPerFloor: 1,
      stationsPerPost,
    });
    for (const index of Array.range(0, stationsPerPost - 1)) {
      world = Result.getOrThrow(assignAgent(world, AgentId.make(`ring_agent_${index}`), validationChain));
    }
    const stations = allStations(world);
    expect(Array.dedupe(stations.map(station => `${station.position.x},${station.position.z}`))).toHaveLength(
      stationsPerPost,
    );
    for (const station of stations) {
      expect(Option.some(station.position)).toEqual(canonicalStationPosition(0, station.index, stationsPerPost));
      expect(Math.abs(Math.hypot(station.position.x, station.position.z) - 2)).toBeLessThan(0.000001);
    }
    expect(Schema.is(World)(world)).toBe(true);
  }
  expect(canonicalStationPosition(1, 1, 10)).toEqual(Option.some({ x: 9.618034, z: 1.175571 }));
  expect(canonicalStationPosition(127, 1, 10)).toEqual(Option.some({ x: 49.618034, z: 9.175571 }));
});

test("unknown destinations report the destination reference rather than the moving agent", () => {
  const world = validationWorld();
  const targets: ReadonlyArray<{ readonly location: typeof AgentLocation.Type; readonly reference: string }> = [
    { location: AgentLocation.cases.AtDesk.make({ deskId: DeskId.make("absent_desk") }), reference: "absent_desk" },
    {
      location: AgentLocation.cases.AtPost.make({ postId: TradingPostId.make("absent_post") }),
      reference: "absent_post",
    },
    {
      location: AgentLocation.cases.AtPlace.make({ floorId: FloorId.make("absent_floor"), place: "bell" }),
      reference: "absent_floor",
    },
  ];
  for (const { location, reference } of targets) {
    const result = moveAgent(world, validationAgent, location);
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isSuccess(result)) continue;
    expect(result.failure).toEqual(new WorldChangeError({ reason: "unknownLocation", reference }));
  }
});
