import { Option } from "effect";
import * as THREE from "three";
import type { props } from "../../src/map/_lib/assets/trader-kit";
import { type Local, type Skeleton, worldOf } from "./skeleton";

// Edits a retargeted pose so a trader does the floor's work: hands reach the
// keyboard, the ear or a raised slip by two-bone IK, the spine and head bend,
// and props ride a hand. Targets are in figure units (H = 1), facing +Z with
// the left side toward +X; the skeleton works in its source units.

export type V3 = readonly [number, number, number];
export type Side = "l" | "r";
export type Prop = (typeof props)[number];
export interface Placement {
  readonly follows: string;
  // Offset and rotation in the followed joint's frame, in figure units.
  readonly offset: V3;
  readonly rotation?: V3;
}

const positionOf = (matrix: THREE.Matrix4) => new THREE.Vector3().setFromMatrixPosition(matrix);
const rotationOf = (matrix: THREE.Matrix4) => {
  const rotation = new THREE.Quaternion();
  matrix.decompose(new THREE.Vector3(), rotation, new THREE.Vector3());
  return rotation;
};

export const makePoser = (skeleton: Skeleton, locals: Array<Local>, unit: number) => {
  const index = (name: string) => skeleton.names.indexOf(name);
  const world = () => worldOf(skeleton, locals);
  const toSource = (value: V3) => new THREE.Vector3(...value).divideScalar(unit);
  const placements = new Map<Prop, Placement>();
  // Turns a joint by `delta` in world space; its children follow.
  const turnWorld = (joint: number, delta: THREE.Quaternion) => {
    const matrices = world();
    const parent = skeleton.parents[joint] ?? -1;
    const parentRotation = parent < 0
      ? new THREE.Quaternion().setFromRotationMatrix(skeleton.base)
      : rotationOf(matrices[parent] ?? new THREE.Matrix4());
    const current = rotationOf(matrices[joint] ?? new THREE.Matrix4());
    locals[joint]?.rotation.copy(parentRotation.invert().multiply(delta.clone().multiply(current)));
  };
  // Two-bone IK: moves the end joint toward `target` by `weight`, the middle
  // joint bending toward `pole`; both segments keep their lengths and twist.
  const chain = (root: number, middle: number, end: number, target: V3, pole: V3, weight: number) => {
    if (weight <= 0) return;
    const before = world();
    const start = positionOf(before[root] ?? new THREE.Matrix4());
    const joint = positionOf(before[middle] ?? new THREE.Matrix4());
    const tip = positionOf(before[end] ?? new THREE.Matrix4());
    const upper = start.distanceTo(joint), lower = joint.distanceTo(tip);
    const goal = tip.clone().lerp(toSource(target), Math.min(1, weight));
    const toGoal = goal.clone().sub(start);
    const distance = Math.min(upper + lower - 1e-4, Math.max(Math.abs(upper - lower) + 1e-4, toGoal.length()));
    const along = toGoal.normalize();
    const bendTo = new THREE.Vector3(...pole);
    bendTo.addScaledVector(along, -bendTo.dot(along));
    if (bendTo.lengthSq() < 1e-8) {
      bendTo.copy(joint).sub(start).addScaledVector(along, -joint.clone().sub(start).dot(along));
    }
    bendTo.normalize();
    const cosine = (upper * upper + distance * distance - lower * lower) / (2 * upper * distance);
    const placed = start.clone().addScaledVector(along, upper * cosine)
      .addScaledVector(bendTo, upper * Math.sqrt(Math.max(0, 1 - cosine * cosine)));
    turnWorld(
      root,
      new THREE.Quaternion().setFromUnitVectors(joint.clone().sub(start).normalize(), placed.clone().sub(start).normalize()),
    );
    const after = world();
    const bent = positionOf(after[middle] ?? new THREE.Matrix4());
    const moved = positionOf(after[end] ?? new THREE.Matrix4());
    const reached = start.clone().addScaledVector(along, distance);
    turnWorld(
      middle,
      new THREE.Quaternion().setFromUnitVectors(moved.sub(bent).normalize(), reached.sub(bent).normalize()),
    );
  };
  return {
    world,
    // A joint's position in figure units.
    at: (name: string): THREE.Vector3 => positionOf(world()[index(name)] ?? new THREE.Matrix4()).multiplyScalar(unit),
    // Bends a joint about a world axis.
    bend: (name: string, axis: V3, angle: number) => {
      if (angle === 0) return;
      turnWorld(index(name), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...axis).normalize(), angle));
    },
    // Moves a hand toward `target` by `weight`, the elbow bending toward
    // `pole`; the upper arm and forearm keep their lengths and twist.
    reach: (side: Side, target: V3, pole: V3, weight = 1) =>
      chain(index(`upperarm_${side}`), index(`lowerarm_${side}`), index(`hand_${side}`), target, pole, weight),
    // Sets a foot's ankle at `target`, the knee bending toward `pole`.
    plant: (side: Side, target: V3, pole: V3, weight = 1) =>
      chain(index(`thigh_${side}`), index(`calf_${side}`), index(`foot_${side}`), target, pole, weight),
    // Turns a hand so its palm faces `palm` and its fingers point along
    // `fingers` (world directions), by `weight`.
    orientHand: (side: Side, fingers: V3, palm: V3, weight = 1) => {
      if (weight <= 0) return;
      const joint = index(`hand_${side}`);
      const matrices = world();
      const current = rotationOf(matrices[joint] ?? new THREE.Matrix4());
      // The rig's hand points its fingers along local +Y, its palm along
      // local +X on the left hand and -X on the right.
      const y = new THREE.Vector3(...fingers).normalize();
      const x = new THREE.Vector3(...palm).multiplyScalar(side === "l" ? 1 : -1);
      x.addScaledVector(y, -x.dot(y)).normalize();
      const z = new THREE.Vector3().crossVectors(x, y);
      const wanted = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
      const delta = current.clone().slerp(wanted, Math.min(1, weight)).multiply(current.clone().invert());
      turnWorld(joint, delta);
    },
    // Settles a hand's fingers into a loose, slightly curled rest, whatever
    // the capture did with them.
    relax: (side: Side) => {
      for (const finger of ["index", "middle", "ring", "pinky"]) {
        for (const step of ["01", "02", "03"]) {
          const joint = index(`${finger}_${step}_${side}`);
          const curl = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), step === "01" ? .25 : .35);
          locals[joint]?.rotation.copy(skeleton.rest[joint]?.rotation ?? new THREE.Quaternion()).multiply(curl);
        }
      }
    },
    // Curls a hand's fingers toward a fist (1) from the capture's pose (0).
    grip: (side: Side, amount: number) => {
      if (amount <= 0) return;
      for (const finger of ["index", "middle", "ring", "pinky"]) {
        for (const step of ["01", "02", "03"]) {
          const local = locals[index(`${finger}_${step}_${side}`)];
          local?.rotation.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), amount * 1.1));
        }
      }
    },
    place: (prop: Prop, placement: Placement) => placements.set(prop, placement),
    placements: (): ReadonlyMap<Prop, Placement> => placements,
  };
};
export type Poser = ReturnType<typeof makePoser>;

// A prop's skinning transform in figure units: authored around its own
// origin, carried by the followed joint, or hidden.
export const propPose = (poser: Poser, skeleton: Skeleton, unit: number, prop: Prop) =>
  Option.match(Option.fromUndefinedOr(poser.placements().get(prop)), {
    onNone: () => ({ rotation: new THREE.Quaternion(), translation: new THREE.Vector3(), scale: 0 }),
    onSome: placement => placed(poser, skeleton, unit, placement),
  });
const placed = (poser: Poser, skeleton: Skeleton, unit: number, placement: Placement) => {
  const followed = poser.world()[skeleton.names.indexOf(placement.follows)] ?? new THREE.Matrix4();
  const position = new THREE.Vector3(), rotation = new THREE.Quaternion(), scale = new THREE.Vector3();
  followed.decompose(position, rotation, scale);
  const offset = new THREE.Vector3(...placement.offset).applyQuaternion(rotation);
  const turn = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(placement.rotation ?? [0, 0, 0]), "YXZ"));
  return {
    rotation: rotation.multiply(turn),
    translation: position.multiplyScalar(unit).add(offset),
    scale: 1,
  };
};
