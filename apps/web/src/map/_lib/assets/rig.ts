import { Option } from "effect";
import * as THREE from "three";
import { seating } from "../live-layout";

// The trader's skeleton and its motion library. Figures are rigid parts, each
// bound to one bone, so a pose is one rotation and one position per bone.
// Clips are authored as torso angles plus hand and foot targets solved by
// two-bone IK, then baked once into a float texture the vertex shader samples:
// a thousand figures animate without a CPU skeleton each.
//
// Coordinates are the nominal standing figure, H = 1, facing +Z with its left
// side toward +X. A bone's rest rotation is the identity.

export const boneNames = [
  "pelvis",
  "spine",
  "chest",
  "head",
  "upperArmL",
  "foreArmL",
  "handL",
  "upperArmR",
  "foreArmR",
  "handR",
  "thighL",
  "shinL",
  "footL",
  "thighR",
  "shinR",
  "footR",
  // Props ride their own bones so a clip shows or hides them by scale.
  "handset",
  "slip",
  "plane",
  "cup",
] as const;
export type Bone = (typeof boneNames)[number];
export const bone = (name: Bone) => boneNames.indexOf(name);
type V3 = readonly [number, number, number];

export const restJoints: Record<Bone, V3> = {
  pelvis: [0, .5, 0],
  spine: [0, .585, 0],
  chest: [0, .675, 0],
  head: [0, .8, 0],
  upperArmL: [.122, .772, 0],
  foreArmL: [.135, .612, -.005],
  handL: [.142, .468, .008],
  upperArmR: [-.122, .772, 0],
  foreArmR: [-.135, .612, -.005],
  handR: [-.142, .468, .008],
  thighL: [.056, .488, 0],
  shinL: [.058, .268, .008],
  footL: [.06, .055, 0],
  thighR: [-.056, .488, 0],
  shinR: [-.058, .268, .008],
  footR: [-.06, .055, 0],
  handset: [0, 0, 0],
  slip: [0, 0, 0],
  plane: [0, 0, 0],
  cup: [0, 0, 0],
};

type Frame = "model" | "pelvis" | "chest" | "head";
interface Hand {
  readonly at: V3;
  readonly frame?: Frame;
  // Which way the elbow points; the IK keeps the arm in the plane it spans.
  readonly pole: V3;
  readonly wrist?: V3;
}
interface Foot {
  readonly at: V3;
  readonly yaw?: number;
  readonly pitch?: number;
}
interface Prop {
  readonly follows: "handL" | "handR" | "head";
  readonly offset?: V3;
  readonly rotation?: V3;
}
export interface Pose {
  readonly lift?: V3;
  readonly pelvis?: V3;
  readonly spine?: V3;
  readonly chest?: V3;
  readonly head?: V3;
  readonly handL: Hand;
  readonly handR: Hand;
  readonly footL: Foot;
  readonly footR: Foot;
  readonly props?: Partial<Record<"handset" | "slip" | "plane" | "cup", Prop>>;
}

const vector = (value: V3) => new THREE.Vector3(...value);
const euler = (value: V3 = [0, 0, 0]) => new THREE.Quaternion().setFromEuler(new THREE.Euler(...value, "YXZ"));
const lengthOf = (from: Bone, to: Bone) => vector(restJoints[to]).distanceTo(vector(restJoints[from]));

// An orthonormal frame from a segment's direction and its hinge axis.
const frame = (y: THREE.Vector3, axis: THREE.Vector3) => {
  const x = axis.clone().addScaledVector(y, -axis.dot(y)).normalize();
  return new THREE.Matrix4().makeBasis(x, y, new THREE.Vector3().crossVectors(x, y));
};
// A limb segment's rotation from its direction and the limb's hinge axis: the
// rest frame (rest direction, rest hinge) maps onto the posed one.
const segmentRotation = (
  restDirection: THREE.Vector3,
  restHinge: THREE.Vector3,
  direction: THREE.Vector3,
  hinge: THREE.Vector3,
) => {
  const rest = frame(restDirection, restHinge);
  return new THREE.Quaternion().setFromRotationMatrix(frame(direction, hinge).multiply(rest.transpose()));
};

