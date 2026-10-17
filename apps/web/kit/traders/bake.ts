import { PaletteName } from "@floor/atlas/materials";
import { Effect, Option } from "effect";
import * as THREE from "three";
import { clips } from "../../src/map/_lib/assets/clips";
import { seating } from "../../src/map/_lib/live-layout";
import {
  bodies as bodyNames,
  hairStyles,
  props,
  skinScale,
  type TraderKit,
  traderPaints,
  visibility,
} from "../../src/map/_lib/assets/trader-kit";
import { dress, type Paint, paintSlot } from "./body";
import { type Gltf, GltfError, readGltf } from "./gltf";
import { concat, type Mesh, readSkinnedMesh, simplify, transform, vertexCount, weld, withNormals } from "./mesh";
import { makePoser, type Prop, propPose } from "./ik";
import { type Retarget, retargeted, retargeting, skinningOf } from "./motion";
import { recipes } from "./recipes";
import { type Animation, readAnimations, readSkeleton, reproportion, type Skeleton, worldOf } from "./skeleton";

// Builds the trader kit from the CC0 sources in `assets/traders/source`.
// `read` loads a source file by name.

export const sources = {
  bodies: { male: "Superhero_Male_FullBody.gltf", female: "Superhero_Female_FullBody.gltf" },
  hair: {
    parted: "Hair_SimpleParted.gltf",
    buzzed: "Hair_Buzzed.gltf",
    long: "Hair_Long.gltf",
    bun: "Hair_Buns.gltf",
    cropped: "Hair_BuzzedFemale.gltf",
  },
  motion: "UAL1_Standard.glb",
} as const satisfies {
  bodies: Record<(typeof bodyNames)[number], string>;
  hair: Record<(typeof hairStyles)[number], string>;
  motion: string;
};

// Frames baked per clip; the shader blends neighbouring frames.
export const framesPerClip = 48;
// The approved Roomy head height, chin to crown, before hair.
const headHeight = .175;

const vertexTotal = (gltf: Gltf, mesh: NonNullable<Gltf["document"]["meshes"]>[number]) =>
  gltf.document.accessors[mesh.primitives[0]?.attributes["POSITION"] ?? -1]?.count ?? 0;
// A body file's body: its largest mesh, beside the eyes and eyebrows.
const largestMesh = (gltf: Gltf) =>
  (gltf.document.meshes ?? []).toSorted((a, b) => vertexTotal(gltf, b) - vertexTotal(gltf, a))[0]?.name ?? "";

// Moves a mesh bound to another file's bind pose into `skeleton`'s bind pose,
// so every body and hairstyle shares one set of skinning transforms.
const rebind = (mesh: Mesh, from: Skeleton, to: Skeleton): Mesh => {
  const moves = to.names.map((name, joint) => {
    const own = from.inverseBind[from.names.indexOf(name)] ?? new THREE.Matrix4();
    return (to.inverseBind[joint] ?? new THREE.Matrix4()).clone().invert().multiply(own);
  });
  const positions = mesh.positions.slice();
  const point = new THREE.Vector3(), sum = new THREE.Vector3();
  for (let v = 0; v < vertexCount(mesh); v++) {
    sum.set(0, 0, 0);
    for (let k = 0; k < 4; k++) {
      const weight = mesh.weights[v * 4 + k] ?? 0;
      if (weight === 0) continue;
      point.fromArray(mesh.positions, v * 3).applyMatrix4(moves[mesh.joints[v * 4 + k] ?? 0] ?? new THREE.Matrix4());
      sum.addScaledVector(point, weight);
    }
    sum.toArray(positions, v * 3);
  }
  return withNormals({ ...mesh, positions });
};

