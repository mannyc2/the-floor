import { Schema } from "effect";
import * as THREE from "three";

// Specialize Three's generic constructor before instanceof narrowing so its
// unconstrained geometry/material parameters cannot introduce implicit any.
export const isAssetMesh = Schema.is(Schema.instanceOf(THREE.Mesh));
export const disposeAsset = (group: THREE.Group) =>
  group.traverse(object => {
    if (!(isAssetMesh(object))) return;
    object.geometry.dispose();
    if (object.material instanceof THREE.Material) object.material.dispose();
    else object.material.forEach(material => material.dispose());
  });
