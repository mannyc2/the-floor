import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import * as THREE from "three";
import { clipIndex, gaits } from "../src/map/_lib/assets/clips";
import {
  decodeTraderKit,
  encodeTraderKit,
  props,
  skinScale,
  type TraderKit,
  visibility,
} from "../src/map/_lib/assets/trader-kit";
import { postLayout, seating, traderReach } from "../src/map/_lib/live-layout";
import { depthOf, lookOf, route } from "../src/map/_lib/renderer/crowd";
import { effectTest } from "./_runtime";
import { bakeKit } from "./_trader-kit";

// The trader's vertices at one baked frame of a clip, skinned as the shader
// does, for one body and hairstyle, then scaled by the instance's build.
const posed = (kit: TraderKit, clip: number, frame: number, body: 0 | 1, width = 1, height = 1) => {
  const { motion, header } = kit;
  const row = (clip * header.frames + frame) * header.motion.width * 4;
  const shown = new Set([
    visibility.always,
    visibility.body(body === 0 ? "male" : "female"),
    visibility.hair("parted"),
  ]);
  const points: Array<THREE.Vector3> = [];
  const source = new THREE.Vector3(), sum = new THREE.Vector3();
  for (let vertex = 0; vertex < header.vertices; vertex++) {
    if (!shown.has(Math.round(kit.part[vertex * 4 + 3] ?? -1))) continue;
    sum.set(0, 0, 0);
    let hidden = false;
    for (let k = 0; k < 4; k++) {
      const lane = kit.skin[vertex * 4 + k] ?? 0;
      const weight = lane % skinScale, bone = Math.floor(lane / skinScale);
      if (weight === 0) break;
      const at = row + bone * 8;
      const q = new THREE.Quaternion(motion[at], motion[at + 1], motion[at + 2], motion[at + 3]);
      const scale = motion[at + 7] ?? 1;
      if (scale === 0) hidden = true;
      source.fromArray(kit.position, vertex * 3).multiplyScalar(scale).applyQuaternion(q)
        .add(new THREE.Vector3(motion[at + 4], motion[at + 5], motion[at + 6]));
      sum.addScaledVector(source, weight / 255);
    }
    if (!hidden) points.push(sum.clone().multiply(new THREE.Vector3(width, height, depthOf(width))));
  }
  return points;
};

