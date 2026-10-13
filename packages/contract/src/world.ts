import { Array, Option, Schema } from "effect";
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

// These are abstract topology units, deliberately independent of the Atlas's
// eventual kit unit.
const postSpacing = 8;

// Square rings around a centre cell: ring r holds the 8r cells around rings
// 0 to r - 1, so cell index i lies in this ring.
const ringOf = (index: number) => Math.ceil((Math.sqrt(index + 1) - 1) / 2);

// A square spiral opens new posts on the perimeter while preserving every
// existing anchor as occupancy grows.
const postAnchor = (index: number): typeof WorldPoint.Type => {
  if (index === 0) return { x: 0, z: 0 };
  const ring = ringOf(index);
  const side = ring * 2;
  const offset = (side + 1) ** 2 - 1 - index;
  if (offset < side) return { x: (ring - offset) * postSpacing, z: -ring * postSpacing };
  if (offset < side * 2) return { x: -ring * postSpacing, z: (-ring + offset - side) * postSpacing };
  if (offset < side * 3) return { x: (-ring + offset - side * 2) * postSpacing, z: ring * postSpacing };
  return { x: ring * postSpacing, z: (ring - offset + side * 3) * postSpacing };
};

// Subtracting from zero keeps zero positive, so a decoded point compares equal.
const quarterTurns = (cell: typeof WorldPoint.Type, turns: number): typeof WorldPoint.Type =>
  turns === 0 ? cell : quarterTurns({ x: 0 - cell.z, z: cell.x }, turns - 1);

// Orders a ring by distance from the centre, then by angle. The four cells
// sharing an edge with the ring inside come first and the corners last, so the
// first four floors open directly off the lobby and the plan stays compact
// rather than growing as a row.
const ringCell = (ring: number, position: number): typeof WorldPoint.Type => {
  const corners = 4 + 8 * (ring - 1);
  if (position < 4) return quarterTurns({ x: ring, z: 0 }, position);
  if (position >= corners) return quarterTurns({ x: ring, z: ring }, position - corners);
  const step = 1 + Math.floor((position - 4) / 8);
  const within = (position - 4) % 8;
  return quarterTurns(within % 2 === 0 ? { x: ring, z: step } : { x: step, z: ring }, Math.floor(within / 2));
};

// Each floor's square footprint holds its whole spiral of posts plus one post
// spacing on every side for aisles and fixed places, so full neighbours never
// overlap. The lobby is the centre cell of the same grid.
const floorOrigin = (index: number, postsPerFloor: typeof PostsPerFloor.Type): typeof WorldPoint.Type => {
  const pitch = (2 * ringOf(postsPerFloor - 1) + 3) * postSpacing;
  const cell = index + 1;
  const ring = ringOf(cell);
  const offset = ringCell(ring, cell - (2 * ring - 1) ** 2);
  return { x: offset.x * pitch, z: offset.z * pitch };
};

const PostIndex = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 127 }));
const StationIndex = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 11 }));
const FloorIndex = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export const canonicalPostAnchor = (index: number): Option.Option<typeof WorldPoint.Type> =>
  Schema.is(PostIndex)(index) ? Option.some(postAnchor(index)) : Option.none();

export const canonicalFloorOrigin = (
  index: number,
  postsPerFloor: typeof PostsPerFloor.Type,
): Option.Option<typeof WorldPoint.Type> =>
  Schema.is(FloorIndex)(index) && Schema.is(PostsPerFloor)(postsPerFloor)
    ? Option.some(floorOrigin(index, postsPerFloor))
    : Option.none();

// Fixed-point offsets are the radius-2 rings rounded once to a millionth of a
// topology unit. Integer addition precedes division, so every engine produces
// the same wire coordinates without implementation-dependent trigonometry.
const coordinateScale = 1_000_000;
const stationRings: ReadonlyArray<{
  readonly capacity: number;
  readonly offsets: ReadonlyArray<readonly [number, number]>;
}> = [
  {
    capacity: 8,
    offsets: [
      [2000000, 0],
      [1414214, 1414214],
      [0, 2000000],
      [-1414214, 1414214],
      [-2000000, 0],
      [-1414214, -1414214],
      [0, -2000000],
      [1414214, -1414214],
    ],
  },
  {
    capacity: 9,
    offsets: [
      [2000000, 0],
      [1532089, 1285575],
      [347296, 1969616],
      [-1000000, 1732051],
      [-1879385, 684040],
      [-1879385, -684040],
      [-1000000, -1732051],
      [347296, -1969616],
      [1532089, -1285575],
    ],
  },
  {
    capacity: 10,
    offsets: [
      [2000000, 0],
      [1618034, 1175571],
      [618034, 1902113],
      [-618034, 1902113],
      [-1618034, 1175571],
      [-2000000, 0],
      [-1618034, -1175571],
      [-618034, -1902113],
      [618034, -1902113],
      [1618034, -1175571],
    ],
  },
  {
    capacity: 11,
    offsets: [
      [2000000, 0],
      [1682507, 1081282],
      [830830, 1819264],
      [-284630, 1979643],
      [-1309721, 1511499],
      [-1918986, 563465],
      [-1918986, -563465],
      [-1309721, -1511499],
      [-284630, -1979643],
      [830830, -1819264],
      [1682507, -1081282],
    ],
  },
  {
    capacity: 12,
    offsets: [
      [2000000, 0],
      [1732051, 1000000],
      [1000000, 1732051],
      [0, 2000000],
      [-1000000, 1732051],
      [-1732051, 1000000],
      [-2000000, 0],
      [-1732051, -1000000],
      [-1000000, -1732051],
      [0, -2000000],
      [1000000, -1732051],
      [1732051, -1000000],
    ],
  },
];

