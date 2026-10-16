import { AgentId, ChainRef, FloorId, TradingPostId, WorldId } from "@floor/contract/identifiers";
import {
  AgentLocation,
  canonicalFloorOrigin,
  canonicalFloorSpan,
  canonicalPostAnchor,
  canonicalStationPosition,
} from "@floor/contract/world";
import { assignAgent, createWorld, defaultLayout } from "@floor/world";
import { canonicalLayout, locate, type PlanArea, type PlanPoint, squareSpiralLayout } from "@floor/world/layout";
import { expect, test } from "bun:test";
import { Array, Option, Result } from "effect";

const chain = ChainRef.make("solana:layout");
const config = { ...defaultLayout, postsPerFloor: 2, stationsPerPost: 8 };
const occupied = (agents: number) =>
  Array.range(0, agents - 1).reduce(
    (world, index) => Result.getOrThrow(assignAgent(world, AgentId.make(`agent_${index}`), chain)),
    Result.getOrThrow(createWorld(WorldId.make("layout"), chain, config)),
  );
const inside = (area: PlanArea, point: PlanPoint) =>
  point.x > area.x0 && point.x < area.x1 && point.z > area.z0 && point.z < area.z1;
const overlaps = (a: PlanArea, b: PlanArea) => a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1;

test("the production layout is the square spiral, read through one plan", () => {
  expect(canonicalLayout).toBe(squareSpiralLayout);
});

test("plans place every floor, post and station from the canonical rules", () => {
  // Two full floors of one chain and a third partly occupied, beside a blueprint.
  const world = occupied(2 * 16 + 3);
  const plan = canonicalLayout.plan(world);
  expect(plan.floors.map(floor => [floor.index, floor.blueprint])).toEqual([
    [0, false],
    [1, false],
    [2, false],
    [3, true],
  ]);
  const span = Option.getOrThrow(canonicalFloorSpan(config.postsPerFloor));
  for (const floor of plan.floors) {
    const origin = Option.getOrThrow(canonicalFloorOrigin(floor.index, config.postsPerFloor));
    expect(floor.origin).toEqual(origin);
    expect(floor.areas).toEqual([{
      x0: origin.x - span / 2,
      z0: origin.z - span / 2,
      x1: origin.x + span / 2,
      z1: origin.z + span / 2,
    }]);
    for (const post of floor.posts) {
      const anchor = Option.getOrThrow(canonicalPostAnchor(post.index));
      expect(post.anchor).toEqual({ x: origin.x + anchor.x, z: origin.z + anchor.z });
      expect(floor.areas.every(area => inside(area, post.anchor))).toBe(true);
    }
    expect(floor.places).toEqual([]);
  }
  expect(plan.stations).toHaveLength(35);
  for (const station of plan.stations) {
    const origin = Option.getOrThrow(canonicalFloorOrigin(station.floor, config.postsPerFloor));
    const position = Option.getOrThrow(canonicalStationPosition(station.post, station.station, config.stationsPerPost));
    expect(station.position).toEqual({ x: origin.x + position.x, z: origin.z + position.z });
    const floor = Option.getOrThrow(Array.get(plan.floors, station.floor));
    expect(floor.areas.every(area => inside(area, station.position))).toBe(true);
  }
  const areas = plan.floors.flatMap(floor => floor.areas);
  for (const [index, area] of areas.entries()) {
    expect(areas.slice(index + 1).some(other => overlaps(area, other))).toBe(false);
  }
  // The square spiral declares no doors, post envelopes or lobby.
  expect(plan.floors.every(floor => floor.doors.length === 0)).toBe(true);
  expect(plan.floors.every(floor => floor.posts.every(post => Option.isNone(post.envelope)))).toBe(true);
  expect(plan.lobby).toEqual({ areas: [], plots: [], places: [] });
});

test("locations resolve only where the layout positions them", () => {
  const world = occupied(9);
  const plan = canonicalLayout.plan(world);
  const first = Option.getOrThrow(Array.head(plan.stations));
  const second = Option.getOrThrow(Array.get(plan.stations, 1));
  const post = Option.getOrThrow(Array.head(Option.getOrThrow(Array.head(plan.floors)).posts));
  expect(locate(plan, AgentLocation.cases.AtDesk.make({ deskId: first.desk }))).toEqual(Option.some(first.position));
  expect(locate(plan, AgentLocation.cases.AtDesk.make({ deskId: second.desk }))).toEqual(
    Option.some(second.position),
  );
  expect(locate(plan, AgentLocation.cases.AtPost.make({ postId: post.id }))).toEqual(Option.some(post.anchor));
  // A blueprint post has an anchor but nobody can work there yet.
  expect(
    Option.isNone(locate(plan, AgentLocation.cases.AtPost.make({ postId: TradingPostId.make("floor_1_post_0") }))),
  ).toBe(true);
  // The square spiral has no rule for named places or lobby destinations.
  expect(
    Option.isNone(locate(plan, AgentLocation.cases.AtPlace.make({ floorId: FloorId.make("floor_0"), place: "board" }))),
  ).toBe(true);
  expect(Option.isNone(locate(plan, AgentLocation.cases.InLobby.make({ place: "entrance" })))).toBe(true);
});
