import { lineClasses } from "@floor/atlas/look";
import { Option } from "effect";
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { Engine } from "../../src/map/_lib/renderer/engine";
import { PaletteName } from "../../src/map/_lib/renderer/palette";
import { WorkbenchFailure } from "../runtime";

export type Point = readonly [number, number, number];
export type Part = { readonly geometry: THREE.BufferGeometry; readonly slot: PaletteName };
export const part = (geometry: THREE.BufferGeometry, slot: PaletteName): Part => ({ geometry, slot });
export const box = (w: number, h: number, d: number, x: number, y: number, z: number, slot: PaletteName) =>
  part(new THREE.BoxGeometry(w, h, d).translate(x, y, z), slot);
export const oval = (w: number, h: number, d: number, x: number, y: number, z: number, slot: PaletteName) =>
  part(new THREE.SphereGeometry(1, 16, 10).scale(w / 2, h / 2, d / 2).translate(x, y, z), slot);
export const limb = (a: Point, b: Point, radius: number, slot: PaletteName) => {
  const from = new THREE.Vector3(...a), to = new THREE.Vector3(...b);
  const distance = from.distanceTo(to);
  const rotation = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    to.clone().sub(from).normalize(),
  );
  const centre = from.add(to).multiplyScalar(.5);
  return part(
    new THREE.CapsuleGeometry(radius, Math.max(.001, distance), 4, 10)
      .applyQuaternion(rotation).translate(centre.x, centre.y, centre.z),
    slot,
  );
};

export const createProportionGeometry = (engine: Engine, night: boolean) => {
  const data = engine.diagnosticScene();
  const material = Option.fromUndefinedOr(data.meshes[0]?.material);
  const counters = { entity: 2000 };
  const objects: Array<{ readonly id: number; readonly name: string; readonly bounds: Array<number> }> = [];
  if (Option.isNone(material)) return Option.none<ReturnType<typeof makeBuilder>>();
  const makeBuilder = () => ({
    objects,
    add: (name: string, parts: ReadonlyArray<Part>, origin: Point = [0, 0, 0], yaw = 0, scale = 1, smooth = false) => {
      const entity = counters.entity++;
      let surface = 1;
      const geometries = parts.map(({ geometry, slot }) => {
        geometry.scale(scale, scale, scale).rotateY(yaw).translate(...origin);
        const flat = geometry.index ? geometry.toNonIndexed() : geometry;
        if (flat !== geometry) geometry.dispose();
        // This wordless diagnostic has no texture coordinates. Dropping UVs
        // lets hand-authored paper planes share the material with primitives.
        flat.deleteAttribute("uv");
        const count = flat.getAttribute("position").count;
        const values = (value: number) => new THREE.BufferAttribute(new Float32Array(count).fill(value), 1);
        const surfaces = new Float32Array(count).fill(smooth ? PaletteName.literals.indexOf(slot) + 1 : surface++);
        // Smooth limbs are one authored surface. Box faces keep their creases;
        // triangulation itself must never turn into stripes on a rounded head.
        if (!smooth) flat.groups.forEach(group => surfaces.fill(surface++, group.start, group.start + group.count));
        flat.clearGroups();
        flat.setAttribute("_SURFACE", new THREE.BufferAttribute(surfaces, 1));
        flat.setAttribute("_MAT", values(PaletteName.literals.indexOf(slot)));
        flat.setAttribute("_ENTITY", values(entity));
        flat.setAttribute(
          "_LINE",
          values(
            night && ["paper-", "screen-light-", "lamp-light-"].some(prefix => slot.startsWith(prefix))
              ? lineClasses.surfaceDark.value
              : lineClasses.ordinary.value,
          ),
        );
        flat.setAttribute("_PALETTE", values(-1));
        flat.setAttribute("_ANIMATED", values(0));
        flat.setAttribute("_PREVIOUS", values(0));
        flat.setAttribute("_NEXT", values(0));
        return flat;
      });
      const mergedResult = Option.fromNullOr(mergeGeometries(geometries));
      geometries.forEach(geometry => geometry.dispose());
      const merged = Option.getOrThrowWith(
        mergedResult,
        () => new WorkbenchFailure({ operation: "proportion-geometry", cause: `Could not merge ${name}` }),
      );
      merged.computeBoundingBox();
      const bounds = Option.getOrThrowWith(
        Option.fromNullOr(merged.boundingBox),
        () => new WorkbenchFailure({ operation: "proportion-bounds", cause: name }),
      );
      objects.push({ id: entity, name, bounds: [...bounds.min.toArray(), ...bounds.max.toArray()] });
      const mesh = new THREE.Mesh(merged, material.value);
      mesh.name = `proportion-study-${name}`;
      data.scene.add(mesh);
      data.meshes.push(mesh);
      data.geometries.push(merged);
      data.entities.push({ id: entity, mesh, maybeInstance: Option.none() });
      engine.onDispose(() => {
        mesh.removeFromParent();
        merged.dispose();
      });
      return entity;
    },
  });
  return Option.some(makeBuilder());
};
export type ProportionGeometry = Option.Option.Value<ReturnType<typeof createProportionGeometry>>;