interface Chain {
  readonly root: Bone;
  readonly middle: Bone;
  readonly end: Bone;
  // The rest pose's pole: elbows point back, knees forward.
  readonly restPole: V3;
}
const chains = {
  armL: { root: "upperArmL", middle: "foreArmL", end: "handL", restPole: [0, 0, -1] },
  armR: { root: "upperArmR", middle: "foreArmR", end: "handR", restPole: [0, 0, -1] },
  legL: { root: "thighL", middle: "shinL", end: "footL", restPole: [0, 0, 1] },
  legR: { root: "thighR", middle: "shinR", end: "footR", restPole: [0, 0, 1] },
} as const satisfies Record<string, Chain>;

type Solved = { rotation: Array<THREE.Quaternion>; position: Array<THREE.Vector3>; scale: Array<number> };

// Two-bone IK: places the middle joint so both segments keep their length,
// bending toward the pole. An unreachable target straightens the limb toward it.
const solveChain = (solved: Solved, chain: Chain, start: THREE.Vector3, target: THREE.Vector3, pole: THREE.Vector3) => {
  const upper = lengthOf(chain.root, chain.middle), lower = lengthOf(chain.middle, chain.end);
  const toTarget = target.clone().sub(start);
  const distance = Math.min(upper + lower - 1e-4, Math.max(Math.abs(upper - lower) + 1e-4, toTarget.length()));
  const along = toTarget.normalize();
  const bend = pole.clone().addScaledVector(along, -pole.dot(along));
  if (bend.lengthSq() < 1e-8) bend.set(0, 0, 1).addScaledVector(along, -along.z);
  bend.normalize();
  const a = (upper * upper - lower * lower + distance * distance) / (2 * distance);
  const h = Math.sqrt(Math.max(0, upper * upper - a * a));
  const middle = start.clone().addScaledVector(along, a).addScaledVector(bend, h);
  const end = start.clone().addScaledVector(along, distance);
  const restRoot = vector(restJoints[chain.root]), restMiddle = vector(restJoints[chain.middle]);
  const restUpper = restMiddle.clone().sub(restRoot).normalize();
  const restLower = vector(restJoints[chain.end]).sub(restMiddle).normalize();
  const restHinge = new THREE.Vector3().crossVectors(restUpper, vector(chain.restPole)).normalize();
  const hinge = new THREE.Vector3().crossVectors(along, bend).normalize();
  solved.rotation[bone(chain.root)] = segmentRotation(
    restUpper,
    restHinge,
    middle.clone().sub(start).normalize(),
    hinge,
  );
  solved.rotation[bone(chain.middle)] = segmentRotation(
    restLower,
    restHinge,
    end.clone().sub(middle).normalize(),
    hinge,
  );
  solved.position[bone(chain.root)] = start;
  solved.position[bone(chain.middle)] = middle;
  solved.position[bone(chain.end)] = end;
};

