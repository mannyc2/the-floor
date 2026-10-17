import type { ClipName } from "../../src/map/_lib/assets/clips";
import { postLayout, seating, traderReach } from "../../src/map/_lib/live-layout";
import type { Poser, Side, V3 } from "./ik";

// How each clip is made: a motion-capture loop from the Universal Animation
// Library, played `repeats` times over the clip, then shaped into the floor's
// work by `work`. `phase` runs 0..1 over the clip; periodic touches use whole
// cycles per clip so the loop never jumps.
export interface Recipe {
  readonly source: string;
  readonly repeats: number;
  // Seated clips sit the hips on the stool.
  readonly seated?: boolean;
  readonly work?: (pose: Poser, phase: number) => void;
}

const TAU = Math.PI * 2;
const wave = (t: number, cycles: number, offset = 0) => Math.sin((t * cycles + offset) * TAU);
const smooth = (edge0: number, edge1: number, x: number) => {
  const k = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return k * k * (3 - 2 * k);
};
// Up over [a, b], held, and down over [c, d].
const window = (t: number, a: number, b: number, c: number, d: number) => smooth(a, b, t) * (1 - smooth(c, d, t));
const sign = (side: Side) => side === "l" ? 1 : -1;
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mix = (a: V3, b: V3, k: number): V3 => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const triple = (v: { readonly x: number; readonly y: number; readonly z: number }): V3 => [v.x, v.y, v.z];

// Where the counter is from a trader's root: seated hips sit `seated` behind
// its edge, and a trader working it on foot stands `standing` back.
// Traders stand on the post's plinth, so in their frame the worktop is lower
// by its height; a resting hand's wrist sits a hand's half-thickness above.
const worktop = postLayout.worktop - postLayout.plinthHeight + .016;
const seatedEdge = seating.counterEdge;
const standingEdge = traderReach.standing;
// Pitching about the figure's left (+X) axis tips it forward.
const pitch: V3 = [1, 0, 0];
// Bends the spine forward (positive) or back, spread over its three joints.
const lean = (pose: Poser, angle: number) => {
  pose.bend("spine_01", pitch, angle * .45);
  pose.bend("spine_02", pitch, angle * .3);
  pose.bend("spine_03", pitch, angle * .25);
};
const elbowOut = (side: Side): V3 => [sign(side) * .8, -1, -.5];
// A seated trader's thighs slope down from the stool under the worktop,
// knees a little apart, feet hanging just below the foot ring.
const seated = (pose: Poser) => {
  for (const side of ["l", "r"] as const) {
    pose.plant(side, [sign(side) * .075, seating.footRing - .065, .14], [sign(side) * .1, 0, 1]);
  }
};

// Hands on the keyboard, fingers tapping out of step.
const typing = (pose: Poser, phase: number) => {
  seated(pose);
  lean(pose, .2);
  for (const side of ["l", "r"] as const) {
    const s = sign(side);
    const tap = .007 * Math.max(0, wave(phase, 17 + s * 2, s * .3)) + .004 * Math.max(0, wave(phase, 29, s * .7));
    pose.reach(side, [s * .075, worktop + .055 + tap, seatedEdge + .08], elbowOut(side));
    pose.orientHand(side, [0, -.12, 1], [0, -1, .1]);
  }
  pose.bend("Head", pitch, .12);
};
// A handset at the ear on `side`, the head leaning into it.
const onPhone = (pose: Poser, side: Side) => {
  const s = sign(side);
  const head = triple(pose.at("Head"));
  pose.reach(side, add(head, [s * .072, -.035, .03]), [s, -.5, .25]);
  pose.orientHand(side, [-s * .2, 1, .15], [-s, 0, 0]);
  pose.grip(side, .55);
  pose.bend("Head", [0, 0, 1], -s * .12);
  pose.place("handset", { follows: `hand_${side}`, offset: [s * -.018, .07, .01] });
};
const handOnDesk = (pose: Poser, side: Side, edge: number) => {
  const s = sign(side);
  pose.reach(side, [s * .11, worktop + .06, edge + .06], elbowOut(side));
  pose.orientHand(side, [-s * .3, -.1, 1], [0, -1, 0]);
};

