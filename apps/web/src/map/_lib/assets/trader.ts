import { PaletteName } from "@floor/atlas/materials";
import { Record, Schema } from "effect";
import * as THREE from "three";
import { type Bone, bone, restJoints } from "./rig";

// The live floor's trader, after the picked cast, moods and moments sheets: a
// smooth faceless head a little large for the body, hair as a simple shape, a
// jacket open on a shirt and tie (or shirtsleeves and braces), trousers and
// shoes. Every part is bound to one bone of the rig. Builds, hair styles,
// outfits and colours vary per instance, so one mesh draws the whole crowd.

// Negative materials resolve per instance in the trader shader.
const traderMaterials = {
  jacket: -2,
  trousers: -5,
  skin: -6,
  hair: -7,
  shirt: -8,
  tie: -9,
  // The torso and sleeves: the jacket, or the shirt in shirtsleeves.
  coat: -10,
} as const;
type TraderPaint = keyof typeof traderMaterials;
type Paint = TraderPaint | PaletteName;
const isTraderPaint = Schema.is(Schema.Literals(Record.keys(traderMaterials)));

// Visibility groups, matched against an instance's hair style and outfit.
export const hairStyles = ["short", "parted", "curly", "bun", "long"] as const;
export const outfits = ["jacket", "shirtsleeves"] as const;
const group = {
  always: 0,
  hair: (style: (typeof hairStyles)[number]) => 1 + hairStyles.indexOf(style),
  jacket: 8,
  shirtsleeves: 9,
} as const;
// A vertex's bone index and visibility group share one attribute.
export const boneStride = 32;

type V3 = readonly [number, number, number];
interface Part {
  readonly geometry: THREE.BufferGeometry;
  readonly bone: Bone;
  readonly paint: Paint;
  readonly surface: number;
  readonly visibility: number;
}

const ellipsoid = (size: V3, centre: V3, segments: readonly [number, number] = [9, 6]) =>
  new THREE.SphereGeometry(1, segments[0], segments[1]).scale(...size).translate(...centre);
const capsule = (from: V3, to: V3, radius: number, radial = 6) => {
  const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to);
  const rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  const centre = a.clone().add(b).multiplyScalar(.5);
  return new THREE.CapsuleGeometry(radius, Math.max(.001, a.distanceTo(b)), 2, radial)
    .applyQuaternion(rotation).translate(centre.x, centre.y, centre.z);
};
const lathe = (
  profile: ReadonlyArray<readonly [number, number]>,
  depth: number,
  segments = 10,
  phiStart = 0,
  phiLength = Math.PI * 2,
) =>
  new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), segments, phiStart, phiLength)
    .scale(1, 1, depth);
const panel = (points: ReadonlyArray<V3>) => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(points.flat(), 3));
  geometry.computeVertexNormals();
  return geometry;
};
const head = { size: [.064, .084, .072], centre: [0, .905, .008] } satisfies { readonly size: V3; readonly centre: V3 };
// A hair cap: the top of a sphere slightly larger than the head, tilted so
// the hairline sits higher at the front than at the back.
const cap = (reach: number, tilt: number, scale: V3 = [1.07, 1.06, 1.07]) =>
  new THREE.SphereGeometry(1, 9, 4, 0, Math.PI * 2, 0, Math.PI * reach)
    .rotateX(tilt).scale(head.size[0] * scale[0], head.size[1] * scale[1], head.size[2] * scale[2])
    .translate(...head.centre);

