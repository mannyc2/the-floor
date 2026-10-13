import { AgentId, AssetRef, ChainRef, DeskId, OwnerId, PlotId, WorldId } from "@floor/contract/identifiers";
import {
  AgentLocation,
  AgentPlacement,
  BlueprintFloor,
  BlueprintTradingPost,
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
} from "@floor/contract/world";
import {
  agentLocation,
  allPlots,
  allStations,
  assignAgent,
  assignPlot,
  createWorld,
  defaultLayout,
  moveAgent,
} from "@floor/world";
import { expect, test } from "bun:test";
import { Arbitrary, Array, Effect, Option, Result, Schema } from "effect";
import { expectPassed, roundTrip, runTest } from "./_runtime";

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

test("default capacity opens the forty-first post above and retains the original chain", () => {
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

test("new chains and overflow only add levels, leaving existing floors in place", () => {
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
  expect(world.floors.map(floor => floor.level)).toEqual([1, 2, 3, 4]);
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
    AgentLocation.cases.InLobby.make({ place: "elevator" }),
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
  expect(Schema.is(Station)({ id: "s", index: 12, position: { x: 0, z: 0 }, desk: {} })).toBe(false);
  expect(Schema.is(WorldLayoutConfig)({ ...defaultLayout, stationsPerPost: 7 })).toBe(false);
  expect(Schema.is(WorldLayoutConfig)({ ...defaultLayout, stationsPerPost: 13 })).toBe(false);
  expect(Schema.is(WorldPoint)({ x: Number.POSITIVE_INFINITY, z: 0 })).toBe(false);
});
