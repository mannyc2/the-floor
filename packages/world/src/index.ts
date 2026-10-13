import {
  type AgentId,
  type AssetRef,
  type ChainRef,
  DeskId,
  FloorId,
  type OwnerId,
  PlotId,
  StationId,
  TradingPostId,
  type WorldId,
} from "@floor/contract/identifiers";
import { defaultWorldLayout } from "@floor/contract/settings";
import {
  AgentLocation,
  BlueprintFloor,
  BlueprintTradingPost,
  canonicalFloorOrigin,
  canonicalPostAnchor,
  canonicalStationPosition,
  DeskPlot,
  type Floor,
  LobbyPlot,
  OpenFloor,
  OpenTradingPost,
  type Plot,
  type Station,
  World,
  WorldChangeError,
  WorldLayoutConfig,
  WorldValidationError,
} from "@floor/contract/world";
import { Array, Option, Result, Schema } from "effect";

export const defaultLayout: typeof WorldLayoutConfig.Type = defaultWorldLayout;

const topologyPoint = (point: Option.Option<{ readonly x: number; readonly z: number }>, reference: string) =>
  Result.fromOption(point, () => new WorldChangeError({ reason: "invalidTopology", reference }));

const blueprintFloor = (
  chain: ChainRef,
  floorIndex: number,
  config: typeof WorldLayoutConfig.Type,
): Result.Result<typeof BlueprintFloor.Type, WorldChangeError> =>
  Result.gen(function*() {
    // World-local indices keep identity independent of clocks, randomness and
    // agent IDs, and remain stable when rooms open beside the lobby.
    const id = FloorId.make(`floor_${floorIndex}`);
    const origin = yield* topologyPoint(canonicalFloorOrigin(floorIndex, config.postsPerFloor), id);
    const posts = yield* Result.all(Array.makeBy(config.postsPerFloor, index => {
      const postId = TradingPostId.make(`${id}_post_${index}`);
      return topologyPoint(canonicalPostAnchor(index), postId).pipe(
        Result.map(anchor => BlueprintTradingPost.make({ id: postId, index, anchor })),
      );
    }));
    return BlueprintFloor.make({ id, chain, index: floorIndex, origin, posts });
  });

const decodeWorld = Schema.decodeResult(Schema.toType(World));
const validateWorld = (world: typeof World.Type, operation: "assignAgent" | "moveAgent" | "assignPlot") =>
  decodeWorld(world).pipe(Result.mapError(cause =>
    new WorldValidationError({
      operation,
      reason: "invalidWorld",
      reference: world.id,
      cause,
    })
  ));

export const createWorld = (
  id: WorldId,
  firstChain: ChainRef,
  layout: typeof WorldLayoutConfig.Type = defaultLayout,
): Result.Result<typeof World.Type, WorldValidationError | WorldChangeError> =>
  Result.gen(function*() {
    const config = yield* Schema.decodeResult(WorldLayoutConfig)(layout).pipe(Result.mapError(cause =>
      new WorldValidationError({ operation: "createWorld", reason: "invalidLayout", reference: id, cause })
    ));
    const floor = yield* blueprintFloor(firstChain, 0, config);
    return {
      id,
      layout: config,
      floors: [floor],
      lobbyPlots: Array.makeBy(config.lobbyPlots, index =>
        LobbyPlot.make({
          id: PlotId.make(`lobby_plot_${index}`),
          index,
          token: Option.none(),
          holder: Option.none(),
        })),
      agents: [],
    };
  });

const floorHasSpace = (floor: typeof Floor.Type, config: typeof WorldLayoutConfig.Type) =>
  floor.posts.some(post => post._tag === "BlueprintTradingPost" || post.stations.length < config.stationsPerPost);

export const allStations = (world: typeof World.Type): ReadonlyArray<typeof Station.Type> =>
  world.floors.flatMap(floor => floor.posts.flatMap(post => post._tag === "OpenTradingPost" ? post.stations : []));

export const allPlots = (world: typeof World.Type): ReadonlyArray<typeof Plot.Type> => [
  ...world.lobbyPlots,
  ...allStations(world).map(station => station.desk.plot),
];

export const agentLocation = (world: typeof World.Type, agentId: AgentId): Option.Option<typeof AgentLocation.Type> =>
  Array.findFirst(world.agents, agent => agent.agentId === agentId).pipe(Option.map(agent => agent.location));

