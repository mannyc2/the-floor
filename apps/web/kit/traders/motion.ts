import * as THREE from "three";
import { type Animation, type Local, sample, type Skeleton, worldOf } from "./skeleton";

// Motion capture retargeted onto the trader's body. The capture's skeleton
// shares joint names with the body but not its rest orientations or lengths,
// so each joint takes the capture's rotation away from its own rest pose,
// measured in world space, and applies it to the body's rest pose. Bone
// lengths stay the body's; only the hips' travel is carried over, scaled by
// leg length.

const worldRotations = (skeleton: Skeleton, locals: ReadonlyArray<Local>) => {
  const base = new THREE.Quaternion().setFromRotationMatrix(skeleton.base);
  const world: Array<THREE.Quaternion> = [];
  skeleton.parents.forEach((parent, index) => {
    const local = locals[index]?.rotation ?? new THREE.Quaternion();
    world.push((parent < 0 ? base : world[parent] ?? base).clone().multiply(local));
  });
  return world;
};

export interface Retarget {
  readonly target: Skeleton;
  readonly source: Skeleton;
  readonly sourceRest: ReadonlyArray<THREE.Quaternion>;
  readonly targetRest: ReadonlyArray<THREE.Quaternion>;
  readonly hips: number;
  readonly hipScale: number;
}
export const retargeting = (target: Skeleton, source: Skeleton): Retarget => {
  const hips = target.names.indexOf("pelvis");
  const height = (skeleton: Skeleton) =>
    new THREE.Vector3().setFromMatrixPosition(worldOf(skeleton, skeleton.rest)[hips] ?? new THREE.Matrix4()).y;
  return {
    target,
    source,
    sourceRest: worldRotations(source, source.rest),
    targetRest: worldRotations(target, target.rest),
    hips,
    hipScale: height(target) / Math.max(1e-6, height(source)),
  };
};

// The body's local transforms for `animation` at `time` seconds.
export const retargeted = (retarget: Retarget, animation: Animation, time: number): Array<Local> => {
  const { source, target } = retarget;
  const sourceLocals = sample(source, animation, time);
  const sourceWorld = worldRotations(source, sourceLocals);
  const world: Array<THREE.Quaternion> = [];
  return target.parents.map((parent, index) => {
    const rest = target.rest[index];
    const delta = (sourceWorld[index] ?? new THREE.Quaternion()).clone()
      .multiply((retarget.sourceRest[index] ?? new THREE.Quaternion()).clone().invert());
    world.push(delta.multiply(retarget.targetRest[index] ?? new THREE.Quaternion()));
    const parentWorld = parent < 0
      ? new THREE.Quaternion().setFromRotationMatrix(target.base)
      : world[parent] ?? new THREE.Quaternion();
    const rotation = parentWorld.clone().invert().multiply(world[index] ?? new THREE.Quaternion());
    const translation = rest?.translation.clone() ?? new THREE.Vector3();
    if (index === retarget.hips) {
      const moved = (sourceLocals[index]?.translation ?? new THREE.Vector3()).clone()
        .sub(source.rest[index]?.translation ?? new THREE.Vector3());
      translation.addScaledVector(moved, retarget.hipScale);
    }
    return { translation, rotation, scale: rest?.scale.clone() ?? new THREE.Vector3(1, 1, 1) };
  });
};

// A posed joint's skinning transform in figure units: rotation, translation
// and uniform scale taking a bind-pose vertex to its posed place.
export interface Skinning {
  readonly rotation: THREE.Quaternion;
  readonly translation: THREE.Vector3;
  readonly scale: number;
}
export const skinningOf = (skeleton: Skeleton, locals: ReadonlyArray<Local>, unit: number): Array<Skinning> =>
  worldOf(skeleton, locals).map((world, index) => {
    const matrix = world.clone().multiply(skeleton.inverseBind[index] ?? new THREE.Matrix4());
    const translation = new THREE.Vector3(), rotation = new THREE.Quaternion(), scale = new THREE.Vector3();
    matrix.decompose(translation, rotation, scale);
    return { rotation, translation: translation.multiplyScalar(unit), scale: (scale.x + scale.y + scale.z) / 3 };
  });

// Joint positions in figure units, for placing props and measuring.
export const jointPositions = (skeleton: Skeleton, locals: ReadonlyArray<Local>, unit: number) =>
  worldOf(skeleton, locals).map(world => new THREE.Vector3().setFromMatrixPosition(world).multiplyScalar(unit));