const sitting = { source: "Sitting_Idle_Loop", repeats: 3, seated: true } as const;
export const recipes: Record<ClipName, Recipe> = {
  type: { ...sitting, work: typing },
  phone: {
    source: "Sitting_Talking_Loop",
    repeats: 2,
    seated: true,
    work: pose => {
      seated(pose);
      lean(pose, .1);
      onPhone(pose, "r");
      handOnDesk(pose, "l", seatedEdge);
    },
  },
  read: {
    ...sitting,
    work: (pose, phase) => {
      seated(pose);
      lean(pose, .16);
      for (const side of ["l", "r"] as const) {
        const s = sign(side);
        pose.reach(side, [s * .055, worktop + .07 + .006 * wave(phase, 3), seatedEdge + .05], elbowOut(side));
        pose.orientHand(side, [-s * .6, .5, .6], [-s, 0, 0]);
        pose.grip(side, .35);
      }
      pose.bend("Head", pitch, .32 + .03 * wave(phase, 2, .25));
      pose.place("slip", { follows: "hand_l", offset: [-.035, .05, .02], rotation: [0, 0, -.2] });
    },
  },
  lean: {
    ...sitting,
    work: (pose, phase) => {
      seated(pose);
      lean(pose, .42);
      const head = triple(pose.at("Head"));
      for (const side of ["l", "r"] as const) {
        const s = sign(side);
        pose.reach(side, add(head, [s * .035, -.09, .07]), [s * .2, -1, .4]);
        pose.orientHand(side, [-s * .2, 1, .1], [-s * .3, 0, 1]);
      }
      pose.bend("Head", pitch, .1 + .04 * wave(phase, 1));
    },
  },
  asleep: {
    ...sitting,
    work: (pose, phase) => {
      seated(pose);
      lean(pose, .75 + .02 * wave(phase, 1));
      for (const side of ["l", "r"] as const) {
        const s = sign(side);
        pose.reach(side, [-s * .03, worktop + .08, seatedEdge + .12], [s, .25, -.35]);
        pose.orientHand(side, [-s, 0, .2], [0, -1, 0]);
      }
      pose.bend("neck_01", pitch, .25);
      pose.bend("Head", pitch, .35);
    },
  },
  slump: {
    ...sitting,
    work: (pose, phase) => {
      seated(pose);
      lean(pose, -.18);
      pose.bend("Head", pitch, .28 + .03 * wave(phase, 1));
    },
  },
  idle: { source: "Idle_Loop", repeats: 2 },
  call: { source: "Idle_Talking_Loop", repeats: 2, work: pose => onPhone(pose, "r") },
  bid: {
    source: "Idle_Talking_Loop",
    repeats: 1,
    work: (pose, phase) => {
      const shoulder = triple(pose.at("upperarm_r"));
      const pump = .035 * wave(phase, 3);
      pose.reach("r", add(shoulder, [-.03, .27 + pump, .07]), [-1, -.2, -.3]);
      pose.orientHand("r", [0, 1, .2], [0, 0, 1]);
      pose.grip("r", .4);
      pose.place("slip", { follows: "hand_r", offset: [.01, .07, .015], rotation: [.2, 0, 0] });
    },
  },
  walk: { source: "Walk_Loop", repeats: 1 },
  hurry: { source: "Jog_Fwd_Loop", repeats: 1 },
  counter: {
    source: "Idle_Loop",
    repeats: 2,
    work: (pose, phase) => {
      lean(pose, .5);
      handOnDesk(pose, "l", standingEdge);
      const s = -1;
      const write = .012 * wave(phase, 9);
      pose.reach("r", [s * .04 + write, worktop + .012, standingEdge + .08], elbowOut("r"));
      pose.orientHand("r", [.3, -.4, 1], [0, -1, 0]);
      pose.grip("r", .5);
      pose.bend("Head", pitch, .3);
    },
  },
  talk: { source: "Idle_Talking_Loop", repeats: 1 },
  throw: {
    source: "Idle_Talking_Loop",
    repeats: 1,
    work: (pose, phase) => {
      const shoulder = triple(pose.at("upperarm_r"));
      const cocked = add(shoulder, [-.02, .08, -.1]);
      const released = add(shoulder, [.04, .02, .27]);
      const hand = mix(cocked, released, smooth(.34, .44, phase));
      const weight = 1 - smooth(.55, .8, phase);
      pose.reach("r", hand, [-1, -.4, -.2], weight);
      pose.orientHand("r", [0, .5, 1], [0, -1, 0], weight);
      pose.bend("spine_02", [0, 1, 0], weight * (.25 - .5 * smooth(.32, .45, phase)));
      if (phase < .42) pose.place("plane", { follows: "hand_r", offset: [.0, .06, .03], rotation: [-1.2, 0, 0] });
    },
  },
  cheer: {
    source: "Idle_Loop",
    repeats: 1,
    work: (pose, phase) => {
      for (const side of ["l", "r"] as const) {
        const s = sign(side);
        const shoulder = triple(pose.at(`upperarm_${side}`));
        pose.reach(side, add(shoulder, [s * .07, .25 + .03 * wave(phase, 2, s * .25), .04]), [s, -.2, -.3]);
        pose.orientHand(side, [s * .2, 1, 0], [0, 0, 1]);
        pose.grip(side, .7);
      }
      pose.bend("Head", pitch, -.15);
    },
  },
  pin: { source: "Interact", repeats: 2 },
  ring: {
    source: "Idle_Loop",
    repeats: 1,
    work: (pose, phase) => {
      const pull = .05 * (wave(phase, 2) * .5 + .5);
      pose.reach("r", [-.05, 1.04 - pull, .14], [-1, -.3, -.2]);
      pose.orientHand("r", [0, 1, .1], [1, 0, 0]);
      pose.grip("r", .8);
      pose.bend("Head", pitch, -.25);
    },
  },
  coffee: {
    source: "Idle_Loop",
    repeats: 2,
    work: (pose, phase) => {
      const head = triple(pose.at("Head"));
      const held: V3 = [.07, .62, .1];
      const sip = window(phase, .52, .6, .7, .8);
      pose.reach("l", mix(held, add(head, [.015, -.075, .085]), sip), [1, -.6, -.2]);
      pose.orientHand("l", [-.3, .4, .8], [-1, 0, 0]);
      pose.grip("l", .45);
      pose.bend("Head", pitch, -.12 * sip);
      pose.place("cup", { follows: "hand_l", offset: [-.025, .035, .02] });
    },
  },
};
