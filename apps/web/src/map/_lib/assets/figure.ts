import { characterMaterials, type PaletteName } from "@floor/atlas/materials";
import * as THREE from "three";
import type { Point } from "./geometry";

// The picked Roomy figure. The workbench's approved proportion frames build it
// at `approvedFigureDetail` and must reproduce byte for byte, so the default
// tessellation, part order and every coordinate here are fixed.
export type FigurePose = "standing" | "phone" | "reading" | "raised" | "walking" | "throwing" | "seated" | "asleep";
export type Part = { readonly geometry: THREE.BufferGeometry; readonly slot: PaletteName };
interface FigureShape {
  readonly headRatio: number;
  readonly shoulderRatio: number;
  readonly worktopRatio: number;
}
// Segment counts, and whether the hairline lapels are drawn. The live floor
// draws a thousand figures about eighty pixels tall, where the approved
// tessellation costs fourteen thousand vertices each and the lapels only
// scribble; it keeps the same rig, proportions and poses.
export interface FigureDetail {
  readonly limb: readonly [caps: number, radial: number];
  readonly oval: readonly [width: number, height: number];
  readonly head: readonly [width: number, height: number];
  readonly cap: readonly [width: number, height: number];
  readonly torso: number;
  readonly lapels: boolean;
}
export const approvedFigureDetail: FigureDetail = {
  limb: [4, 10],
  oval: [16, 10],
  head: [20, 14],
  cap: [20, 10],
  torso: 20,
  lapels: true,
};
export const liveFigureDetail: FigureDetail = {
  limb: [1, 5],
  oval: [5, 4],
  head: [8, 5],
  cap: [8, 2],
  torso: 7,
  lapels: false,
};

export const part = (geometry: THREE.BufferGeometry, slot: PaletteName): Part => ({ geometry, slot });
export const partBox = (w: number, h: number, d: number, x: number, y: number, z: number, slot: PaletteName) =>
  part(new THREE.BoxGeometry(w, h, d).translate(x, y, z), slot);
export const oval = (
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  slot: PaletteName,
  segments: FigureDetail["oval"] = approvedFigureDetail.oval,
) => part(new THREE.SphereGeometry(1, segments[0], segments[1]).scale(w / 2, h / 2, d / 2).translate(x, y, z), slot);
export const limb = (
  a: Point,
  b: Point,
  radius: number,
  slot: PaletteName,
  segments: FigureDetail["limb"] = approvedFigureDetail.limb,
) => {
  const from = new THREE.Vector3(...a), to = new THREE.Vector3(...b);
  const distance = from.distanceTo(to);
  const rotation = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    to.clone().sub(from).normalize(),
  );
  const centre = from.add(to).multiplyScalar(.5);
  return part(
    new THREE.CapsuleGeometry(radius, Math.max(.001, distance), segments[0], segments[1])
      .applyQuaternion(rotation).translate(centre.x, centre.y, centre.z),
    slot,
  );
};

// The seated and asleep poses' chair, at H=1 with its seat below the worktop.
export const chairParts = (top: number, segments = 32): ReadonlyArray<Part> => {
  const seat = top - .215;
  return [
    partBox(.28, .035, .27, 0, seat, 0, "steel-0"),
    part(new THREE.CylinderGeometry(.027, .027, seat - .035, segments).translate(0, (seat - .035) / 2, 0), "steel-0"),
    partBox(.025, .30, .025, -.11, seat + .10, -.115, "steel-0"),
    partBox(.025, .30, .025, .11, seat + .10, -.115, "steel-0"),
    partBox(.27, .16, .035, 0, seat + .23, -.115, "steel-0"),
    partBox(.34, .025, .045, 0, .025, 0, "steel-0"),
    partBox(.045, .025, .34, 0, .025, 0, "steel-0"),
  ];
};