export const assignAgent = (
  input: typeof World.Type,
  agentId: AgentId,
  chain: ChainRef,
): Result.Result<typeof World.Type, WorldValidationError | WorldChangeError> => {
  const validated = validateWorld(input, "assignAgent");
  if (Result.isFailure(validated)) return validated;
  const world = validated.success;
  if (world.agents.some(agent => agent.agentId === agentId)) {
    return Result.fail(new WorldChangeError({ reason: "duplicateAgent", reference: agentId }));
  }
  const existingFloor = Array.findFirst(
    world.floors,
    floor => floor._tag === "OpenFloor" && floor.chain === chain && floorHasSpace(floor, world.layout),
  );
  // Only the final blueprint changes chain; occupied floors never change index
  // when a second chain arrives or an earlier chain needs overflow capacity.
  const floor = Option.getOrElse(existingFloor, () => Array.lastNonEmpty(world.floors));
  const post = Array.findFirst(
    floor.posts,
    candidate => candidate._tag === "BlueprintTradingPost" || candidate.stations.length < world.layout.stationsPerPost,
  );
  return Option.match(post, {
    onNone: () => Result.fail(new WorldChangeError({ reason: "floorFull", reference: floor.id })),
    onSome: selected => {
      const previousStations = selected._tag === "OpenTradingPost" ? selected.stations : [];
      const index = previousStations.length;
      const id = StationId.make(`${selected.id}_station_${index}`);
      const deskId = DeskId.make(`${id}_desk`);
      const position = topologyPoint(canonicalStationPosition(selected.index, index, world.layout.stationsPerPost), id);
      if (Result.isFailure(position)) return Result.fail(position.failure);
      const station: typeof Station.Type = {
        id,
        index,
        position: position.success,
        desk: {
          id: deskId,
          agentId,
          plot: DeskPlot.make({
            id: PlotId.make(`${id}_plot`),
            deskId,
            token: Option.none(),
            holder: Option.none(),
          }),
        },
      };
      const openPost = OpenTradingPost.make({
        id: selected.id,
        index: selected.index,
        anchor: selected.anchor,
        stations: Array.append(previousStations, station),
        tokens: selected._tag === "OpenTradingPost" ? selected.tokens : [],
      });
      const floors = Array.map(world.floors, (candidate): typeof Floor.Type =>
        candidate.id === floor.id
          ? OpenFloor.make({
            id: floor.id,
            chain,
            index: floor.index,
            origin: floor.origin,
            posts: Array.map(floor.posts, current => current.id === selected.id ? openPost : current),
          })
          : candidate);
      const nextFloor = floor._tag === "BlueprintFloor"
        ? blueprintFloor(chain, floor.index + 1, world.layout).pipe(Result.map(value => Array.append(floors, value)))
        : Result.succeed(floors);
      if (Result.isFailure(nextFloor)) return Result.fail(nextFloor.failure);
      return Result.succeed({
        ...world,
        floors: nextFloor.success,
        agents: [...world.agents, { agentId, location: AgentLocation.cases.AtDesk.make({ deskId }) }],
      });
    },
  });
};

const locationExists = (world: typeof World.Type, location: typeof AgentLocation.Type): boolean =>
  AgentLocation.match(location, {
    AtDesk: target => allStations(world).some(station => station.desk.id === target.deskId),
    AtPost: target =>
      world.floors.some(floor =>
        floor.posts.some(post => post._tag === "OpenTradingPost" && post.id === target.postId)
      ),
    AtPlace: target => world.floors.some(floor => floor._tag === "OpenFloor" && floor.id === target.floorId),
    InLobby: () => true,
  });

export const moveAgent = (
  input: typeof World.Type,
  agentId: AgentId,
  location: typeof AgentLocation.Type,
): Result.Result<typeof World.Type, WorldValidationError | WorldChangeError> => {
  const validated = validateWorld(input, "moveAgent");
  if (Result.isFailure(validated)) return validated;
  const world = validated.success;
  if (!world.agents.some(agent => agent.agentId === agentId)) {
    return Result.fail(new WorldChangeError({ reason: "unknownAgent", reference: agentId }));
  }
  if (!locationExists(world, location)) {
    const reference = AgentLocation.match(location, {
      AtDesk: (target): string => target.deskId,
      AtPost: (target): string => target.postId,
      AtPlace: (target): string => target.floorId,
      InLobby: (target): string => target.place,
    });
    return Result.fail(new WorldChangeError({ reason: "unknownLocation", reference }));
  }
  return Result.succeed({
    ...world,
    agents: world.agents.map(agent => agent.agentId === agentId ? { agentId, location } : agent),
  });
};

export const assignPlot = (
  input: typeof World.Type,
  plotId: PlotId,
  token: Option.Option<AssetRef>,
  holder: Option.Option<OwnerId>,
): Result.Result<typeof World.Type, WorldValidationError | WorldChangeError> => {
  const validated = validateWorld(input, "assignPlot");
  if (Result.isFailure(validated)) return validated;
  const world = validated.success;
  if (!allPlots(world).some(plot => plot.id === plotId)) {
    return Result.fail(new WorldChangeError({ reason: "unknownPlot", reference: plotId }));
  }
  const deskFloor = Array.findFirst(
    world.floors,
    floor =>
      floor.posts.some(post =>
        post._tag === "OpenTradingPost" && post.stations.some(station => station.desk.plot.id === plotId)
      ),
  );
  if (Option.isSome(deskFloor) && Option.isSome(token) && !token.value.startsWith(`${deskFloor.value.chain}/`)) {
    return Result.fail(new WorldChangeError({ reason: "wrongChain", reference: plotId }));
  }
  return Result.succeed({
    ...world,
    lobbyPlots: world.lobbyPlots.map(plot => plot.id === plotId ? { ...plot, token, holder } : plot),
    floors: Array.map(world.floors, floor =>
      floor._tag === "BlueprintFloor" ? floor : {
        ...floor,
        posts: Array.map(floor.posts, post =>
          post._tag === "BlueprintTradingPost" ? post : {
            ...post,
            stations: Array.map(post.stations, station =>
              station.desk.plot.id === plotId
                ? {
                  ...station,
                  desk: { ...station.desk, plot: { ...station.desk.plot, token, holder } },
                }
                : station),
          }),
      }),
  });
};
