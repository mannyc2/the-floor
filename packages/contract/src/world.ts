import { Array, Schema } from "effect";
import {
  AgentId,
  AssetRef,
  ChainRef,
  DeskId,
  FloorId,
  OwnerId,
  PlotId,
  StationId,
  TradingPostId,
  WorldId,
} from "./identifiers";
import { LobbyPlots, MonitorsPerPost, PostsPerFloor, StationsPerPost } from "./settings";

export const WorldPoint = Schema.Struct({ x: Schema.Finite, z: Schema.Finite });
export const WorldLayoutConfig = Schema.Struct({
  stationsPerPost: StationsPerPost,
  postsPerFloor: PostsPerFloor,
  monitorsPerPost: MonitorsPerPost,
  lobbyPlots: LobbyPlots,
});

const plotFields = {
  id: PlotId,
  token: Schema.OptionFromNullOr(AssetRef),
  holder: Schema.OptionFromNullOr(OwnerId),
};
export const DeskPlot = Schema.TaggedStruct("DeskPlot", { ...plotFields, deskId: DeskId });
export const LobbyPlot = Schema.TaggedStruct("LobbyPlot", {
  ...plotFields,
  slot: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 31 })),
});
export const Plot = Schema.Union([DeskPlot, LobbyPlot]);
export const Desk = Schema.Struct({ id: DeskId, agentId: AgentId, plot: DeskPlot });
export const Station = Schema.Struct({
  id: StationId,
  index: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 11 })),
  position: WorldPoint,
  desk: Desk,
});
const postFields = {
  id: TradingPostId,
  index: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 127 })),
  anchor: WorldPoint,
};
export const BlueprintTradingPost = Schema.TaggedStruct("BlueprintTradingPost", postFields);
export const OpenTradingPost = Schema.TaggedStruct("OpenTradingPost", {
  ...postFields,
  stations: Schema.NonEmptyArray(Station).check(Schema.isMaxLength(12)),
  tokens: Schema.Array(AssetRef).check(Schema.isMaxLength(8), Schema.isUnique()),
});
export const TradingPost = Schema.Union([BlueprintTradingPost, OpenTradingPost]);
const floorFields = {
  id: FloorId,
  chain: ChainRef,
  level: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
};
export const BlueprintFloor = Schema.TaggedStruct("BlueprintFloor", {
  ...floorFields,
  posts: Schema.NonEmptyArray(BlueprintTradingPost).check(Schema.isMaxLength(128)),
});
export const OpenFloor = Schema.TaggedStruct("OpenFloor", {
  ...floorFields,
  posts: Schema.NonEmptyArray(TradingPost).check(Schema.isMaxLength(128)),
});
export const Floor = Schema.Union([BlueprintFloor, OpenFloor]);

export const FloorPlace = Schema.Literals(["wallOfScreens", "bell", "podium", "fileRoom", "board", "elevator"]);
export const AgentLocation = Schema.TaggedUnion({
  AtDesk: { deskId: DeskId },
  AtPost: { postId: TradingPostId },
  AtPlace: { floorId: FloorId, place: FloorPlace },
  InLobby: { place: Schema.Literals(["entrance", "elevator", "plots"]) },
});
export const AgentPlacement = Schema.Struct({ agentId: AgentId, location: AgentLocation });
const WorldSnapshot = Schema.Struct({
  id: WorldId,
  layout: WorldLayoutConfig,
  floors: Schema.NonEmptyArray(Floor),
  lobbyPlots: Schema.Array(LobbyPlot).check(Schema.isMaxLength(32)),
  agents: Schema.Array(AgentPlacement),
});

const unique = (values: ReadonlyArray<string>) => Array.dedupe(values).length === values.length;

// A snapshot crosses the same trust boundary as an event. Valid leaf records are
// insufficient when references can point at a different desk or an absent agent.
export const World = WorldSnapshot.check(Schema.makeFilter(world => {
  const floors = world.floors;
  const openFloors = floors.filter(floor => floor._tag === "OpenFloor");
  const posts = floors.flatMap(floor => floor.posts);
  const openPosts = posts.filter(post => post._tag === "OpenTradingPost");
  const stations = openPosts.flatMap(post => post.stations);
  const desks = stations.map(station => station.desk);
  const deskAgents = desks.map(desk => desk.agentId);
  const plots = [...world.lobbyPlots, ...desks.map(desk => desk.plot)];
  if (
    !unique(floors.map(floor => floor.id)) || !unique(posts.map(post => post.id))
    || !unique(stations.map(station => station.id)) || !unique(desks.map(desk => desk.id))
    || !unique(plots.map(plot => plot.id)) || !unique(deskAgents)
    || !unique(world.agents.map(agent => agent.agentId))
    || world.agents.length !== desks.length
    || world.lobbyPlots.length !== world.layout.lobbyPlots
  ) return false;
  if (!world.lobbyPlots.every((plot, index) => plot.slot === index)) return false;
  if (!desks.every(desk => desk.plot.deskId === desk.id)) return false;
  if (
    !floors.every((floor, index) => {
      if (floor.level !== index + 1 || floor.posts.length !== world.layout.postsPerFloor) return false;
      if ((floor._tag === "BlueprintFloor") !== (index === floors.length - 1)) return false;
      if (!unique(floor.posts.map(post => post.id))) return false;
      if (
        !floor.posts.every((post, postIndex) => {
          if (post.index !== postIndex) return false;
          if (post._tag === "BlueprintTradingPost") return true;
          if (
            post.stations.length > world.layout.stationsPerPost || post.tokens.length > world.layout.monitorsPerPost
          ) return false;
          if (!post.stations.every((station, stationIndex) => station.index === stationIndex)) return false;
          if (!post.tokens.every(token => token.startsWith(`${floor.chain}/`))) return false;
          if (
            !post.stations.every(station =>
              station.desk.plot.token._tag === "None" || station.desk.plot.token.value.startsWith(`${floor.chain}/`)
            )
          ) return false;
          return floor.posts.slice(0, postIndex).every(previous =>
            previous._tag === "OpenTradingPost" && previous.stations.length === world.layout.stationsPerPost
          );
        })
      ) return false;
      if (floor._tag === "BlueprintFloor") return true;
      if (!floor.posts.some(post => post._tag === "OpenTradingPost")) return false;
      const newerSameChain = openFloors.some(other => other.chain === floor.chain && other.level > floor.level);
      return !newerSameChain
        || floor.posts.every(post =>
          post._tag === "OpenTradingPost" && post.stations.length === world.layout.stationsPerPost
        );
    })
  ) return false;
  return world.agents.every(agent => {
    if (!deskAgents.includes(agent.agentId)) return false;
    return AgentLocation.match(agent.location, {
      AtDesk: location => desks.some(desk => desk.id === location.deskId),
      AtPost: location => openPosts.some(post => post.id === location.postId),
      AtPlace: location => openFloors.some(floor => floor.id === location.floorId),
      InLobby: () => true,
    });
  });
}, { expected: "a consistent occupied world with one blueprint floor above its active floors" }));

export class WorldChangeError extends Schema.TaggedError<WorldChangeError>()("WorldChangeError", {
  reason: Schema.Literals([
    "duplicateAgent",
    "unknownAgent",
    "unknownLocation",
    "unknownPlot",
    "unknownPost",
    "wrongChain",
  ]),
  reference: Schema.String,
}) {}
