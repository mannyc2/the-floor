import { Effect } from "effect";
import * as THREE from "three";
import { type TraderPaint, traderPaints } from "../../src/map/_lib/assets/trader-kit";
import { inflate, type Mesh, separate, simplify, slice, smooth, vertexCount, withNormals } from "./mesh";
import type { Skeleton } from "./skeleton";

// Dresses a base body as a 1980s trader by painting regions of its own
// surface: the picked character sheets draw traders in a jacket over a shirt
// and tie (or shirtsleeves with braces), trousers and shoes, with a smooth,
// featureless head. Region borders are cut into the mesh along analytic
// curves in the bind pose (a T-pose, facing +Z, left toward +X), so they stay
// clean after simplification.

export type Paint = TraderPaint | "shoe" | "handset" | "paper";
// Fixed paints take an Atlas palette entry; trader paints resolve per instance.
export const fixedPaints = { shoe: "shoe-0", handset: "shoe-0", paper: "paper-0" } as const;

interface Landmarks {
  readonly top: number;
  // The front of the body, where a jacket opens.
  readonly front: number;
  readonly collar: number;
  readonly neck: number;
  readonly sternum: number;
  readonly belt: number;
  readonly hem: number;
  readonly ankle: number;
  readonly elbow: number;
  readonly wrist: number;
  readonly headCentre: THREE.Vector3;
}

const jointsAt = (skeleton: Skeleton, scale: number) => (name: string) =>
  new THREE.Vector3().setFromMatrixPosition(
    (skeleton.inverseBind[skeleton.names.indexOf(name)] ?? new THREE.Matrix4()).clone().invert(),
  ).multiplyScalar(scale);

const landmarksOf = (mesh: Mesh, skeleton: Skeleton, scale: number): Landmarks => {
  const at = jointsAt(skeleton, scale);
  let top = 0;
  for (let v = 0; v < vertexCount(mesh); v++) top = Math.max(top, mesh.positions[v * 3 + 1] ?? 0);
  const neck = at("neck_01"), pelvis = at("pelvis");
  return {
    top,
    front: at("Head").z - .01,
    collar: neck.y - .012,
    neck: neck.y + .016,
    sternum: at("spine_02").y,
    belt: pelvis.y + .052,
    hem: pelvis.y - .052,
    ankle: at("foot_l").y + .014,
    elbow: at("lowerarm_l").x + .035,
    wrist: at("hand_l").x - .014,
    headCentre: at("Head"),
  };
};

type Band = (x: number, y: number, z: number) => boolean;
const arms: Band = x => Math.abs(x) > .2;
const trunk: Band = x => Math.abs(x) < .2;

// Every border is the zero set of one of these cuts. Each cut is linear
// across a triangle (a plane, or a line in y), so a cut lands exactly where
// the paint changes: a strip narrower than a triangle still gets both edges.
const fields = (m: Landmarks) => {
  const opening = (y: number) => .048 * Math.min(1, Math.max(0, (y - m.sternum) / (m.collar - m.sternum)));
  const knot = m.collar - .018;
  const tie = (y: number) => y > knot ? .016 : .011 + .003 * (y - m.sternum) / (m.collar - m.sternum);
  const gap = (y: number) => .012 + (m.belt - y) * .45;
  const braces = [.054, .07] as const;
  type Field = (x: number, y: number, z: number) => number;
  const mirrored = (offset: (y: number) => number, within: Band) =>
    [{ cut: (x: number, y: number) => x - offset(y), within }, { cut: (x: number, y: number) => x + offset(y), within }];
  const level = (height: number, within: Band) => ({ cut: (_x: number, y: number) => y - height, within });
  const chest: Band = (x, y, z) => Math.abs(x) < .07 && z > m.front - .02 && y > m.belt && y < m.collar;
  // Band edges first, then the cuts inside the bands.
  const list: ReadonlyArray<{ readonly cut: Field; readonly within: Band }> = [
    ...[m.wrist, m.wrist - .024, m.elbow].flatMap(offset => mirrored(() => offset, arms)),
    ...[m.neck, m.collar, m.belt, m.hem, m.ankle].map(height => level(height, trunk)),
    { cut: (_x, _y, z) => z - m.front, within: (x, y) => Math.abs(x) < .1 && y > m.hem && y < m.collar },
    ...[m.sternum, knot].map(height => level(height, chest)),
    ...mirrored(() => .05, (x, y) => Math.abs(x) < .1 && y > m.collar && y < m.neck),
    ...braces.flatMap(offset => mirrored(() => offset, (_x, y) => y > m.belt && y < m.collar)),
    ...[opening, tie].flatMap(offset => mirrored(offset, chest)),
    ...mirrored(gap, (x, y, z) => Math.abs(x) < .1 && z > m.front && y > m.hem && y < m.belt),
  ];
  return { opening, tie, gap, braces, list };
};