export const solvePose = (pose: Pose): Solved => {
  const solved: Solved = {
    rotation: boneNames.map(() => new THREE.Quaternion()),
    position: boneNames.map(name => vector(restJoints[name])),
    scale: boneNames.map(() => 1),
  };
  const at = (name: Bone) => solved.position[bone(name)] ?? new THREE.Vector3();
  const turn = (name: Bone) => solved.rotation[bone(name)] ?? new THREE.Quaternion();
  // A joint's position under its parent's posed transform.
  const child = (parent: Bone, name: Bone) =>
    vector(restJoints[name]).sub(vector(restJoints[parent])).applyQuaternion(turn(parent)).add(at(parent));
  solved.rotation[bone("pelvis")] = euler(pose.pelvis);
  solved.position[bone("pelvis")] = vector(restJoints.pelvis).add(vector(pose.lift ?? [0, 0, 0]));
  for (
    const [parent, name, angles] of [
      ["pelvis", "spine", pose.spine],
      ["spine", "chest", pose.chest],
      ["chest", "head", pose.head],
    ] as const
  ) {
    solved.position[bone(name)] = child(parent, name);
    solved.rotation[bone(name)] = turn(parent).clone().multiply(euler(angles));
  }
  const place = (target: Hand) => {
    const relative = target.frame ?? "model";
    return relative === "model"
      ? vector(target.at)
      : vector(target.at).applyQuaternion(turn(relative)).add(at(relative));
  };
  for (const [chain, hand] of [[chains.armL, pose.handL], [chains.armR, pose.handR]] as const) {
    solveChain(solved, chain, child("chest", chain.root), place(hand), vector(hand.pole));
    solved.rotation[bone(chain.end)] = turn(chain.middle).clone().multiply(euler(hand.wrist));
  }
  for (const [chain, foot] of [[chains.legL, pose.footL], [chains.legR, pose.footR]] as const) {
    solveChain(solved, chain, child("pelvis", chain.root), vector(foot.at), new THREE.Vector3(0, .25, 1));
    solved.rotation[bone(chain.end)] = euler([foot.pitch ?? 0, foot.yaw ?? 0, 0]);
  }
  for (const prop of ["handset", "slip", "plane", "cup"] as const) {
    Option.match(Option.fromUndefinedOr(pose.props?.[prop]), {
      // A prop nobody holds collapses to its bone.
      onNone: () => {
        solved.scale[bone(prop)] = 0;
      },
      onSome: held => {
        solved.rotation[bone(prop)] = turn(held.follows).clone().multiply(euler(held.rotation));
        solved.position[bone(prop)] = vector(held.offset ?? [0, 0, 0]).applyQuaternion(turn(held.follows)).add(
          at(held.follows),
        );
      },
    });
  }
  return solved;
};

// Clip authoring helpers. `t` runs 0..1 over a clip's loop.
const TAU = Math.PI * 2;
const wave = (t: number, cycles = 1, phase = 0) => Math.sin((t * cycles + phase) * TAU);
const smooth = (edge0: number, edge1: number, x: number) => {
  const k = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return k * k * (3 - 2 * k);
};
// Up over [a, b], held, and down over [c, d].
const window = (t: number, a: number, b: number, c: number, d: number) => smooth(a, b, t) * (1 - smooth(c, d, t));
const mix = (
  a: V3,
  b: V3,
  k: number,
): V3 => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

const seated = {
  lift: [0, seating.seat + .05 - restJoints.pelvis[1], 0],
  footL: { at: [.075, seating.footRing + .02, .12], yaw: .12 },
  footR: { at: [-.075, seating.footRing + .02, .12], yaw: -.12 },
} as const satisfies Partial<Pose>;
const standing = (shift = 0): Pick<Pose, "footL" | "footR"> => ({
  footL: { at: [.074 + shift * .2, .055, .015], yaw: .14 },
  footR: { at: [-.074 + shift * .2, .055, -.015], yaw: -.14 },
});
// Hands hanging at the sides, following the chest.
const hanging = (side: 1 | -1, swing = 0): Hand => ({
  frame: "chest",
  at: [side * .148, -.2, .025 + swing],
  pole: [side * .25, 0, -1],
});
// A wrist beside the right or left ear, holding a handset to it.
const atEar = (side: 1 | -1): Hand => ({ frame: "head", at: [side * .088, .05, .045], pole: [side, -.7, .1] });
const handset = (side: 1 | -1): Prop => ({
  follows: "head",
  offset: [side * .082, .118, .012],
  rotation: [-.55, 0, side * -.12],
});

// A step cycle: the foot is planted for `stance` of the loop, sliding back
// under the moving body, then swings forward. Matching the clip rate to the
// walking speed keeps planted feet still on the floor.
const stride = (t: number, amplitude: number, stance: number, lift: number, side: 1 | -1): Foot => {
  const swing = t >= stance;
  const k = swing ? smooth(stance, 1, t) : t / stance;
  const z = swing ? -amplitude / 2 + amplitude * k : amplitude / 2 - amplitude * k;
  const air = swing ? Math.sin(Math.PI * (t - stance) / (1 - stance)) : 0;
  return {
    at: [side * .07, .055 + lift * air, z],
    yaw: side * .08,
    pitch: swing ? -.35 * Math.sin(Math.PI * (t - stance) / (1 - stance)) : 0,
  };
};