// A rigid piece of geometry on one bone, authored in figure units.
const rigid = (geometry: THREE.BufferGeometry, bone: number): Mesh => {
  const position = geometry.getAttribute("position"), normal = geometry.getAttribute("normal");
  const count = position.count;
  const mesh: Mesh = {
    positions: Float32Array.from({ length: count * 3 }, (_, i) => position.array[i] ?? 0),
    normals: Float32Array.from({ length: count * 3 }, (_, i) => normal.array[i] ?? 0),
    joints: Uint8Array.from({ length: count * 4 }, (_, i) => (i % 4 === 0 ? bone : 0)),
    weights: Float32Array.from({ length: count * 4 }, (_, i) => (i % 4 === 0 ? 1 : 0)),
    indices: Option.match(Option.fromNullOr(geometry.index), {
      onNone: () => Uint32Array.from({ length: count }, (_, i) => i),
      onSome: index => Uint32Array.from(index.array),
    }),
  };
  geometry.dispose();
  return mesh;
};
const capsule = (length: number, radius: number) =>
  new THREE.CapsuleGeometry(radius, length, 2, 6).translate(0, -length / 2, 0);
// The props, each around its bone's origin: the handset's earpiece at the
// origin with the mouthpiece below, a slip of paper, a folded paper plane
// with its nose toward +Z, and a coffee cup.
const propGeometry = (prop: Prop): ReadonlyArray<readonly [THREE.BufferGeometry, Paint]> => {
  if (prop === "handset") {
    return [
      [capsule(.1, .011), "handset"],
      [new THREE.SphereGeometry(1, 6, 4).scale(.017, .014, .02).translate(0, -.004, .008), "handset"],
      [new THREE.SphereGeometry(1, 6, 4).scale(.016, .013, .02).translate(0, -.098, .01), "handset"],
    ];
  }
  if (prop === "slip") return [[new THREE.BoxGeometry(.075, .095, .004), "paper"]];
  if (prop === "cup") return [[new THREE.CylinderGeometry(.019, .016, .048, 8), "paper"]];
  const wing = new THREE.BufferGeometry();
  wing.setAttribute("position", new THREE.Float32BufferAttribute([
    -.055, 0, -.04, 0, 0, .07, 0, .016, -.04,
    0, .016, -.04, 0, 0, .07, .055, 0, -.04,
  ], 3));
  wing.computeVertexNormals();
  return [[wing, "paper"]];
};

const bump = (y: number, centre: number, width: number) => Math.exp(-(((y - centre) / width) ** 2));
// A fuller waist and a shallower chest, around the spine, in source units:
// an office build rather than a gymnast's.
const ordinaryBuild = (mesh: Mesh): Mesh => {
  const positions = mesh.positions.slice();
  for (let v = 0; v < vertexCount(mesh); v++) {
    const x = mesh.positions[v * 3] ?? 0, y = mesh.positions[v * 3 + 1] ?? 0, z = mesh.positions[v * 3 + 2] ?? 0;
    if (Math.abs(x) > .2) continue;
    const girth = 1 + .07 * bump(y, 1.07, .09) - .05 * bump(y, 1.3, .08);
    positions[v * 3] = x * girth;
    positions[v * 3 + 2] = z * (1 + .5 * (girth - 1));
  }
  return withNormals({ ...mesh, positions });
};

interface Piece {
  readonly mesh: Mesh;
  readonly paint: Paint | "hair";
  readonly group: number;
}

const paletteIndex = (name: string) => PaletteName.literals.findIndex(literal => literal === name);
const assemble = (pieces: ReadonlyArray<Piece>, bones: number) => {
  const all = concat(pieces.map(piece => piece.mesh));
  const part = new Float32Array(vertexCount(all) * 4);
  const skin = new Float32Array(vertexCount(all) * 4);
  let vertex = 0;
  for (const piece of pieces) {
    const slot = piece.paint === "hair" ? traderPaints.hair : paintSlot(piece.paint, paletteIndex);
    for (let v = 0; v < vertexCount(piece.mesh); v++, vertex++) part.set([0, slot, 0, piece.group], vertex * 4);
  }
  // Influences are stored strongest first, so the shader stops at the
  // first empty one; weights quantize to bytes that still sum to 255.
  for (let v = 0; v < vertexCount(all); v++) {
    const influences = [0, 1, 2, 3]
      .map(k => ({ joint: Math.min(bones - 1, all.joints[v * 4 + k] ?? 0), weight: all.weights[v * 4 + k] ?? 0 }))
      .toSorted((a, b) => b.weight - a.weight);
    const total = influences.reduce((sum, influence) => sum + influence.weight, 0) || 1;
    const bytes = influences.map(influence => Math.round(influence.weight / total * 255));
    bytes[0] = (bytes[0] ?? 0) + 255 - bytes.reduce((sum, value) => sum + value, 0);
    influences.forEach((influence, k) => {
      skin[v * 4 + k] = influence.joint * skinScale + (bytes[k] ?? 0);
    });
  }
  return { all, part, skin };
};

