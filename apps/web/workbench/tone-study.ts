import { lineClasses } from "@floor/atlas/look";
import { Effect, Option, Schema } from "effect";
import * as THREE from "three";
import type { Engine } from "../src/map/_lib/renderer/engine";
import { Palette, PaletteName } from "../src/map/_lib/renderer/palette";
import { WorkbenchFailure } from "./runtime";

export const ToneStudy = Schema.Struct({
  id: Schema.NonEmptyString,
  palette: Palette,
  lighting: Schema.optionalKey(Schema.Literal("desk-lamps-and-screens")),
});
export type ToneStudy = typeof ToneStudy.Type;
const stationLit = (index: number) => index !== 0 && index !== 5;

export const readToneStudy = Effect.fn("Workbench.readToneStudy")(function*(query: URLSearchParams) {
  const encoded = Option.fromNullOr(query.get("tones"));
  if (Option.isNone(encoded)) return Option.none<ToneStudy>();
  return Option.some(yield* Schema.decodeEffect(Schema.fromJsonString(ToneStudy))(encoded.value));
});

// This fixed blockout isolates the tone choice. Its dimensions, simplified
// stations and neutral shape probes are not proposals for the later kit pick.
export const installToneStudy = (engine: Engine, study: ToneStudy) =>
  Effect.try({
    try: () => {
      const data = engine.diagnosticScene();
      const original = Option.fromUndefinedOr(data.meshes[0]);
      if (Option.isNone(original)) return false;
      const material = original.value.material;
      data.meshes.forEach(mesh => {
        mesh.visible = false;
      });
      data.scene.name = "synthetic-unapproved-tone-study";
      const lighting = study.lighting === "desk-lamps-and-screens";
      const engraving: PaletteName = lighting ? "engraving-0" : "line";
      const counter = { surface: 1, entity: 3000 };
      const add = (geometry: THREE.BufferGeometry, slot: PaletteName, name: string) => {
        const flat = geometry.index ? geometry.toNonIndexed() : geometry;
        if (flat !== geometry) geometry.dispose();
        const size = flat.getAttribute("position").count;
        const surfaces = new Float32Array(size).fill(counter.surface++);
        flat.groups.forEach(group => {
          surfaces.fill(counter.surface++, group.start, group.start + group.count);
        });
        flat.clearGroups();
        const attribute = (value: number) => new THREE.BufferAttribute(new Float32Array(size).fill(value), 1);
        flat.setAttribute("_SURFACE", new THREE.BufferAttribute(surfaces, 1));
        flat.setAttribute("_MAT", attribute(PaletteName.literals.indexOf(slot)));
        // Plates and their raised diagnostic engraving share one dark contour.
        // Other bright faces preserve pale strokes on dim adjoining housings.
        const darkLine = lighting
          && ["paper-", "brass-", "engraving-", "screen-light-", "lamp-light-"].some(prefix => slot.startsWith(prefix));
        const instrumentContour = slot.startsWith("brass-") || slot.startsWith("engraving-");
        const lineClass = darkLine
          ? (instrumentContour ? lineClasses.instrumentContour.value : lineClasses.surfaceDark.value)
          : lineClasses.ordinary.value;
        flat.setAttribute("_LINE", attribute(lineClass));
        const entityId = counter.entity++;
        flat.setAttribute("_ENTITY", attribute(entityId));
        flat.setAttribute("_PALETTE", attribute(-1));
        flat.setAttribute("_ANIMATED", attribute(0));
        flat.setAttribute("_PREVIOUS", attribute(0));
        flat.setAttribute("_NEXT", attribute(0));
        flat.computeBoundingBox();
        const mesh = new THREE.Mesh(flat, material);
        mesh.name = `tone-study-${name}`;
        data.scene.add(mesh);
        data.meshes.push(mesh);
        data.geometries.push(flat);
        data.entities.push({ id: entityId, mesh, maybeInstance: Option.none() });
        engine.onDispose(() => {
          mesh.removeFromParent();
          flat.dispose();
        });
      };
      const box = (
        w: number,
        h: number,
        d: number,
        x: number,
        y: number,
        z: number,
        slot: PaletteName = "timber-0",
        yaw = 0,
      ) => add(new THREE.BoxGeometry(w, h, d).rotateY(yaw).translate(x, y, z), slot, "box");
      const cylinder = (r: number, h: number, x: number, y: number, z: number, slot: PaletteName = "timber-0") =>
        add(new THREE.CylinderGeometry(r, r, h, 48).translate(x, y, z), slot, "cylinder");
      box(12.4, .15, 11.8, 0, -.075, 0, "floor-0");
      cylinder(2.6, 1.3, 0, .65, 0);
      cylinder(2.8, .16, 0, 1.38, 0);
      cylinder(.17, 4.2, 0, 2.1, 0, "steel-0");
      cylinder(.75, .14, 0, 4.2, 0);

      for (let index = 0; index < 8; index++) {
        const angle = index * Math.PI / 4;
        const point = (radius: number, side = 0) => ({
          x: Math.sin(angle) * radius + Math.cos(angle) * side,
          z: Math.cos(angle) * radius - Math.sin(angle) * side,
        });
        const p = point(3.05);
        box(1.8, .15, 1.05, p.x, 1.22, p.z, "timber-0", angle);
        const support = point(3.1);
        box(1.45, 1.145, .7, support.x, .5725, support.z, "timber-0", angle);
        const screen = point(2.93);
        box(.82, .65, .42, screen.x, 1.62, screen.z, "steel-0", angle);
        const glass = point(3.153);
        const screenSlot = lighting && stationLit(index) ? "screen-light-0" : "glass-0";
        box(.66, .46, .025, glass.x, 1.62, glass.z, screenSlot, angle);
        const phone = point(3.2, -.62);
        box(.27, .16, .43, phone.x, 1.375, phone.z, "steel-0", angle);
        for (let stack = 0; stack < 3; stack++) {
          const papers = point(3.24, .52 + stack * .035);
          box(.32, .022, .42, papers.x, 1.306 + stack * .022, papers.z, "paper-0", angle + .12);
        }
        const chair = point(4.13);
        box(.72, .13, .65, chair.x, .72, chair.z, "timber-0", angle);
        cylinder(.08, .68, chair.x, .34, chair.z, "steel-0");
        const back = point(4.45);
        box(.72, .8, .12, back.x, 1.14, back.z, "timber-0", angle);
        const overhead = point(1.25);
        box(1.05, .8, .55, overhead.x, 3.55, overhead.z, "steel-0", angle);
        const face = point(1.54);
        box(.86, .59, .035, face.x, 3.55, face.z, screenSlot, angle);
      }
      for (let index = 0; index < 18; index++) {
        const angle = index * 2.399963229728653;
        const radius = 4.55 + index % 3 * .3;
        box(.29, .018, .4, Math.sin(angle) * radius, .009, Math.cos(angle) * radius, "paper-0", angle);
      }
      // Shape probes and jacket blocks keep the material decision separate
      // from character design, proportions and real readings.
      box(.8, 1.15, .8, 3.7, .575, 4.5);
      cylinder(.43, 1.5, 5, .75, 2.7, "steel-0");
      add(new THREE.SphereGeometry(.55, 32, 16).translate(1.9, .55, 5.2), "glass-0", "sphere");
      box(.68, 1.05, .68, -4.9, .525, 2.8, "jacket-blue-0");
      box(.68, 1.05, .68, -5, .525, 4, "jacket-red-0");
      box(.68, 1.05, .68, -4.7, .525, 5.1, "jacket-green-0");

      // The static gallery is explicitly synthetic. Top-facing dial plates
      // make each brass/mount pair measurable without inventing live data.
      const mounts: ReadonlyArray<PaletteName> = ["timber-0", "steel-0", "glass-0"];
      mounts.forEach((mount, index) => {
        const x = -2.9 + index * 1.6, z = 5.1, top = .65;
        box(1.25, top, 1, x, top / 2, z, mount);
        add(
          new THREE.CircleGeometry(.43, 48).rotateX(-Math.PI / 2).translate(x, top + .015, z),
          "brass-0",
          "synthetic-brass-dial",
        );
        for (let tick = 0; tick <= 10; tick++) {
          const angle = -.75 * Math.PI + tick * 1.5 * Math.PI / 10;
          const length = tick % 5 === 0 ? .14 : .075;
          box(.024, .005, length, x + Math.sin(angle) * .33, top + .024, z + Math.cos(angle) * .33, engraving, angle);
        }
        box(.026, .005, .27, x + .055, top + .029, z + .09, engraving, .55);
        cylinder(.037, .01, x, top + .029, z, engraving);
      });
      if (lighting) {
        // Appending these diagnostic lamps preserves the approved blockout's
        // entity IDs. Steel housings and flat diffuser faces add no glow or brass.
        for (let index = 0; index < 8; index++) {
          const angle = index * Math.PI / 4;
          const point = (radius: number) => ({
            x: Math.sin(angle) * radius + Math.cos(angle) * -.67,
            z: Math.cos(angle) * radius - Math.sin(angle) * -.67,
          });
          const base = point(2.7), arm = point(2.795), head = point(2.93);
          box(.26, .045, .22, base.x, 1.3175, base.z, "steel-0", angle);
          box(.045, .38, .045, base.x, 1.53, base.z, "steel-0", angle);
          box(.045, .045, .28, arm.x, 1.72, arm.z, "steel-0", angle);
          add(
            new THREE.BoxGeometry(.42, .24, .26).rotateX(Math.PI / 12).rotateY(angle).translate(head.x, 1.74, head.z),
            "steel-0",
            "lamp-head",
          );
          add(
            new THREE.BoxGeometry(.35, .17, .012).translate(0, 0, .136).rotateX(Math.PI / 12).rotateY(angle)
              .translate(head.x, 1.74, head.z),
            stationLit(index) ? "lamp-light-0" : "glass-0",
            "lamp-diffuser",
          );
        }
      }
      engine.setPalette(study.palette);
      engine.canvas.setAttribute(
        "aria-label",
        "Unapproved material study; fixed diagnostic proportions and synthetic brass instruments",
      );
      data.scene.updateMatrixWorld(true);
      return true;
    },
    catch: cause => new WorkbenchFailure({ operation: "tone-study", cause }),
  });
