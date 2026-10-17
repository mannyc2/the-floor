import { describe, expect, test } from "bun:test";
import { Option } from "effect";
import * as THREE from "three";
import { clipNames, clips, framesPerClip, solvePose } from "../src/map/_lib/assets/rig";
import { boneStride, makeTrader } from "../src/map/_lib/assets/trader";
import { postLayout, seating, traderReach } from "../src/map/_lib/live-layout";
import { depthOf, lookOf, route } from "../src/map/_lib/renderer/crowd";

const clipPose = (clip: number, phase: number) => Option.getOrThrow(Option.fromUndefinedOr(clips[clip])).pose(phase);

// The trader's vertices in one pose, as the shader skins them: each part's
// bone rotates and places it, then the instance scales the build.
const posed = (clip: number, phase: number, width = 1, height = 1) => {
  const geometry = makeTrader(0);
  const position = geometry.getAttribute("position"), part = geometry.getAttribute("_PART");
  const solved = solvePose(clipPose(clip, phase));
  const points: Array<THREE.Vector3> = [];
  for (let index = 0; index < position.count; index++) {
    const bone = Math.round(part.getW(index)) % boneStride;
    const rotation = solved.rotation[bone] ?? new THREE.Quaternion();
    const scale = solved.scale[bone] ?? 1;
    if (scale === 0) continue;
    const point = new THREE.Vector3().fromBufferAttribute(position, index).multiplyScalar(scale).applyQuaternion(
      rotation,
    ).add(solved.position[bone] ?? new THREE.Vector3());
    points.push(point.multiply(new THREE.Vector3(width, height, depthOf(width))));
  }
  geometry.dispose();
  return points;
};

describe("seated traders", () => {
  // In the trader's frame the counter edge is ahead of the hip; the worktop
  // runs back from it, and the panel stands an overhang behind the edge.
  const edge = traderReach.seated, back = edge + postLayout.depth, panel = edge + postLayout.overhang;
  const top = postLayout.worktop - postLayout.plinthHeight, underside = top - .035;
  const seated = ["type", "phone", "read", "lean", "asleep"] as const;
  for (const name of seated) {
    test(`${name}: no part passes through the worktop or into the counter, at any build`, () => {
      for (const [width, height] of [[1, 1], [1.1, 1.04], [.92, .97]] as const) {
        for (let step = 0; step < framesPerClip; step += 2) {
          for (const point of posed(clipNames.indexOf(name), step / framesPerClip, width, height)) {
            const inSlab = point.z > edge + .005 && point.z < back && point.y > underside + .005
              && point.y < top - .005;
            const inBody = point.z > panel + .005 && point.z < back && point.y > .07 && point.y < underside;
            expect({ name, step, inSlab, inBody }).toEqual({ name, step, inSlab: false, inBody: false });
          }
        }
      }
    });
  }
  test("sit on the stool's seat", () => {
    for (const name of seated) {
      const pelvis = solvePose(clipPose(clipNames.indexOf(name), 0)).position[0];
      expect(Math.abs((pelvis?.y ?? 0) - .05 - seating.seat)).toBeLessThan(.02);
    }
  });
});

describe("the crowd", () => {
  test("routes bend around posts and leave and reach desks radially", () => {
    const posts = [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 8, z: .3 }];
    const radius = 1.4;
    const from = { x: 1.1, z: .2 }, to = { x: 8 - 1.05, z: .4 };
    const path = route(from, to, posts, radius);
    const points = [from, ...path];
    for (let index = 1; index < points.length; index++) {
      const a = points[index - 1] ?? from, b = points[index] ?? to;
      // Sample each leg; only the first and last legs may be inside a plinth.
      for (let k = .05; k < .95; k += .05) {
        const x = a.x + (b.x - a.x) * k, z = a.z + (b.z - a.z) * k;
        const clearance = Math.min(...posts.map(post => Math.hypot(post.x - x, post.z - z)));
        if (index > 1 && index < points.length - 1) expect(clearance).toBeGreaterThanOrEqual(radius - 1e-6);
      }
    }
    expect(path.at(-1)).toEqual(to);
  });

  test("a trader's look comes from its seed alone and names real palette slots", () => {
    for (const seed of [1, 7, 2166136261, 4294967295]) {
      const look = lookOf(seed);
      expect(lookOf(seed)).toEqual(look);
      for (const pair of look.look.slice(0, 3)) {
        expect(pair % 256).toBeGreaterThan(3);
        expect(Math.floor(pair / 256)).toBeGreaterThan(3);
      }
    }
  });
});