type Load = (name: string) => Effect.Effect<Gltf, GltfError>;

// Both bodies, dressed, then every hairstyle and the props, in one mesh.
const bakeGeometry = Effect.fnUntraced(function*(
  load: Load,
  skeleton: Skeleton,
  bodies: ReadonlyArray<readonly [(typeof bodyNames)[number], Mesh]>,
  unit: number,
) {
  const pieces: Array<Piece> = [];
  for (const [body, mesh] of bodies) {
    const dressed = yield* dress(weld(transform(mesh, unit)), skeleton, unit, .08);
    for (const part of dressed) pieces.push({ mesh: part.mesh, paint: part.paint, group: visibility.body(body) });
  }
  for (const style of hairStyles) {
    const gltf = yield* load(sources.hair[style]);
    const mesh = rebind(readSkinnedMesh(gltf, skeleton, () => true), readSkeleton(gltf), skeleton);
    pieces.push({ mesh: yield* simplify(weld(transform(mesh, unit)), .28, .01), paint: "hair", group: visibility.hair(style) });
  }
  props.forEach((prop, index) => {
    for (const [geometry, paint] of propGeometry(prop)) {
      pieces.push({ mesh: rigid(geometry, skeleton.names.length + index), paint, group: visibility.always });
    }
  });
  return assemble(pieces, skeleton.names.length + props.length);
});

// The scale that grows the head about its joint to the approved height,
// measured from the crown to the chin's lowest point.
const headScaleOf = (mesh: Mesh, skeleton: Skeleton, unit: number) => {
  const joint = new THREE.Vector3().setFromMatrixPosition(
    (skeleton.inverseBind[skeleton.names.indexOf("Head")] ?? new THREE.Matrix4()).clone().invert(),
  ).multiplyScalar(unit);
  let chin = 1;
  for (let v = 0; v < vertexCount(mesh); v++) {
    const x = mesh.positions[v * 3] ?? 0, y = (mesh.positions[v * 3 + 1] ?? 0) * unit, z = (mesh.positions[v * 3 + 2] ?? 0) * unit;
    if (Math.abs(x * unit) < .02 && z > joint.z + .03 && y > joint.y - .06) chin = Math.min(chin, y);
  }
  return headHeight / Math.max(.05, 1 - chin);
};

interface MotionContext {
  readonly skeleton: Skeleton;
  readonly retarget: Retarget;
  readonly unit: number;
  readonly headScale: number;
  readonly width: number;
}

// A seated clip's hips move onto the stool, a little above its seat top,
// keeping the capture's own sway around that place. The hips translate in
// their parent's frame, which the rig turns away from the world's.
const seatLift = (context: MotionContext, animation: Animation) => {
  const { skeleton, unit } = context;
  const hips = skeleton.names.indexOf("pelvis");
  const first = worldOf(skeleton, retargeted(context.retarget, animation, 0));
  const settled = new THREE.Vector3().setFromMatrixPosition(first[hips] ?? new THREE.Matrix4());
  const bind = new THREE.Vector3().setFromMatrixPosition((skeleton.inverseBind[hips] ?? new THREE.Matrix4()).clone().invert());
  const parent = new THREE.Quaternion().setFromRotationMatrix(first[skeleton.parents[hips] ?? 0] ?? new THREE.Matrix4());
  return new THREE.Vector3(bind.x, (seating.seat + .045) / unit, bind.z).sub(settled).applyQuaternion(parent.invert());
};