export interface Clip {
  readonly name: ClipName;
  readonly seconds: number;
  readonly pose: (t: number) => Pose;
}
export const clipNames = [
  "type",
  "phone",
  "read",
  "lean",
  "asleep",
  "idle",
  "call",
  "bid",
  "walk",
  "hurry",
  "counter",
  "talk",
  "throw",
  "cheer",
  "slump",
  "pin",
  "ring",
  "coffee",
] as const;
export type ClipName = (typeof clipNames)[number];
export const clipIndex = (name: ClipName) => clipNames.indexOf(name);

// Walking cycles cover `amplitude` of floor per stance; the crowd turns speed
// into a clip rate with these, so feet do not skate.
export const gaits = {
  walk: { amplitude: .4, stance: .6, seconds: 1.05 },
  hurry: { amplitude: .52, stance: .42, seconds: .72 },
} as const;
export const cyclesPerUnit = (gait: keyof typeof gaits) => gaits[gait].stance / gaits[gait].amplitude;

const library: Record<ClipName, Clip["pose"]> = {
  // Seated at the counter, typing at the keyboard and glancing about.
  type: t => ({
    ...seated,
    spine: [.15, 0, 0],
    chest: [.06, .05 * wave(t), 0],
    head: [.3 + .04 * wave(t, 2, .1), .14 * wave(t, 1, .3), 0],
    handL: { at: [.088, .59 + .014 * Math.max(0, wave(t, 6)), .2], pole: [.85, -.3, -.5], wrist: [-.15, 0, 0] },
    handR: { at: [-.072, .59 + .014 * Math.max(0, wave(t, 6, .5)), .195], pole: [-.85, -.3, -.5], wrist: [-.15, 0, 0] },
  }),
  // Seated on the phone, writing with the free hand.
  phone: t => ({
    ...seated,
    spine: [.08, -.16 + .05 * wave(t), .02 * wave(t, 1, .25)],
    chest: [.05, -.06, 0],
    head: [.14 + .06 * wave(t, 2), -.08, .3],
    handR: atEar(-1),
    handL: {
      at: [.07 + .025 * wave(t, 3), .588, .19 + .015 * wave(t, 3, .25)],
      pole: [.8, -.4, -.4],
      wrist: [-.2, 0, 0],
    },
    props: { handset: handset(-1) },
  }),
  // Seated, reading a slip held in both hands.
  read: t => {
    const turnPage = window(t, .62, .68, .76, .84);
    return {
      ...seated,
      spine: [.12, 0, 0],
      chest: [.06, .04 * wave(t), 0],
      head: [.5 + .04 * wave(t, 1, .2), .08 * wave(t, 1, .4), 0],
      handL: { at: [.05, .665, .19], pole: [.9, -.5, -.3], wrist: [-.7, 0, -.35] },
      handR: { at: mix([-.05, .665, .19], [-.14, .64, .15], turnPage), pole: [-.9, -.5, -.3], wrist: [-.7, 0, .35] },
      props: { slip: { follows: "handL", offset: [-.045, .05, .025], rotation: [-.25, 0, 0] } },
    };
  },
  // Seated, chin on one hand, the other drumming the counter: bored, waiting.
  lean: t => ({
    ...seated,
    spine: [.26, .12, 0],
    chest: [.1, .06, 0],
    head: [.02 + .05 * wave(t, .5), .22 + .1 * wave(t), -.12],
    handR: { frame: "head", at: [-.012, .0, .118], pole: [-.15, -1, .15], wrist: [.4, 0, 0] },
    handL: { at: [.11, .585 + .01 * Math.max(0, wave(t, 8)), .2], pole: [.9, -.3, -.3] },
  }),
  // Slumped asleep over the counter, breathing slowly.
  asleep: t => ({
    ...seated,
    spine: [.62 + .02 * wave(t), 0, 0],
    chest: [.42 + .025 * wave(t), 0, 0],
    head: [.32, .5, .42],
    handL: { at: [.06, .575, .25], pole: [1, .1, 0], wrist: [0, 0, .4] },
    handR: { at: [-.13, .575, .21], pole: [-1, .1, 0], wrist: [0, 0, -.4] },
  }),
  // Standing still, hands clasped behind the back, weight shifting.
  idle: t => ({
    ...standing(wave(t) * .05),
    lift: [.012 * wave(t), -.006 - .004 * Math.abs(wave(t)), 0],
    pelvis: [0, .05 * wave(t, 1, .1), -.03 * wave(t)],
    spine: [-.02, 0, .025 * wave(t)],
    head: [-.04 + .03 * wave(t, 2), .3 * wave(t, .5, .1), 0],
    handL: { frame: "pelvis", at: [.035, .02, -.115], pole: [.9, .1, -.3], wrist: [0, 0, -.5] },
    handR: { frame: "pelvis", at: [-.03, .035, -.12], pole: [-.9, .1, -.3], wrist: [0, 0, .5] },
  }),
  // Standing on the phone, the free hand on the hip, pacing in place.
  call: t => ({
    ...standing(.05 * wave(t, .5)),
    lift: [.01 * wave(t, .5), -.005, 0],
    pelvis: [0, .1 * wave(t, .5), -.025 * wave(t, .5)],
    spine: [.05, .14 * wave(t, .5, .2), 0],
    head: [.1 + .05 * wave(t, 2), .12, .26],
    handR: atEar(-1),
    handL: { frame: "pelvis", at: [.155, .07, .02], pole: [1, -.1, -.6], wrist: [0, 0, .6] },
    props: { handset: handset(-1) },
  }),
  // The bid: one arm thrown high with a slip, bouncing on the toes, shouting.
  bid: t => {
    const bounce = Math.max(0, wave(t));
    return {
      footL: { at: [.08, .055 + .025 * bounce, .02], yaw: .14, pitch: -.25 * bounce },
      footR: { at: [-.08, .055 + .025 * bounce, -.02], yaw: -.14, pitch: -.25 * bounce },
      lift: [0, .022 * bounce - .004, .015],
      spine: [-.05, .12, .04],
      chest: [-.06, .04, -.06],
      head: [-.32 + .06 * wave(t, 2), .1, .06],
      handL: { frame: "chest", at: [.085, .36 + .05 * wave(t, 1, .1), .1], pole: [1, -.2, -.3], wrist: [.2, 0, 0] },
      handR: { frame: "chest", at: [-.06, .1, .2], pole: [-1, -.5, -.2], wrist: [-.6, 0, 0] },
      props: { slip: { follows: "handL", offset: [0, .055, .01] } },
    };
  },
  walk: t => {
    const { amplitude, stance } = gaits.walk;
    const swing = Math.cos(TAU * t);
    return {
      footL: stride(t, amplitude, stance, .06, 1),
      footR: stride((t + .5) % 1, amplitude, stance, .06, -1),
      lift: [.008 * wave(t), -.012 + .012 * Math.cos(2 * TAU * t), 0],
      pelvis: [0, .1 * swing, .03 * wave(t)],
      spine: [.06, -.16 * swing, 0],
      head: [.02, .06 * swing, 0],
      handL: { ...hanging(1, -.13 * swing), pole: [.25, 0, -1] },
      handR: { ...hanging(-1, .13 * swing), pole: [-.25, 0, -1] },
    };
  },
  // Hurrying with a slip, leaning into it.
  hurry: t => {
    const { amplitude, stance } = gaits.hurry;
    const swing = Math.cos(TAU * t);
    return {
      footL: stride(t, amplitude, stance, .11, 1),
      footR: stride((t + .5) % 1, amplitude, stance, .11, -1),
      lift: [0, -.03 + .025 * Math.abs(Math.cos(TAU * t)), 0],
      pelvis: [.05, .12 * swing, 0],
      spine: [.2, -.2 * swing, 0],
      head: [-.12, .05 * swing, 0],
      handL: { frame: "chest", at: [.13, -.1, .02 - .17 * swing], pole: [.4, -.2, -1], wrist: [-.4, 0, 0] },
      handR: { frame: "chest", at: [-.13, -.08, .04 + .17 * swing], pole: [-.4, -.2, -1], wrist: [-.4, 0, 0] },
      props: { slip: { follows: "handR", offset: [0, -.03, .045], rotation: [1.2, 0, 0] } },
    };
  },
  // Standing at the counter, leaning on both forearms, watching the screen.
  counter: t => ({
    footL: { at: [.08, .055, .04], yaw: .2 },
    footR: { at: [-.07, .055, -.08], yaw: -.1 },
    lift: [0, -.012, .02],
    spine: [.5, .04 * wave(t, .5), 0],
    chest: [.16, 0, 0],
    head: [-.12 + .05 * wave(t, 1, .3), .2 * wave(t, .5), 0],
    handL: { at: [.09, .57, .36], pole: [.6, -1, -.1], wrist: [0, 0, .3] },
    handR: { at: [-.07, .57, .37], pole: [-.6, -1, -.1], wrist: [0, 0, -.3] },
  }),
  // Talking with the hands, nodding.
  talk: t => ({
    ...standing(.04 * wave(t, .5)),
    lift: [.008 * wave(t, .5), -.006, 0],
    pelvis: [0, .08 * wave(t, .5), 0],
    spine: [.06, .12 * wave(t, 1, .1), 0],
    head: [.06 + .07 * wave(t, 3), .1 * wave(t), .05 * wave(t, 1, .3)],
    handL: {
      frame: "chest",
      at: [.13 + .04 * wave(t, 2), -.05 + .06 * Math.max(0, wave(t, 2)), .17],
      pole: [1, -.6, -.3],
      wrist: [-.5, 0, .3],
    },
    handR: {
      frame: "chest",
      at: [-.12 - .04 * wave(t, 2, .5), -.08 + .07 * Math.max(0, wave(t, 2, .5)), .16],
      pole: [-1, -.6, -.3],
      wrist: [-.5, 0, -.3],
    },
  }),
  // A paper plane: wind up, throw, follow through, settle.
  throw: t => {
    const wind = window(t, .05, .3, .34, .42), release = window(t, .34, .42, .55, .85);
    return {
      footL: { at: [.08, .055, .1], yaw: .1 },
      footR: { at: [-.08, .055, -.1], yaw: -.25 },
      lift: [0, -.01, .02 * release],
      pelvis: [0, -.3 * wind + .25 * release, 0],
      spine: [-.08 * wind + .18 * release, -.25 * wind + .25 * release, .05 * wind],
      head: [-.15 * wind - .05 * release, .25 * wind, 0],
      handR: {
        frame: "chest",
        at: mix(mix([-.15, -.18, .04], [-.2, .2, -.12], wind), [-.08, .05, .3], release),
        pole: [-1, -.4, -.4],
        wrist: [-.8 * wind, 0, 0],
      },
      handL: { frame: "chest", at: mix([.15, -.18, .04], [.18, .05, .22], wind), pole: [1, -.4, -.4] },
      props: t < .4 ? { plane: { follows: "handR", offset: [0, -.02, .03], rotation: [-.3, 0, 0] } } : {},
    };
  },
  // Elated: a fist pumped twice, bouncing.
  cheer: t => {
    const pump = Math.max(0, wave(t, 2));
    return {
      ...standing(),
      lift: [0, .02 * pump - .004, 0],
      spine: [-.08, .08, 0],
      chest: [-.06, 0, 0],
      head: [-.25, .05, 0],
      handR: { frame: "chest", at: [-.1, .2 + .14 * pump, .06], pole: [-1, -.1, -.2], wrist: [0, 0, 0] },
      handL: { frame: "chest", at: [.16, -.06 + .04 * pump, .1], pole: [1, -.4, -.3] },
    };
  },
  // Deflated: head down, shoulders dropped, arms hanging.
  slump: t => ({
    ...standing(.02 * wave(t, .5)),
    lift: [0, -.018, 0],
    pelvis: [0, .03 * wave(t, .5), 0],
    spine: [.22, 0, .02 * wave(t, .5)],
    chest: [.16, 0, 0],
    head: [.62 + .04 * wave(t), .08 * wave(t, .5), 0],
    handL: { frame: "chest", at: [.12, -.26, .09], pole: [.3, 0, -1] },
    handR: { frame: "chest", at: [-.12, -.26, .09], pole: [-.3, 0, -1] },
  }),
  // At the board: reaching up to pin a card, a stack of cards in the other hand.
  pin: t => {
    const reach = window(t, .1, .3, .55, .75), press = window(t, .3, .36, .4, .46);
    return {
      ...standing(),
      lift: [0, .012 * reach, .01],
      spine: [-.06 * reach, -.06, 0],
      head: [-.4 * reach + .05, -.1, 0],
      handR: {
        frame: "chest",
        at: mix([-.08, -.02, .18], [-.04, .36, .3 + .02 * press], reach),
        pole: [-1, -.3, -.2],
        wrist: [-.4, 0, 0],
      },
      handL: { frame: "chest", at: [.08, -.05, .17], pole: [1, -.6, -.2], wrist: [-.6, 0, -.4] },
      props: { slip: { follows: "handL", offset: [-.035, .04, .02], rotation: [-.3, 0, 0] } },
    };
  },
  // The Floor's voice rings the bell: a firm pull on the handle, twice.
  ring: t => {
    const pull = Math.max(0, wave(t, 2));
    return {
      ...standing(),
      lift: [0, -.01 * pull, .01],
      spine: [.05 + .06 * pull, -.08, 0],
      head: [-.2, -.05, 0],
      handR: { frame: "chest", at: [-.09, .26 - .14 * pull, .27], pole: [-1, -.6, -.3], wrist: [-.3, 0, 0] },
      handL: hanging(1),
    };
  },
  // Standing with a coffee, sipping now and then.
  coffee: t => {
    const sip = window(t, .25, .35, .45, .55);
    return {
      ...standing(.04 * wave(t, .5)),
      lift: [.008 * wave(t, .5), -.006, 0],
      pelvis: [0, .06 * wave(t, .5), 0],
      spine: [.01, .05 * wave(t, .5), 0],
      head: [.05 - .25 * sip, .25 * wave(t, .5, .1) * (1 - sip), 0],
      handL: {
        frame: "chest",
        at: mix([.09, -.06, .14], [.035, .19, .12], sip),
        pole: [1, -.5, -.4],
        wrist: [-.5 + .4 * sip, 0, -.3],
      },
      handR: { frame: "pelvis", at: [-.155, .06, .03], pole: [-1, -.1, -.6], wrist: [0, 0, -.6] },
      props: { cup: { follows: "handL", offset: [-.025, .03, .03] } },
    };
  },
};