interface Spot {
  readonly ax: number;
  readonly y: number;
  readonly front: boolean;
  readonly braces: boolean;
}
type Fields = ReturnType<typeof fields>;
// The first rule a triangle's centre meets names its paint.
const paintRules = (m: Landmarks, f: Fields): ReadonlyArray<readonly [(spot: Spot) => boolean, Paint]> => {
  const open = (spot: Spot) => spot.front && spot.y > m.sternum && spot.ax < f.opening(spot.y);
  return [
    [spot => spot.ax > m.wrist, "skin"],
    [spot => spot.ax > m.wrist - .024, "cuff"],
    [spot => spot.ax > m.elbow, "forearm"],
    [spot => spot.y > m.neck, "skin"],
    [spot => spot.y < m.ankle, "shoe"],
    [spot => spot.y > m.collar && spot.ax < .05, "shirt"],
    [spot => spot.y > m.collar, "coat"],
    [spot => spot.front && spot.y > m.sternum && spot.ax < f.tie(spot.y), "tie"],
    [spot => open(spot) && spot.braces, "bracesOpen"],
    [open, "shirt"],
    [spot => spot.braces, "braces"],
    [spot => spot.front && spot.y > m.belt && spot.ax < f.tie(spot.y), "tieLow"],
    [spot => spot.y > m.belt, "coat"],
    [spot => spot.y > m.hem && spot.front && spot.ax < f.gap(spot.y), "trousers"],
    [spot => spot.y > m.hem, "skirt"],
  ];
};
const paintAt = (m: Landmarks, f: Fields, x: number, y: number, z: number): Paint => {
  const ax = Math.abs(x);
  const spot = { ax, y, front: z > m.front, braces: ax > f.braces[0] && ax < f.braces[1] && y > m.belt && y < m.collar };
  return paintRules(m, f).find(([applies]) => applies(spot))?.[1] ?? "trousers";
};

const ramp = (value: number, from: number, to: number) => Math.min(1, Math.max(0, (value - from) / (to - from)));
const heightOf = (mesh: Mesh, v: number) => mesh.positions[v * 3 + 1] ?? 0;
const sideOf = (mesh: Mesh, v: number) => Math.abs(mesh.positions[v * 3] ?? 0);

// Labels each triangle of `mesh` with its paint, by its centre.
const paintTriangles = (mesh: Mesh, m: Landmarks, f: Fields) => {
  const paints: Array<Paint> = [];
  const labels = separate(mesh, triangle => {
    const centre = [0, 1, 2].map(axis =>
      [0, 1, 2].reduce((sum, k) => sum + (mesh.positions[(mesh.indices[triangle * 3 + k] ?? 0) * 3 + axis] ?? 0), 0) / 3
    );
    const paint = paintAt(m, f, centre[0] ?? 0, centre[1] ?? 0, centre[2] ?? 0);
    if (!paints.includes(paint)) paints.push(paint);
    return paints.indexOf(paint);
  });
  return [...labels].map(([label, part]): DressedPart => ({ mesh: part, paint: paints[label] ?? "coat" }));
};

