import { lineClasses } from "@floor/atlas/look";
import { PaletteName } from "@floor/atlas/materials";
import { Option } from "effect";
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { Part } from "../../src/map/_lib/assets/figure";
import type { Point } from "../../src/map/_lib/assets/geometry";
import type { Engine } from "../renderer-probe";
import { WorkbenchFailure } from "../runtime";

// The figure's part helpers live with the figure in the asset kit; the picked
// proportion frames build their posts and chairs from the same primitives.
export { type Part, part, partBox as box } from "../../src/map/_lib/assets/figure";
export type { Point } from "../../src/map/_lib/assets/geometry";

// Entity and surface numbering decide where technique B draws lines, so the
// picked proportion frames depend on this exact allocation order.
export const createProportionGeometry = (engine: Engine, night: boolean) => {
  const data = engine.diagnosticScene();
  const material = Option.fromUndefinedOr(data.meshes[0]?.material);
  const counters = { entity: 2000 };
  if (Option.isNone(material)) return Option.none<ReturnType<typeof makeBuilder>>();
  const makeBuilder = () => ({
    add: (name: string, parts: ReadonlyArray<Part>, origin: Point = [0, 0, 0], yaw = 0, scale = 1, smooth = false) => {
      const entity = counters.entity++;
      let surface = 1;
      const geometries = parts.map(({ geometry, slot }) => {
        geometry.scale(scale, scale, scale).rotateY(yaw).translate(...origin);
        const flat = geometry.index ? geometry.toNonIndexed() : geometry;
        if (flat !== geometry) geometry.dispose();
        // This wordless scene has no texture coordinates. Dropping UVs lets
        // hand-authored parts share one merged geometry with primitives.
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
              ? lineClasses.surfaceDark
              : lineClasses.ordinary,
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
      const mesh = new THREE.Mesh(merged, material.value);
      mesh.name = `proportion-${name}`;
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