// Coordinates describe the nominal standing figure, H=1. Posing changes the
// silhouette, never its source scale; H becomes eight kit units at placement.
const makeRig = (shape: FigureShape, pose: FigurePose, jacket: PaletteName, build: number, detail: FigureDetail) => {
  const head = shape.headRatio;
  const width = shape.shoulderRatio * build;
  const sitting = pose === "seated" || pose === "asleep";
  const reading = pose === "reading" || sitting;
  const lean = pose === "asleep" ? .25 : reading ? .13 : pose === "phone" ? .055 : pose === "throwing" ? -.035 : 0;
  const drop = sitting ? .15 - (shape.worktopRatio - .5) : pose === "reading" ? .035 : 0;
  const hip = sitting ? .33 + shape.worktopRatio - .5 : .48;
  const shoulder = 1 - head - .045 - drop - (pose === "asleep" ? .10 : 0);
  return { shape, pose, jacket, build, detail, head, width, sitting, reading, lean, drop, hip, shoulder };
};
type Rig = ReturnType<typeof makeRig>;
const legParts = ({ sitting, pose, hip, build, width, detail }: Rig): Array<Part> => {
  const parts: Array<Part> = [];
  const add = (value: Part) => {
    parts.push(value);
  };
  const leftFoot: Point = [-.072, .035, sitting ? .13 : pose === "walking" ? .16 : .005];
  const rightFoot: Point = [.075, .035, sitting ? .18 : pose === "walking" ? -.14 : -.035];
  const leftKnee: Point = [-.065, sitting ? hip - .025 : .265, sitting ? .18 : pose === "walking" ? .05 : .025];
  const rightKnee: Point = [.063, sitting ? hip - .02 : .27, sitting ? .185 : pose === "throwing" ? -.11 : -.025];
  const leg = (x: number, knee: Point, foot: Point) => {
    add(limb([x, hip, 0], knee, .047 * build, characterMaterials.trousers, detail.limb));
    add(limb(knee, [foot[0], .065, foot[2]], .04 * build, characterMaterials.trousers, detail.limb));
    add(oval(.102 * build, .07, .185, foot[0], foot[1], foot[2] + .035, characterMaterials.trousers, detail.oval));
  };
  leg(-.055, leftKnee, leftFoot);
  leg(.055, rightKnee, rightFoot);
  add(oval(width * .76, .14, .14 * build, 0, hip, 0, characterMaterials.trousers, detail.oval));

  return parts;
};
const jacketParts = ({ hip, width, shoulder, lean, jacket, detail }: Rig): Array<Part> => {
  const parts: Array<Part> = [];
  const add = (value: Part) => {
    parts.push(value);
  };
  const jacketProfile = [
    new THREE.Vector2(0, hip - .04),
    new THREE.Vector2(width * .46, hip - .04),
    new THREE.Vector2(width * .42, hip + .09),
    new THREE.Vector2(width * .48, shoulder - .06),
    new THREE.Vector2(width * .42, shoulder),
    new THREE.Vector2(width * .24, shoulder + .035),
    new THREE.Vector2(0, shoulder + .04),
  ];
  const torso = new THREE.LatheGeometry(jacketProfile, detail.torso).scale(1, 1, .6);
  const positions = torso.getAttribute("position");
  for (let index = 0; index < positions.count; index++) {
    positions.setZ(index, positions.getZ(index) + lean * (positions.getY(index) - hip) / (shoulder - hip));
  }
  torso.computeVertexNormals();
  add(part(torso, jacket));
  // A narrow jacket opening and folded lapels read as clothing without using
  // the paper material for a shirt or adding an unapproved shirt colour.
  const opening = new THREE.BufferGeometry();
  opening.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([
      -width * .19,
      shoulder + .01,
      lean + width * .26,
      0,
      hip + .09,
      lean * .2 + width * .285,
      width * .19,
      shoulder + .01,
      lean + width * .26,
    ], 3),
  );
  opening.computeVertexNormals();
  add(part(opening, characterMaterials.shirt));
  if (detail.lapels) {
    for (const side of [-1, 1]) {
      add(limb(
        [side * width * .17, shoulder + .015, lean + width * .15],
        [side * width * .055, shoulder - .15, lean * .6 + width * .29],
        .019,
        jacket,
        detail.limb,
      ));
    }
  }
  add(oval(.074, .11, .075, 0, shoulder + .055, lean, characterMaterials.skin, detail.oval));
  return parts;
};
const headParts = ({ pose, shape, head, drop, lean, reading, detail }: Rig): Array<Part> => {
  const parts: Array<Part> = [];
  const add = (value: Part) => {
    parts.push(value);
  };
  const headCentre: Point = [
    pose === "phone" ? -.02 : pose === "raised" ? .015 : 0,
    pose === "asleep" ? shape.worktopRatio + head * .48 : 1 - head / 2 - drop,
    lean + .006,
  ];
  const tilt = pose === "phone" ? .13 : pose === "raised" ? -.12 : .04;
  const nod = pose === "asleep" ? .8 : reading ? .28 : 0;
  const headGeometry = new THREE.SphereGeometry(1, detail.head[0], detail.head[1]).scale(
    head * .36,
    head / 2,
    head * .39,
  );
  headGeometry.rotateZ(tilt).rotateX(nod).translate(...headCentre);
  add(part(headGeometry, characterMaterials.skin));
  // A shallow cap keeps the face blank and leaves the head's larger silhouette
  // intact. Its neutral hair proxy is shared by every proportion candidate.
  add(part(
    new THREE.SphereGeometry(1, detail.cap[0], detail.cap[1], 0, Math.PI * 2, 0, Math.PI * .37)
      .scale(head * .375, head * .52, head * .406).rotateZ(tilt).rotateX(nod).translate(...headCentre),
    characterMaterials.hair,
  ));
  return parts;
};
const leftArm = ({ pose, width, shoulder, lean, reading, shape }: Rig) => {
  const leftShoulder: Point = [-width * .46, shoulder - .035, lean];
  const leftElbow: Point = pose === "asleep"
    ? [-width * .58, shape.worktopRatio + .025, lean + .015]
    : pose === "raised" || pose === "throwing"
    ? [-width * .68, shoulder + .11, lean + .02]
    : [-width * .66, shoulder - .19, lean + (reading ? .16 : .03)];
  const leftHand: Point = pose === "asleep" ? [-.035, shape.worktopRatio + .04, lean + .14] : pose === "raised"
    ? [-width * .56, 1.14, lean + .02]
    : pose === "throwing"
    ? [-width * .57, 1.04, lean + .15]
    : reading
    ? [-.055, shoulder - .13, lean + .27]
    : [-width * .55, shoulder - .32, lean + .07];
  return { start: leftShoulder, elbow: leftElbow, hand: leftHand };
};
const rightArm = ({ pose, width, shoulder, lean, reading, shape, head, drop }: Rig) => {
  const rightShoulder: Point = [width * .46, shoulder - .035, lean];
  const rightElbow: Point = pose === "asleep" ? [width * .58, shape.worktopRatio + .025, lean + .015] : pose === "phone"
    ? [width * .72, shoulder - .16, lean + .045]
    : pose === "throwing"
    ? [width * .89, shoulder - .04, lean + .12]
    : [width * .65, shoulder - .19, lean + .10];
  const rightHand: Point = pose === "asleep" ? [.055, shape.worktopRatio + .05, lean + .14] : pose === "phone"
    ? [head * .38, 1 - head * .63 - drop, lean + .035]
    : pose === "throwing"
    ? [width * 1.15, shoulder + .02, lean + .24]
    : reading
    ? [.07, shoulder - .12, lean + .27]
    : [.035, shoulder - .24, lean + .18];
  return { start: rightShoulder, elbow: rightElbow, hand: rightHand };
};
const propParts = ({ pose, detail }: Rig, leftHand: Point, rightHand: Point): Array<Part> => {
  const parts: Array<Part> = [];
  const add = (value: Part) => {
    parts.push(value);
  };
  if (pose === "phone") {
    add(
      limb(
        [rightHand[0], rightHand[1] - .055, rightHand[2] + .025],
        [rightHand[0], rightHand[1] + .085, rightHand[2] + .025],
        .018,
        "steel-0",
        detail.limb,
      ),
    );
    add(oval(.055, .05, .055, rightHand[0], rightHand[1] + .085, rightHand[2] + .035, "steel-0", detail.oval));
    add(oval(.055, .05, .055, rightHand[0], rightHand[1] - .055, rightHand[2] + .035, "steel-0", detail.oval));
  }
  if (pose === "raised") add(partBox(.12, .16, .009, leftHand[0], leftHand[1] + .08, leftHand[2], "paper-0"));
  if (pose === "reading" || pose === "seated") {
    add(
      part(
        new THREE.BoxGeometry(.20, .006, .16).rotateX(-.35).translate(0, rightHand[1] + .015, rightHand[2] + .05),
        "paper-0",
      ),
    );
  }
  if (pose === "throwing") {
    // The wrist folds back to a held paper plane; no straight open-palmed arm.
    const plane = new THREE.BufferGeometry();
    plane.setAttribute(
      "position",
      new THREE.Float32BufferAttribute([
        -.15,
        0,
        -.10,
        0,
        0,
        .16,
        0,
        .035,
        -.10,
        0,
        .035,
        -.10,
        0,
        0,
        .16,
        .15,
        0,
        -.10,
        0,
        .035,
        -.10,
        0,
        0,
        .16,
        -.15,
        0,
        -.10,
        .15,
        0,
        -.10,
        0,
        0,
        .16,
        0,
        .035,
        -.10,
      ], 3),
    );
    plane.computeVertexNormals();
    add(part(plane.translate(leftHand[0], leftHand[1] + .015, leftHand[2] + .06), "paper-0"));
  }
  return parts;
};
export const figureParts = (
  shape: FigureShape,
  pose: FigurePose,
  jacket: PaletteName,
  build = 1,
  detail: FigureDetail = approvedFigureDetail,
): Array<Part> => {
  const rig = makeRig(shape, pose, jacket, build, detail);
  const left = leftArm(rig), right = rightArm(rig);
  const arms = [left, right].flatMap(({ start, elbow, hand }, index) => {
    const cuff = new THREE.Vector3(...hand).addScaledVector(
      new THREE.Vector3(...elbow).sub(new THREE.Vector3(...hand)).normalize(),
      .034,
    );
    return [
      limb(start, elbow, .042 * build, jacket, detail.limb),
      limb(elbow, [cuff.x, cuff.y, cuff.z], .034 * build, jacket, detail.limb),
      pose === "throwing" && index === 0
        ? limb(hand, [hand[0], hand[1] - .035, hand[2] + .04], .025, characterMaterials.skin, detail.limb)
        : oval(.055, .073, .053, ...hand, characterMaterials.skin, detail.oval),
    ];
  });
  return [...legParts(rig), ...jacketParts(rig), ...headParts(rig), ...arms, ...propParts(rig, left.hand, right.hand)];
};
