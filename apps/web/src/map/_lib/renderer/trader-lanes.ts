import * as THREE from "three";
import { variantOf } from "../assets/trader";

// One instance's lane from one attribute into a slot of another.
const copy = (source: THREE.InstancedBufferAttribute, target: THREE.BufferAttribute, from: number, to: number) => {
  const size = source.itemSize;
  target.array.set(source.array.subarray(from * size, from * size + size), to * size);
};

// Every desk's trader, drawn by the variant mesh for its body and hairstyle.
// The crowd writes each desk's clips, look and transform into lanes indexed
// by desk; a flush packs the desks present in each variant into that mesh's
// instances, so an absent trader or an unused variant costs nothing to draw.
export const makeTraderLanes = (meshes: ReadonlyArray<THREE.InstancedMesh>, desks: number, firstId: number) => {
  const lane = (size: number, first = 0) => {
    const array = new Float32Array(desks * size);
    for (let at = 0; at < array.length; at += size) array[at] = first;
    return new THREE.InstancedBufferAttribute(array, size);
  };
  const animA = lane(4, -1), animB = lane(4, -1), look = lane(4), matrices = lane(16);
  const members = meshes.map((): Array<number> => []);
  const variantOfDesk = new Int32Array(desks).fill(-1);
  const changed = { members: false, lanes: false };
  const withdraw = (index: number) => {
    const variant = variantOfDesk[index] ?? -1;
    if (variant < 0) return;
    members[variant] = (members[variant] ?? []).filter(desk => desk !== index);
    variantOfDesk[index] = -1;
    changed.members = true;
  };
  return {
    count: desks,
    animA,
    animB,
    look,
    setMatrixAt: (index: number, matrix: THREE.Matrix4) => {
      matrix.toArray(matrices.array, index * 16);
    },
    // Draws desk `index` with the variant its look names, once it has one.
    show: (index: number) => {
      const variant = variantOf([look.getX(index), look.getY(index), look.getZ(index), look.getW(index)]);
      if (variantOfDesk[index] === variant) return;
      withdraw(index);
      members[variant]?.push(index);
      variantOfDesk[index] = variant;
      changed.members = true;
    },
    hide: withdraw,
    // The crowd changed lanes this frame.
    touch: () => {
      changed.lanes = true;
    },
    // Packs present desks into their variants' instances, if anything changed.
    flush: () => {
      if (!changed.lanes && !changed.members) return;
      meshes.forEach((mesh, variant) => {
        const list = members[variant] ?? [];
        const attributes = ["_ANIM_A", "_ANIM_B", "_LOOK"].map(name => mesh.geometry.getAttribute(name));
        const entity = mesh.geometry.getAttribute("_ENTITY");
        list.forEach((desk, slot) => {
          [animA, animB, look].forEach((source, at) => {
            const target = attributes[at];
            if (target instanceof THREE.BufferAttribute) copy(source, target, desk, slot);
          });
          copy(matrices, mesh.instanceMatrix, desk, slot);
          if (changed.members && entity instanceof THREE.BufferAttribute) entity.setX(slot, desk + firstId);
        });
        mesh.count = list.length;
        for (const attribute of [...attributes, mesh.instanceMatrix, ...(changed.members ? [entity] : [])]) {
          if (attribute instanceof THREE.BufferAttribute) attribute.needsUpdate = true;
        }
      });
      changed.lanes = false;
      changed.members = false;
    },
    meshes,
  };
};
export type TraderLanes = ReturnType<typeof makeTraderLanes>;
