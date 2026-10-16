import type { AgentId, ChainRef, DeskId, FloorId, TradingPostId } from "@floor/contract/identifiers";
import { AgentLocation, canonicalFloorSpan, type FloorPlace, type World } from "@floor/contract/world";
import { Array, Option } from "effect";

// Plan coordinates are absolute topology units on the ground plane. Floor
// origins are already applied, so consumers never repeat a layout rule.
export interface PlanPoint {
  readonly x: number;
  readonly z: number;
}
export interface PlanArea {
  readonly x0: number;
  readonly z0: number;
  readonly x1: number;
  readonly z1: number;
}
export interface PostPlan {
  readonly id: TradingPostId;
  readonly index: number;
  readonly anchor: PlanPoint;
  readonly open: boolean;
  // The radius a layout reserves around the anchor for the post and its
  // stations. None where the layout declares no envelope.
  readonly envelope: Option.Option<number>;
}
export interface PlacePlan {
  readonly place: typeof FloorPlace.Type;
  readonly position: PlanPoint;
  readonly area: PlanArea;
}
export interface FloorPlan {
  readonly id: FloorId;
  readonly index: number;
  readonly chain: ChainRef;
  readonly blueprint: boolean;
  readonly origin: PlanPoint;
  // A floor's ground. A layout without a footprint rule leaves it empty rather
  // than inventing one.
  readonly areas: ReadonlyArray<PlanArea>;
  // Passages through the wall this floor shares with the lobby or an earlier
  // floor. Floors that meet edge to edge, with no wall, have none.
  readonly doors: ReadonlyArray<PlanArea>;
  readonly posts: ReadonlyArray<PostPlan>;
  // Only places a layout actually reserves appear; an absent place has no point.
  readonly places: ReadonlyArray<PlacePlan>;
}
export interface StationPlan {
  readonly floor: number;
  readonly post: number;
  readonly station: number;
  readonly desk: DeskId;
  readonly agent: AgentId;
  readonly position: PlanPoint;
}
export interface LobbyPlan {
  // The lobby's ground and the footprints of the plots the world has. A layout
  // without a lobby rule leaves both empty.
  readonly areas: ReadonlyArray<PlanArea>;
  readonly plots: ReadonlyArray<PlanArea>;
  readonly places: ReadonlyArray<{ readonly place: "entrance" | "plots"; readonly position: PlanPoint }>;
}
export interface WorldPlan {
  readonly floors: Array.NonEmptyReadonlyArray<FloorPlan>;
  readonly stations: ReadonlyArray<StationPlan>;
  readonly lobby: LobbyPlan;
}

// The one seam through which viewers read where floors, posts, stations and
// places are. Topology (which floors, posts and stations exist, and who sits
// where) stays in the World; a layout only places it. A second layout plugs in
// by implementing this interface and becoming `canonicalLayout`.
export interface WorldLayout {
  readonly plan: (world: typeof World.Type) => WorldPlan;
}

const offset = (origin: PlanPoint, point: PlanPoint): PlanPoint => ({ x: origin.x + point.x, z: origin.z + point.z });

// The square spiral of post anchors and the grid of floor origins around the
// lobby. A validated World already carries these coordinates (its Schema checks
// them against the contract's canonical functions); this reads them and adds
// the matching square footprint. The rule positions no named places, post
// envelopes, doors or lobby, so the plan has none.
export const squareSpiralLayout: WorldLayout = {
  plan: world => {
    const span = canonicalFloorSpan(world.layout.postsPerFloor);
    const floors = Array.map(world.floors, (floor): FloorPlan => ({
      id: floor.id,
      index: floor.index,
      chain: floor.chain,
      blueprint: floor._tag === "BlueprintFloor",
      origin: floor.origin,
      areas: Option.match(span, {
        onNone: () => [],
        onSome: side => [{
          x0: floor.origin.x - side / 2,
          z0: floor.origin.z - side / 2,
          x1: floor.origin.x + side / 2,
          z1: floor.origin.z + side / 2,
        }],
      }),
      doors: [],
      posts: floor.posts.map(post => ({
        id: post.id,
        index: post.index,
        anchor: offset(floor.origin, post.anchor),
        open: post._tag === "OpenTradingPost",
        envelope: Option.none(),
      })),
      places: [],
    }));
    return {
      floors,
      stations: world.floors.flatMap(floor =>
        floor.posts.flatMap(post =>
          post._tag === "BlueprintTradingPost" ? [] : post.stations.map(station => ({
            floor: floor.index,
            post: post.index,
            station: station.index,
            desk: station.desk.id,
            agent: station.desk.agentId,
            position: offset(floor.origin, station.position),
          }))
        )
      ),
      lobby: { areas: [], plots: [], places: [] },
    };
  },
};

export const canonicalLayout: WorldLayout = squareSpiralLayout;

// Where a location stands in a plan. None means the layout positions no such
// place, so a viewer must not draw the agent somewhere it is not.
export const locate = (plan: WorldPlan, location: typeof AgentLocation.Type): Option.Option<PlanPoint> =>
  AgentLocation.match(location, {
    AtDesk: target =>
      Option.map(Array.findFirst(plan.stations, station => station.desk === target.deskId), item => item.position),
    AtPost: target =>
      Array.findFirst(plan.floors, floor => floor.posts.some(post => post.open && post.id === target.postId)).pipe(
        Option.flatMap(floor => Array.findFirst(floor.posts, post => post.id === target.postId)),
        Option.map(post => post.anchor),
      ),
    AtPlace: target =>
      Array.findFirst(plan.floors, floor => floor.id === target.floorId).pipe(
        Option.flatMap(floor => Array.findFirst(floor.places, item => item.place === target.place)),
        Option.map(item => item.position),
      ),
    InLobby: target =>
      Option.map(Array.findFirst(plan.lobby.places, item => item.place === target.place), item => item.position),
  });
