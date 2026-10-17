import { describe, expect, test } from "bun:test";
import { Option } from "effect";
import * as THREE from "three";
import { liveStationVariants, makeLiveStation } from "../src/map/_lib/assets/floor-kit";
import { isKitMesh } from "../src/map/_lib/assets/geometry";
import { postLayout } from "../src/map/_lib/live-layout";
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

describe("live stations", () => {
  for (const stations of [8, 10, 12]) {
    test(`at ${stations} to a post, each station's things rest on the worktop or the floor within its own share`, () => {
      const { counterEdge, depth, worktop, overhang } = postLayout;
      for (let variant = 0; variant < liveStationVariants; variant++) {
        for (const point of vertices(makeLiveStation(variant, stations), new THREE.Matrix4())) {
          // Inside the counter edge a thing stands on the worktop, or tucks
          // under its overhang in front of the panel, as a stool does: never
          // inside the counter.
          if (point.z < -1e-3) {
            const onTop = point.y >= worktop - 1e-6 && point.z > -depth;
            const tucked = point.y <= worktop - .035 && point.z > -overhang;
            expect(onTop || tucked).toBe(true);
          }
          // Within its own share of the ring, so neighbours never meet.
          expect(Math.abs(Math.atan2(point.x, point.z + counterEdge))).toBeLessThan(Math.PI / stations);
        }
      }
    });
  }
});

describe("live scene", () => {
  test("allocates a station per desk, one trader mesh and two meshes of post slots", () => {
    const material = new THREE.MeshBasicMaterial();
    const scene = createLiveScene(
      {
        unitsPerH: 8 / postLayout.pitch,
        stationsPerPost: 10,
        monitorsPerPost: 7,
        posts: 3,
        rooms: [{ areas: [square(-20, -20, 40)], blueprint: false }],
        lobby: [],
        doors: [],
        places: [],
        plots: [],
        postAnchors: [{ x: 0, z: 0 }, { x: 8, z: 0 }, { x: 0, z: 8 }],
        bounds: square(-20, -20, 40),
        snapshot: { revision: 0, instances: [] },
      },
      20,
      material,
      material,
    );
    const slots = (name: string) => scene.entities.filter(entity => entity.mesh.name === name);
    const stationIds = Array.from({ length: liveStationVariants }, (_, variant) => slots(`live-station-${variant}`))
      .flat().map(entity => entity.id).toSorted((a, b) => a - b);
    expect(stationIds).toEqual(Array.from({ length: 20 }, (_, index) => index + 2));
    expect(slots("live-post").map(entity => entity.id)).toEqual([0, 1, 2].map(index => postKeys.open + index));
    expect(slots("live-blueprint-post").map(entity => entity.id)).toEqual(
      [0, 1, 2].map(index => postKeys.blueprint + index),
    );
    // Every desk has a trader instance, picking as its desk; the crowd, not
    // the snapshot, places them.
    const traders = Option.getOrThrow(Option.fromUndefinedOr(scene.traders));
    expect(traders.count).toBe(20);
    expect(scene.entities.some(entity => entity.mesh === traders)).toBe(false);
    expect(traders.geometry.getAttribute("_ENTITY").getX(5)).toBe(7);
    const picked = (name: string) =>
      Option.fromUndefinedOr(scene.meshes.find(mesh => mesh.name === name)?.geometry.getAttribute("_ENTITY"));
    expect(Option.map(picked("live-post"), attribute => attribute.getX(0))).toEqual(Option.some(4094));
    // The room's four outside walls are cut away by camera corner.
    expect(scene.boundaries.length).toBeGreaterThanOrEqual(4);
    scene.geometries.forEach(geometry => geometry.dispose());
    material.dispose();
  });
});