const parts = (): Array<Part> => {
  const list: Array<Part> = [];
  const add = (
    geometry: THREE.BufferGeometry,
    at: Bone,
    paint: Paint,
    surface: number,
    visibility: number = group.always,
  ) => list.push({ geometry, bone: at, paint, surface, visibility });
  // Legs and shoes.
  for (
    const [side, thigh, shin, foot, surface] of [
      [1, "thighL", "shinL", "footL", 20],
      [-1, "thighR", "shinR", "footR", 24],
    ] as const
  ) {
    add(capsule(restJoints[thigh], restJoints[shin], .05), thigh, "trousers", surface);
    add(capsule(restJoints[shin], [restJoints[foot][0], .07, restJoints[foot][2]], .041), shin, "trousers", surface);
    add(ellipsoid([.038, .028, .072], [side * .061, .033, .032], [8, 4]), foot, "shoe-0", surface + 1);
  }
  add(ellipsoid([.106, .068, .074], [0, .497, 0]), "pelvis", "trousers", 1);
  // The jacket's skirt: the back hangs from the hips and each front flap
  // rides its thigh, so a seated trader's jacket lies over the lap. Tubes
  // are open where another part covers the end, so no cap shows as a band.
  const skirt: ReadonlyArray<readonly [number, number]> = [[.121, .465], [.109, .536]];
  add(lathe(skirt, .72, 6, Math.PI / 2, Math.PI), "pelvis", "jacket", 2, group.jacket);
  add(lathe(skirt, .72, 3, 0, Math.PI / 2), "thighL", "jacket", 2, group.jacket);
  add(lathe(skirt, .72, 3, -Math.PI / 2, Math.PI / 2), "thighR", "jacket", 2, group.jacket);
  add(lathe([[.116, .528], [.116, .548]], .66), "pelvis", "shoe-0", 3, group.shirtsleeves);
  // Torso: waist and chest share one surface so bending draws no seam.
  add(lathe([[.111, .52], [.108, .58], [.111, .64]], .64), "spine", "coat", 2);
  add(lathe([[.114, .612], [.121, .68], [.134, .742], [.124, .783], [.072, .801], [0, .806]], .62), "chest", "coat", 2);
  // The open front: a shirt V and the tie down it.
  add(panel([[-.046, .79, .072], [0, .652, .084], [.046, .79, .072]]), "chest", "shirt", 4);
  add(panel([[-.009, .776, .082], [0, .646, .09], [.009, .776, .082]]), "chest", "tie", 5);
  add(panel([[-.012, .79, .077], [.012, .79, .077], [0, .772, .083]]), "chest", "tie", 5);
  // Braces over the shirt.
  for (const side of [-1, 1]) {
    add(capsule([side * .06, .788, .062], [side * .052, .55, .074], .008, 4), "chest", "tie", 6, group.shirtsleeves);
    add(capsule([side * .06, .788, -.062], [side * .045, .55, -.07], .008, 4), "chest", "tie", 6, group.shirtsleeves);
  }
  // Neck and head share a surface; the face stays blank.
  add(new THREE.CylinderGeometry(.03, .033, .07, 7).translate(0, .812, .004), "head", "skin", 7);
  add(ellipsoid(head.size, head.centre, [10, 7]), "head", "skin", 7);
  // Hair: one cap for everyone, and each style's extra shape on it.
  add(cap(.44, -.38), "head", "hair", 8);
  add(ellipsoid([.052, .024, .05], [.014, .985, .018], [7, 4]), "head", "hair", 8, group.hair("parted"));
  for (let curl = 0; curl < 4; curl++) {
    const angle = curl * Math.PI / 2 + .4;
    add(
      ellipsoid([.03, .026, .03], [Math.sin(angle) * .04, head.centre[1] + .058, Math.cos(angle) * .042 - .006], [
        5,
        3,
      ]),
      "head",
      "hair",
      8,
      group.hair("curly"),
    );
  }
  add(ellipsoid([.032, .03, .03], [0, .965, -.07], [7, 4]), "head", "hair", 8, group.hair("bun"));
  add(ellipsoid([.07, .085, .034], [0, .865, -.05], [8, 5]), "head", "hair", 8, group.hair("long"));
  // Arms: shoulder, sleeve, a shirt cuff showing under the jacket, the hand.
  for (
    const [side, upper, fore, hand, surface] of [
      [1, "upperArmL", "foreArmL", "handL", 10],
      [-1, "upperArmR", "foreArmR", "handR", 14],
    ] as const
  ) {
    add(ellipsoid([.046, .044, .05], [side * .118, .77, 0], [7, 5]), upper, "coat", surface);
    add(capsule(restJoints[upper], restJoints[fore], .037), upper, "coat", surface);
    const wrist = restJoints[hand];
    add(capsule(restJoints[fore], [wrist[0], wrist[1] + .03, wrist[2]], .031), fore, "coat", surface);
    add(
      new THREE.CylinderGeometry(.03, .03, .016, 7).translate(wrist[0], wrist[1] + .024, wrist[2]),
      fore,
      "shirt",
      surface + 1,
      group.jacket,
    );
    add(ellipsoid([.024, .038, .02], [wrist[0], wrist[1] - .026, wrist[2] + .004], [6, 4]), hand, "skin", surface + 2);
  }
  // Props, authored around their bone's origin.
  add(capsule([0, 0, 0], [0, -.1, 0], .011, 5), "handset", "shoe-0", 30);
  add(ellipsoid([.017, .014, .02], [0, -.004, .008], [5, 3]), "handset", "shoe-0", 30);
  add(ellipsoid([.016, .013, .02], [0, -.098, .01], [5, 3]), "handset", "shoe-0", 30);
  add(new THREE.BoxGeometry(.075, .095, .004), "slip", "paper-0", 31);
  add(
    panel([
      [-.055, 0, -.04],
      [0, 0, .07],
      [0, .016, -.04],
      [0, .016, -.04],
      [0, 0, .07],
      [.055, 0, -.04],
    ]),
    "plane",
    "paper-0",
    32,
  );
  add(new THREE.CylinderGeometry(.019, .016, .048, 8), "cup", "paper-0", 33);
  return list;
};

const slot = (paint: Paint) => isTraderPaint(paint) ? traderMaterials[paint] : PaletteName.literals.indexOf(paint);

// The whole trader as one indexed geometry, positions relative to each part's
// bone. Each part is one smooth surface, so its vertices are shared: a crowd
// of a thousand costs far fewer vertex invocations than flat triangles would.
// `firstSurface` keeps its outlines clear of its station's surfaces.
export const makeTrader = (firstSurface: number) => {
  const positions: Array<number> = [], normals: Array<number> = [], lanes: Array<number> = [];
  const indices: Array<number> = [];
  for (const part of parts()) {
    const source = part.geometry;
    const position = source.getAttribute("position"), normal = source.getAttribute("normal");
    const first = positions.length / 3;
    const [jx, jy, jz] = restJoints[part.bone];
    for (let index = 0; index < position.count; index++) {
      positions.push(position.getX(index) - jx, position.getY(index) - jy, position.getZ(index) - jz);
      normals.push(normal.getX(index), normal.getY(index), normal.getZ(index));
      // Surface, material, line class (always ordinary) and bone in one lane.
      lanes.push(firstSurface + part.surface, slot(part.paint), 0, bone(part.bone) + boneStride * part.visibility);
    }
    const order = source.index;
    if (order) { for (let index = 0; index < order.count; index++) indices.push(first + order.getX(index)); }
    else for (let index = 0; index < position.count; index++) indices.push(first + index);
    source.dispose();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("_PART", new THREE.Float32BufferAttribute(lanes, 4));
  geometry.setIndex(indices);
  return geometry;
};
