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
  DeskPlot,
  type Floor,
  LobbyPlot,
  OpenFloor,
  OpenTradingPost,
  type Plot,
  type Station,
  type World,
  WorldChangeError,
  type WorldLayoutConfig,
  type WorldPoint,
} from "@floor/contract/world";
import { Array, Option, Result } from "effect";

export const defaultLayout: typeof WorldLayoutConfig.Type = defaultWorldLayout;

// These are abstract topology units, deliberately independent of the Atlas's
// eventual kit unit. A square spiral opens new posts on the perimeter while
// preserving every existing anchor as occupancy grows.
const postAnchor = (index: number): typeof WorldPoint.Type => {
  if (index === 0) return { x: 0, z: 0 };
  const ring = Math.ceil((Math.sqrt(index + 1) - 1) / 2);
  const side = ring * 2;
  const offset = (side + 1) ** 2 - 1 - index;
  if (offset < side) return { x: (ring - offset) * 8, z: -ring * 8 };
  if (offset < side * 2) return { x: -ring * 8, z: (-ring + offset - side) * 8 };
  if (offset < side * 3) return { x: (-ring + offset - side * 2) * 8, z: ring * 8 };
  return { x: ring * 8, z: (ring - offset + side * 3) * 8 };
};

const stationPosition = (anchor: typeof WorldPoint.Type, index: number, capacity: number): typeof WorldPoint.Type => {
  const angle = index * 2 * Math.PI / capacity;
  return { x: anchor.x + Math.cos(angle) * 2, z: anchor.z + Math.sin(angle) * 2 };
};

const blueprintFloor = (
  chain: ChainRef,
  level: number,
  config: typeof WorldLayoutConfig.Type,
): typeof BlueprintFloor.Type => {
  // IDs are local to a World. Encoding the level and slot avoids dependence on
  // arrival IDs, clocks or randomness and keeps a desk stable during movement.
  const id = FloorId.make(`floor_${level}`);
  return BlueprintFloor.make({
    id,
    chain,
    level,
    posts: Array.makeBy(config.postsPerFloor, (index) =>
      BlueprintTradingPost.make({
        id: TradingPostId.make(`${id}_post_${index}`),
        index,
        anchor: postAnchor(index),
      })),
  });
};

export const createWorld = (
  id: WorldId,
  firstChain: ChainRef,
  layout: typeof WorldLayoutConfig.Type = defaultLayout,
): typeof World.Type => ({
  id,
  layout,
  floors: [blueprintFloor(firstChain, 1, layout)],
  lobbyPlots: Array.makeBy(layout.lobbyPlots, (slot) =>
    LobbyPlot.make({
      id: PlotId.make(`lobby_plot_${slot}`),
      slot,
      token: Option.none(),
      holder: Option.none(),
    })),
  agents: [],
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
  world: typeof World.Type,
  agentId: AgentId,
  chain: ChainRef,
): Result.Result<typeof World.Type, WorldChangeError> => {
  if (world.agents.some(agent => agent.agentId === agentId)) {
    return Result.fail(new WorldChangeError({ reason: "duplicateAgent", reference: agentId }));
  }
  const existingFloor = Array.findFirst(
    world.floors,
    floor => floor._tag === "OpenFloor" && floor.chain === chain && floorHasSpace(floor, world.layout),
  );
  // Only the final blueprint changes chain; occupied floors never change level
  // when a second chain arrives or an earlier chain needs overflow capacity.
  const floor = Option.getOrElse(existingFloor, () => Array.lastNonEmpty(world.floors));
  const post = Array.findFirst(
    floor.posts,
    candidate => candidate._tag === "BlueprintTradingPost" || candidate.stations.length < world.layout.stationsPerPost,
  );
  return Option.match(post, {
    onNone: () => Result.fail(new WorldChangeError({ reason: "unknownPost", reference: floor.id })),
    onSome: selected => {
      const previousStations = selected._tag === "OpenTradingPost" ? selected.stations : [];
      const index = previousStations.length;
      const id = StationId.make(`${selected.id}_station_${index}`);
      const deskId = DeskId.make(`${id}_desk`);
      const station: typeof Station.Type = {
        id,
        index,
        position: stationPosition(selected.anchor, index, world.layout.stationsPerPost),
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
            level: floor.level,
            posts: Array.map(floor.posts, current => current.id === selected.id ? openPost : current),
          })
          : candidate);
      return Result.succeed({
        ...world,
        floors: floor._tag === "BlueprintFloor"
          ? [...floors, blueprintFloor(chain, floor.level + 1, world.layout)]
          : floors,
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
  world: typeof World.Type,
  agentId: AgentId,
  location: typeof AgentLocation.Type,
): Result.Result<typeof World.Type, WorldChangeError> => {
  if (!world.agents.some(agent => agent.agentId === agentId)) {
    return Result.fail(new WorldChangeError({ reason: "unknownAgent", reference: agentId }));
  }
  if (!locationExists(world, location)) {
    return Result.fail(new WorldChangeError({ reason: "unknownLocation", reference: agentId }));
  }
  return Result.succeed({
    ...world,
    agents: world.agents.map(agent => agent.agentId === agentId ? { agentId, location } : agent),
  });
};

export const assignPlot = (
  world: typeof World.Type,
  plotId: PlotId,
  token: Option.Option<AssetRef>,
  holder: Option.Option<OwnerId>,
): Result.Result<typeof World.Type, WorldChangeError> => {
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