// One clip's frames, written into its rows of the motion texture.
const bakeClip = (context: MotionContext, motion: Float32Array, clipNumber: number, animation: Animation) => {
  const { skeleton, unit } = context;
  const recipe = recipes[clips[clipNumber]?.name ?? "idle"];
  const head = skeleton.names.indexOf("Head"), hips = skeleton.names.indexOf("pelvis");
  const lift = recipe.seated === true ? seatLift(context, animation) : new THREE.Vector3();
  for (let frame = 0; frame < framesPerClip; frame++) {
    const phase = frame / framesPerClip;
    const locals = retargeted(context.retarget, animation, (phase * recipe.repeats * animation.seconds) % animation.seconds);
    locals[head]?.scale.setScalar(context.headScale);
    locals[hips]?.translation.add(lift);
    const pose = makePoser(skeleton, locals, unit);
    pose.relax("l");
    pose.relax("r");
    recipe.work?.(pose, phase);
    const row = (clipNumber * framesPerClip + frame) * context.width * 4;
    [...skinningOf(skeleton, locals, unit), ...props.map(prop => propPose(pose, skeleton, unit, prop))].forEach(
      (bone, index) => {
        motion.set([bone.rotation.x, bone.rotation.y, bone.rotation.z, bone.rotation.w], row + index * 8);
        motion.set([bone.translation.x, bone.translation.y, bone.translation.z, bone.scale], row + index * 8 + 4);
      },
    );
  }
};

const bakeMotion = Effect.fnUntraced(function*(load: Load, skeleton: Skeleton, unit: number, headScale: number) {
  const captured = yield* load(sources.motion);
  const capturedSkeleton = readSkeleton(captured);
  const animations = readAnimations(captured, capturedSkeleton);
  const width = (skeleton.names.length + props.length) * 2, height = clips.length * framesPerClip;
  const context: MotionContext = { skeleton, retarget: retargeting(skeleton, capturedSkeleton), unit, headScale, width };
  const motion = new Float32Array(width * height * 4);
  for (const [clipNumber, clip] of clips.entries()) {
    const source = recipes[clip.name].source;
    const animation = yield* Effect.fromOption(Option.fromUndefinedOr(animations.find(item => item.name === source)))
      .pipe(Effect.mapError(() => new GltfError({ reason: `missing animation ${source}` })));
    bakeClip(context, motion, clipNumber, animation);
  }
  return { motion, width, height };
});

export const bakeTraderKit = Effect.fnUntraced(function*(read: (name: string) => Effect.Effect<Uint8Array, GltfError>) {
  const load: Load = name => Effect.flatMap(read(name), bytes => readGltf(bytes, read));
  const male = yield* load(sources.bodies.male);
  const source = readSkeleton(male);
  // The sources are superhero builds: the trader's collarbones are shorter,
  // bringing broad shoulders in to an ordinary build.
  const skeleton = reproportion(source, { upperarm_l: .82, upperarm_r: .82 });
  const maleMesh = ordinaryBuild(rebind(readSkinnedMesh(male, source, name => name === largestMesh(male)), source, skeleton));
  const unit = 1 / Math.max(...Array.from({ length: vertexCount(maleMesh) }, (_, v) => maleMesh.positions[v * 3 + 1] ?? 0));
  const female = yield* load(sources.bodies.female);
  const femaleMesh = ordinaryBuild(
    rebind(readSkinnedMesh(female, skeleton, name => name === largestMesh(female)), readSkeleton(female), skeleton),
  );
  const { all, part, skin } = yield* bakeGeometry(load, skeleton, [["male", maleMesh], ["female", femaleMesh]], unit);
  const { motion, width, height } = yield* bakeMotion(load, skeleton, unit, headScaleOf(maleMesh, skeleton, unit));
  return {
    header: {
      bones: [...skeleton.names, ...props],
      frames: framesPerClip,
      clips,
      vertices: vertexCount(all),
      indices: all.indices.length,
      motion: { width, height },
    },
    position: all.positions,
    normal: all.normals,
    part,
    skin,
    index: all.indices,
    motion,
  } satisfies TraderKit;
});