describe("the trader kit", () => {
  effectTest("survives its file: geometry exactly, motion within half-float precision", () =>
    Effect.gen(function*() {
      const kit = yield* bakeKit;
      const bytes = yield* encodeTraderKit(kit);
      const read = yield* decodeTraderKit(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      expect(read.header).toEqual(kit.header);
      for (const lane of ["position", "normal", "part", "skin", "index"] as const) {
        expect(Array.from(read[lane])).toEqual(Array.from(kit[lane]));
      }
      const worst = kit.motion.reduce(
        (most, value, index) => Math.max(most, Math.abs(value - (read.motion[index] ?? 0))),
        0,
      );
      expect(worst).toBeLessThan(2e-3);
    }));
  effectTest("holds both bodies, every hairstyle and the props, skinned to its skeleton", () =>
    Effect.gen(function*() {
      const kit = yield* bakeKit;
      const groups = new Set<number>();
      for (let vertex = 0; vertex < kit.header.vertices; vertex++) groups.add(kit.part[vertex * 4 + 3] ?? -1);
      expect([...groups].toSorted((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 8, 9]);
      expect(kit.header.bones.slice(-props.length)).toEqual([...props]);
      for (let lane = 0; lane < kit.skin.length; lane += 4) {
        const weights = [0, 1, 2, 3].map(k => (kit.skin[lane + k] ?? 0) % skinScale);
        expect(weights.reduce((sum, weight) => sum + weight, 0)).toBe(255);
      }
    }));
});

// How far one loop of a gait carries the figure: the distance the planted
// foot slides back under the body, frame to frame, while it bears weight.
const strideOf = (kit: TraderKit, clip: number) => {
  const bone = kit.header.bones.indexOf("ball_l");
  // The ball of the foot in the bind pose: the vertices it carries most.
  const carried = Array.from({ length: kit.header.vertices }, (_, vertex) => vertex)
    .filter(vertex => Math.floor((kit.skin[vertex * 4] ?? 0) / skinScale) === bone);
  const bind = carried.reduce(
    (sum, vertex) => sum.add(new THREE.Vector3().fromArray(kit.position, vertex * 3)),
    new THREE.Vector3(),
  )
    .divideScalar(Math.max(1, carried.length));
  const { frames } = kit.header;
  const path = Array.from({ length: frames }, (_, frame) => {
    const at = (clip * frames + frame) * kit.header.motion.width * 4 + bone * 8, m = kit.motion;
    return bind.clone().multiplyScalar(m[at + 7] ?? 1).applyQuaternion(
      new THREE.Quaternion(m[at], m[at + 1], m[at + 2], m[at + 3]),
    )
      .add(new THREE.Vector3(m[at + 4], m[at + 5], m[at + 6]));
  });
  const ground = Math.min(...path.map(point => point.y));
  const slides = path.flatMap((point, frame) => {
    const next = path[(frame + 1) % frames] ?? point;
    return point.y < ground + .012 && next.y < ground + .012 ? [point.z - next.z] : [];
  }).toSorted((a, b) => a - b);
  return (slides[Math.floor(slides.length / 2)] ?? 0) * frames;
};

describe("walking traders", () => {
  for (const gait of ["walk", "hurry"] as const) {
    effectTest(
      `${gait}: its catalogue stride matches the baked clip, so feet do not skate`,
      () =>
        Effect.gen(function*() {
          const kit = yield* bakeKit;
          const stride = strideOf(kit, clipIndex(gait));
          expect({ gait, close: Math.abs(stride / gaits[gait].unitsPerCycle - 1) < .12 }).toEqual({
            gait,
            close: true,
          });
        }),
    );
  }
});

describe("seated traders", () => {
  // In the trader's frame the counter edge is ahead of the hip; the worktop
  // runs back from it, and the panel stands an overhang behind the edge.
  const edge = traderReach.seated, back = edge + postLayout.depth, panel = edge + postLayout.overhang;
  const top = postLayout.worktop - postLayout.plinthHeight, underside = top - .035;
  const seated = ["type", "phone", "read", "lean", "asleep"] as const;
  for (const name of seated) {
    effectTest(
      `${name}: no part passes through the worktop or into the counter, at any build`,
      () =>
        Effect.gen(function*() {
          const kit = yield* bakeKit;
          for (const body of [0, 1] as const) {
            for (const [width, height] of [[1, 1], [1.1, 1.04], [.92, .97]] as const) {
              for (let frame = 0; frame < kit.header.frames; frame += 3) {
                for (const point of posed(kit, clipIndex(name), frame, body, width, height)) {
                  const inSlab = point.z > edge + .005 && point.z < back && point.y > underside + .005
                    && point.y < top - .005;
                  const inBody = point.z > panel + .005 && point.z < back && point.y > .07 && point.y < underside;
                  expect({ name, body, frame, inSlab, inBody }).toEqual({
                    name,
                    body,
                    frame,
                    inSlab: false,
                    inBody: false,
                  });
                }
              }
            }
          }
        }),
    );
  }
  effectTest("sit on the stool's seat", () =>
    Effect.gen(function*() {
      const kit = yield* bakeKit;
      for (const name of seated) {
        // The lowest point of the seat of the trousers, between the knees and the back.
        const seat = Math.min(
          ...posed(kit, clipIndex(name), 0, 0).filter(point => Math.abs(point.x) < .08 && point.z < .02 && point.y > .3)
            .map(point => point.y),
        );
        expect({ name, onSeat: Math.abs(seat - seating.seat) < .025 }).toEqual({ name, onSeat: true });
      }
    }));
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