export const clips: ReadonlyArray<Clip> = clipNames.map(name => ({
  name,
  seconds: name === "walk" ? gaits.walk.seconds : name === "hurry" ? gaits.hurry.seconds : {
    type: 3,
    phone: 4,
    read: 5,
    lean: 6,
    asleep: 5,
    idle: 6,
    call: 4,
    bid: 1.4,
    counter: 5,
    talk: 3,
    throw: 3,
    cheer: 2,
    slump: 6,
    pin: 4,
    ring: 2,
    coffee: 6,
  }[name],
  pose: library[name],
}));

// Frames per clip loop. The shader blends neighbouring frames.
export const framesPerClip = 32;
// Two RGBA texels per bone per frame: its rotation, then its position and
// scale. Rows run clip by clip, frame by frame.
export const bakeMotion = () => {
  const width = boneNames.length * 2, height = clips.length * framesPerClip;
  const data = new Float32Array(width * height * 4);
  clips.forEach((clip, clipNumber) => {
    for (let step = 0; step < framesPerClip; step++) {
      const solved = solvePose(clip.pose(step / framesPerClip));
      const row = (clipNumber * framesPerClip + step) * width * 4;
      boneNames.forEach((_name, index) => {
        const rotation = solved.rotation[index] ?? new THREE.Quaternion();
        const position = solved.position[index] ?? new THREE.Vector3();
        data.set([rotation.x, rotation.y, rotation.z, rotation.w], row + index * 8);
        data.set([position.x, position.y, position.z, solved.scale[index] ?? 1], row + index * 8 + 4);
      });
    }
  });
  return { data, width, height };
};
