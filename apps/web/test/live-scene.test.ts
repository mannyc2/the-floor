import { figureHeight, roomyRecipe } from "@floor/atlas/proportions";
import { describe, expect, test } from "bun:test";
import { Option } from "effect";
import * as THREE from "three";
import { makePost, makeStation, stationVariants } from "../src/map/_lib/assets";
import { isKitMesh } from "../src/map/_lib/assets/geometry";
import { createLiveScene, wallPlan } from "../src/map/_lib/renderer/live-scene";
import { postKeys } from "../src/map/model";

const square = (x: number, z: number, side: number) => ({ x0: x, z0: z, x1: x + side, z1: z + side });
const length = (pieces: ReadonlyArray<{ readonly from: number; readonly to: number }>) =>
  pieces.reduce((total, piece) => total + piece.to - piece.from, 0);

describe("live walls", () => {
  test("floors meeting edge to edge without doors share no wall, and blueprints are unbuilt", () => {
    const walls = wallPlan({
      rooms: [
        { areas: [square(0, 0, 10)], blueprint: false },
        { areas: [square(10, 0, 10)], blueprint: false },
        { areas: [square(0, 10, 10)], blueprint: true },
      ],
      lobby: [],
      doors: [],
    });
    // The two built floors' outline: 20 by 10. The blueprint adds nothing,
    // so the side the first floor shares with it is that floor's outside.
    expect(length(walls.exterior)).toBe(60);
    expect(walls.partitions).toEqual([]);
    expect(walls.sills).toEqual([]);
  });

  test("rooms that declare doors share a partition with a gap and a sill at each door", () => {
    const door = { x0: 9, z0: 4, x1: 11, z1: 6 };
    const walls = wallPlan({
      rooms: [
        { areas: [square(0, 0, 10)], blueprint: false },
        { areas: [square(10, 0, 10)], blueprint: false },
      ],
      lobby: [],
      doors: [door],
    });
    expect(length(walls.exterior)).toBe(60);
    // One copy of the shared line at x = 10, less the two-unit door.
    expect(walls.partitions.map(piece => [piece.axis, piece.at, piece.from, piece.to])).toEqual([
      ["x", 10, 0, 4],
      ["x", 10, 6, 10],
    ]);
    expect(walls.sills.map(piece => [piece.at, piece.from, piece.to])).toEqual([[10, 4, 6]]);
  });

  test("a hall and its wing are one room, so their seam is no wall", () => {
    const walls = wallPlan({
      rooms: [{ areas: [square(0, 0, 10), { x0: 10, z0: 2, x1: 14, z1: 8 }], blueprint: false }],
      lobby: [],
      doors: [],
    });
    expect(length(walls.exterior)).toBe(10 + 10 + 10 + 4 + 6 + 4 + 2 + 2);
  });
});

// Every vertex of a world-space mesh, for clearance checks.
const vertices = (group: THREE.Group, transform: THREE.Matrix4) => {
  const points: Array<THREE.Vector3> = [];
  group.traverse(node => {
    if (!isKitMesh(node)) return;
    const position = node.geometry.getAttribute("position");
    for (let index = 0; index < position.count; index++) {
      points.push(new THREE.Vector3().fromBufferAttribute(position, index).applyMatrix4(transform));
    }
  });
  return points;
};

describe("live stations on a fuller post", () => {
  for (const stations of [8, 10, 12]) {
    test(`${stations} stations sit on the counter, clear of the crown, the pole and each other`, () => {
      const post = makePost({ stations, monitors: 7, segments: 40 });
      const radius = roomyRecipe.counterRadiusRatio * figureHeight;
      const top = roomyRecipe.worktopRatio * figureHeight;
      const crownUnderside = roomyRecipe.monitorCrownRatio * figureHeight - 2.72;
      // The counter is the post's only part under the stations, and its top is
      // the worktop the stations stand on.
      const band = (point: THREE.Vector3) =>
        Math.hypot(point.x, point.z) > radius - roomyRecipe.stationDepthRatio * figureHeight - .3;
      for (const point of vertices(post, new THREE.Matrix4()).filter(band)) {
        if (point.y < crownUnderside) expect(point.y).toBeLessThanOrEqual(top + 1e-6);
      }
      // The live scene narrows a station by the chord ratio past eight a post.
      const narrow = Math.min(1, Math.sin(Math.PI / stations) / Math.sin(Math.PI / 8));
      for (const variant of stationVariants) {
        const station = makeStation(variant, "live");
        const placed = vertices(
          station,
          new THREE.Matrix4().makeRotationY(0).setPosition(0, 0, radius).multiply(
            new THREE.Matrix4().makeScale(narrow, 1, 1),
          ),
        );
        for (const point of placed) {
          // On the worktop, under the crown's screens and outside the pole.
          expect(point.y).toBeGreaterThanOrEqual(top - 1e-6);
          expect(point.y).toBeLessThan(crownUnderside);
          expect(Math.hypot(point.x, point.z)).toBeGreaterThan(
            radius - roomyRecipe.stationDepthRatio * figureHeight - .3,
          );
          // Within its own share of the ring, so neighbours never meet.
          expect(Math.abs(Math.atan2(point.x, point.z))).toBeLessThan(Math.PI / stations);
        }
      }
    });
  }
});

describe("live scene", () => {
  test("allocates a station per desk, a figure per desk and pose, and two meshes of post slots", () => {
    const material = new THREE.MeshBasicMaterial();
    const scene = createLiveScene(
      {
        unitsPerH: 8 / roomyRecipe.postPitchRatio,
        stationsPerPost: 10,
        monitorsPerPost: 7,
        posts: 3,
        rooms: [{ areas: [square(-20, -20, 40)], blueprint: false }],
        lobby: [],
        doors: [],
        places: [],
        plots: [],
        bounds: square(-20, -20, 40),
        snapshot: { revision: 0, instances: [] },
      },
      20,
      material,
    );
    const slots = (name: string) => scene.entities.filter(entity => entity.mesh.name === name);
    expect(slots("live-station-operator").map(entity => entity.id)).toEqual([2, 4, 6, 8, 10, 12, 14, 16, 18, 20]);
    expect(slots("live-station-analyst").map(entity => entity.id)).toEqual([3, 5, 7, 9, 11, 13, 15, 17, 19, 21]);
    for (const [variant, pose] of ["seated", "standing", "walking"].entries()) {
      const figures = slots(`live-figure-${pose}`);
      expect(figures).toHaveLength(20);
      expect(figures.every(entity => entity.marker === true && entity.variant === variant)).toBe(true);
    }
    expect(slots("live-post").map(entity => entity.id)).toEqual([0, 1, 2].map(index => postKeys.open + index));
    expect(slots("live-blueprint-post").map(entity => entity.id)).toEqual(
      [0, 1, 2].map(index => postKeys.blueprint + index),
    );
    // A figure picks as its desk; posts and walls as identities no desk has.
    const picked = (name: string) =>
      Option.fromUndefinedOr(scene.meshes.find(mesh => mesh.name === name)?.geometry.getAttribute("_ENTITY"));
    expect(Option.map(picked("live-figure-seated"), attribute => attribute.getX(5))).toEqual(Option.some(7));
    expect(Option.map(picked("live-post"), attribute => attribute.getX(0))).toEqual(Option.some(4094));
    // The room's four outside walls are cut away by camera corner.
    expect(scene.boundaries.length).toBeGreaterThanOrEqual(4);
    scene.geometries.forEach(geometry => geometry.dispose());
    material.dispose();
  });
});
