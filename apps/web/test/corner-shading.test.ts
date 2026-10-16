import { shading } from "@floor/atlas/look";
import { materialPalette, PaletteName, proportionPalette } from "@floor/atlas/materials";
import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import * as THREE from "three";
import { Rotation } from "../src/map/model";
import { cornerCamera, inspectGeneratedAssets } from "../workbench/_lib/asset-corners";
import { inspectAssetRules, sideAt } from "../workbench/_lib/asset-rules";
import { effectTest } from "./_runtime";

type Point = readonly [number, number, number];
type Cone = readonly [Point, Point, Point];
const cases: ReadonlyArray<{ readonly name: string; readonly normals: Cone }> = [
  { name: "opposite light sectors crossing a dark sector", normals: [[.2, .1, 1], [.2, .1, -1], [.3, .2, .8]] },
  { name: "opposite dark sectors crossing a light sector", normals: [[1, .1, .2], [-1, .1, .2], [.8, .2, .3]] },
  { name: "cone surrounding the vertical axis", normals: [[1, .05, 0], [-.5, .05, .9], [-.5, .05, -.9]] },
  { name: "near the positive diagonal", normals: [[.95, .2, 1], [1, .2, .95], [1, .3, 1]] },
  { name: "negative diagonal ties", normals: [[-1, .1, -1], [-1, .2, -1], [-1, .05, -1]] },
  { name: "diagonal tolerance crossings", normals: [[1, .1, 1.00009], [1, .1, .9998], [1, .2, 1.0002]] },
  { name: "top and underside transitions", normals: [[1, .8, .2], [.3, -.7, 1], [-.8, .1, -.2]] },
  { name: "top normals above opposite horizontal directions", normals: [[1, 2, 0], [-1, 2, 0], [0, 2, 1]] },
];

const withAttributes = (geometry: THREE.BufferGeometry, material: PaletteName) => {
  const count = geometry.getAttribute("position").count;
  const fill = (value: number) => new THREE.Float32BufferAttribute(new Float32Array(count).fill(value), 1);
  geometry.setAttribute("_MAT", fill(PaletteName.literals.indexOf(material)));
  geometry.setAttribute("_SURFACE", fill(1));
  geometry.setAttribute("_LIGHT", fill(0));
  return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
};
const dispose = (mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>) => {
  mesh.geometry.dispose();
  mesh.material.dispose();
};

// A front-facing floor triangle supplies three independently authored normals.
// No vertex-normal culling may hide bands on this geometrically visible face.
const triangle = (normals: ReadonlyArray<THREE.Vector3>) => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 1, 1, 0, 0], 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals.flatMap(normal => normal.toArray()), 3));
  return withAttributes(geometry, "steel-0");
};

// Sample the normal triangle barycentrically instead of using the rules'
// vertex bound. The view-space conversion independently checks the camera
// basis; the oracle then applies the documented four-band rule directly.
const sampledTones = (normals: readonly [THREE.Vector3, THREE.Vector3, THREE.Vector3], camera: THREE.Camera) => {
  const tones = new Set<PaletteName>();
  for (let first = 0; first <= 48; first++) {
    for (let second = 0; second <= 48 - first; second++) {
      const a = first / 48, b = second / 48, c = 1 - a - b;
      const unit = normals[0].clone().multiplyScalar(a)
        .addScaledVector(normals[1], b)
        .addScaledVector(normals[2], c);
      if (unit.length() < 1e-12) continue;
      unit.normalize();
      const side = -unit.clone().transformDirection(camera.matrixWorldInverse).x;
      tones.add(
        unit.y > shading.verticalThreshold
          ? "steel-3"
          : unit.y < -shading.verticalThreshold
          ? "steel-0"
          : side >= shading.sideTolerance
          ? "steel-2"
          : "steel-1",
      );
    }
  }
  return tones;
};

describe("camera-relative side tones", () => {
  for (const rotation of Rotation.literals) {
    test(`side values are the negated view-space x at corner ${rotation}`, () => {
      const camera = cornerCamera(rotation);
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
      for (const { normals } of cases) {
        for (const point of normals) {
          const normal = new THREE.Vector3(...point).normalize();
          expect(sideAt(normal, right)).toBeCloseTo(
            -normal.clone().transformDirection(camera.matrixWorldInverse).x,
            12,
          );
        }
      }
    });

    test(`a box shows its top, one dark side and one light side at corner ${rotation}`, () => {
      const indexed = new THREE.BoxGeometry();
      const mesh = withAttributes(indexed.toNonIndexed(), "timber-0");
      indexed.dispose();
      for (const theme of ["day", "night"] satisfies ReadonlyArray<"day" | "night">) {
        const report = inspectAssetRules({
          object: mesh,
          camera: cornerCamera(rotation),
          palette: materialPalette,
          theme,
        });
        expect(report.faces.map(face => face.tone).toSorted()).toEqual(["timber-1", "timber-2", "timber-3"]);
        expect(report.checks.find(check => check.rule === "body-tone-range")?.status).toBe("Passed");
      }
      dispose(mesh);
    });

    for (const { name, normals: points } of cases) {
      test(`corner ${rotation} conservatively covers ${name}`, () => {
        const normals: [THREE.Vector3, THREE.Vector3, THREE.Vector3] = [
          new THREE.Vector3(...points[0]).normalize(),
          new THREE.Vector3(...points[1]).normalize(),
          new THREE.Vector3(...points[2]).normalize(),
        ];
        const mesh = triangle(normals);
        const camera = cornerCamera(rotation);
        const report = inspectAssetRules({ object: mesh, camera, palette: proportionPalette, theme: "day" });
        const observed = new Set(report.faces.map(face => face.tone));
        const stored = mesh.geometry.getAttribute("normal");
        const sampled = sampledTones(
          [
            new THREE.Vector3().fromBufferAttribute(stored, 0).normalize(),
            new THREE.Vector3().fromBufferAttribute(stored, 1).normalize(),
            new THREE.Vector3().fromBufferAttribute(stored, 2).normalize(),
          ],
          camera,
        );
        expect(sampled.size).toBeGreaterThan(0);
        expect([...sampled].filter(tone => !observed.has(tone))).toEqual([]);
        dispose(mesh);
      });
    }
  }

  effectTest(
    "the generated post and stations pass every measured rule at all four corners by day and night",
    () =>
      Effect.gen(function*() {
        const reports = yield* inspectGeneratedAssets;
        expect(reports).toHaveLength(Rotation.literals.length * 3 * 2);
        for (const { report } of reports) {
          expect(report.checks.filter(check => check.status === "Failed")).toEqual([]);
          expect(report.checks.find(check => check.rule === "body-tone-range")?.status).toBe("Passed");
        }
      }),
  );
});