export const canonicalStationPosition = (
  postIndex: number,
  stationIndex: number,
  capacity: typeof StationsPerPost.Type,
): Option.Option<typeof WorldPoint.Type> => {
  if (!Schema.is(PostIndex)(postIndex) || !Schema.is(StationIndex)(stationIndex)) return Option.none();
  const anchor = postAnchor(postIndex);
  return Array.findFirst(stationRings, ring => ring.capacity === capacity).pipe(
    Option.flatMap(ring => Array.get(ring.offsets, stationIndex)),
    Option.map(([x, z]) => ({
      x: (anchor.x * coordinateScale + x) / coordinateScale,
      z: (anchor.z * coordinateScale + z) / coordinateScale,
    })),
  );
};

const plotFields = {
  id: PlotId,
  token: Schema.OptionFromNullOr(AssetRef),
  holder: Schema.OptionFromNullOr(OwnerId),
};
export const DeskPlot = Schema.TaggedStruct("DeskPlot", { ...plotFields, deskId: DeskId });
export const LobbyPlot = Schema.TaggedStruct("LobbyPlot", {
  ...plotFields,
  index: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 31 })),
});
export const Plot = Schema.Union([DeskPlot, LobbyPlot]);
export const Desk = Schema.Struct({ id: DeskId, agentId: AgentId, plot: DeskPlot });
export const Station = Schema.Struct({
  id: StationId,
  index: StationIndex,
  position: WorldPoint,
  desk: Desk,
});
const postFields = {
  id: TradingPostId,
  index: PostIndex,
  anchor: WorldPoint,
};
export const BlueprintTradingPost = Schema.TaggedStruct("BlueprintTradingPost", postFields);
export const OpenTradingPost = Schema.TaggedStruct("OpenTradingPost", {
  ...postFields,
  stations: Schema.NonEmptyArray(Station).check(Schema.isMaxLength(12)),
  tokens: Schema.Array(AssetRef).check(Schema.isMaxLength(8), Schema.isUnique()),
});
export const TradingPost = Schema.Union([BlueprintTradingPost, OpenTradingPost]);
// Floors sit side by side around the lobby rather than stacked. A floor's index
// fixes its place in the exchange's plan and its origin never moves; post
// anchors and station positions are relative to that origin.
const floorFields = {
  id: FloorId,
  chain: ChainRef,
  index: FloorIndex,
  origin: WorldPoint,
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

export const FloorPlace = Schema.Literals(["wallOfScreens", "bell", "podium", "fileRoom", "board"]);
export const AgentLocation = Schema.TaggedUnion({
  AtDesk: { deskId: DeskId },
  AtPost: { postId: TradingPostId },
  AtPlace: { floorId: FloorId, place: FloorPlace },
  InLobby: { place: Schema.Literals(["entrance", "plots"]) },
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
    !unique(floors.map(floor => floor.id)) || !unique(floors.map(floor => `${floor.origin.x},${floor.origin.z}`))
    || !unique(posts.map(post => post.id))
    || !unique(stations.map(station => station.id)) || !unique(desks.map(desk => desk.id))
    || !unique(plots.map(plot => plot.id)) || !unique(deskAgents)
    || !unique(world.agents.map(agent => agent.agentId))
    || world.agents.length !== desks.length
    || world.lobbyPlots.length !== world.layout.lobbyPlots
  ) return false;
  if (!world.lobbyPlots.every((plot, index) => plot.index === index)) return false;
  if (!desks.every(desk => desk.plot.deskId === desk.id)) return false;
  if (
    !floors.every((floor, index) => {
      if (floor.index !== index || floor.posts.length !== world.layout.postsPerFloor) return false;
      const origin = floorOrigin(index, world.layout.postsPerFloor);
      if (floor.origin.x !== origin.x || floor.origin.z !== origin.z) return false;
      if ((floor._tag === "BlueprintFloor") !== (index === floors.length - 1)) return false;
      if (!unique(floor.posts.map(post => post.id))) return false;
      if (
        !floor.posts.every((post, postIndex) => {
          if (post.index !== postIndex) return false;
          const anchor = postAnchor(postIndex);
          if (post.anchor.x !== anchor.x || post.anchor.z !== anchor.z) return false;
          if (post._tag === "BlueprintTradingPost") return true;
          if (
            post.stations.length > world.layout.stationsPerPost || post.tokens.length > world.layout.monitorsPerPost
          ) return false;
          if (!post.stations.every((station, stationIndex) => station.index === stationIndex)) return false;
          if (
            !post.stations.every(station =>
              Option.exists(
                canonicalStationPosition(postIndex, station.index, world.layout.stationsPerPost),
                position => position.x === station.position.x && position.z === station.position.z,
              )
            )
          ) return false;
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
      const newerSameChain = openFloors.some(other => other.chain === floor.chain && other.index > floor.index);
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
}, { expected: "a consistent occupied world with one blueprint floor beside its active floors" }));

export class WorldChangeError extends Schema.TaggedError<WorldChangeError>()("WorldChangeError", {
  reason: Schema.Literals([
    "duplicateAgent",
    "unknownAgent",
    "unknownLocation",
    "unknownPlot",
    "floorFull",
    "invalidTopology",
    "wrongChain",
  ]),
  reference: Schema.String,
}) {}

export class WorldValidationError extends Schema.TaggedError<WorldValidationError>()("WorldValidationError", {
  operation: Schema.Literals(["createWorld", "assignAgent", "moveAgent", "assignPlot"]),
  reason: Schema.Literals(["invalidLayout", "invalidWorld"]),
  reference: WorldId,
  cause: Schema.Defect(),
}) {}