// The face is the picked sheets' smooth, featureless egg: the front of the
// head, between the ears and below the brow, is pressed onto an ellipsoid
// fitted to the head, fading out toward its edges.
// The bounding box of the vertices at or above `floor`.
const boxAbove = (mesh: Mesh, floor: number) => {
  const box = new THREE.Box3();
  const point = new THREE.Vector3();
  for (let v = 0; v < vertexCount(mesh); v++) {
    point.fromArray(mesh.positions, v * 3);
    if (point.y >= floor) box.expandByPoint(point);
  }
  return { min: box.min.toArray(), max: box.max.toArray() };
};

const blankFace = (mesh: Mesh, m: Landmarks): Mesh => {
  const chin = m.neck + .012;
  const box = boxAbove(mesh, chin);
  const centre = [0, 1, 2].map(axis => ((box.min[axis] ?? 0) + (box.max[axis] ?? 0)) / 2);
  const radii = [.92, 1, .97].map((k, axis) => k * ((box.max[axis] ?? 0) - (box.min[axis] ?? 0)) / 2);
  const positions = mesh.positions.slice();
  const brow = m.top - .045;
  for (let v = 0; v < vertexCount(mesh); v++) {
    const p = [0, 1, 2].map(axis => mesh.positions[v * 3 + axis] ?? 0);
    const d = p.map((value, axis) => value - (centre[axis] ?? 0));
    const weight = ramp(d[2] ?? 0, -.005, .02) * (1 - ramp(p[1] ?? 0, brow - .01, brow + .015))
      * ramp(p[1] ?? 0, m.neck - .005, chin + .01) * (1 - ramp(Math.abs(p[0] ?? 0), .045, .062));
    if (weight <= 0) continue;
    const reach = Math.sqrt(d.reduce((sum, value, axis) => sum + (value / (radii[axis] ?? 1)) ** 2, 0)) || 1;
    for (let axis = 0; axis < 3; axis++) {
      const onSurface = (centre[axis] ?? 0) + (d[axis] ?? 0) / reach;
      positions[v * 3 + axis] = (p[axis] ?? 0) + weight * (onSurface - (p[axis] ?? 0));
    }
  }
  return withNormals({ ...mesh, positions });
};

export interface DressedPart {
  readonly mesh: Mesh;
  readonly paint: Paint;
}

// The body, scaled to the figure height H = 1, sculpted, cut, painted and
// simplified, as one mesh per paint.
export const dress = Effect.fnUntraced(function*(body: Mesh, skeleton: Skeleton, scale: number, detail: number) {
  const m = landmarksOf(body, skeleton, scale);
  const f = fields(m);
  const faceless = smooth(blankFace(body, m), v => (heightOf(body, v) > m.neck - .01 && sideOf(body, v) < .07 ? .6 : 0), 6);
  // Cloth hides muscle: the torso, arms and legs lose their modelled detail.
  const ironed = smooth(faceless, v => (heightOf(faceless, v) < m.collar && sideOf(faceless, v) < m.wrist - .03 ? .8 : 0), 8);
  const clothed = inflate(ironed, v => {
    const height = heightOf(ironed, v);
    if (height > m.collar || sideOf(ironed, v) > m.wrist - .024 || height < m.ankle) return 0;
    return height > m.hem ? .006 : .004;
  });
  // Tone bands follow a much softer body than the silhouette, so shading
  // reads as a few broad planes, as a drawn figure's would, not as muscle.
  const soft = smooth(clothed, v => (sideOf(clothed, v) > m.wrist - .02 ? .3 : 1), 30);
  // Simplify first, then cut: borders stay exact without the dense chains of
  // vertices a cut through the full-resolution body would leave. The kept
  // vertices carry the soft body's normals.
  const coarse = yield* simplify({ ...clothed, normals: soft.normals }, detail, .02);
  const cut = f.list.reduce<Mesh>((mesh, { cut: field, within }) => slice(mesh, field, within), coarse);
  return paintTriangles(cut, m, f);
});

export const paintSlot = (paint: Paint, paletteIndex: (name: string) => number) =>
  paint === "shoe" || paint === "handset" || paint === "paper"
    ? paletteIndex(fixedPaints[paint])
    : traderPaints[paint];
