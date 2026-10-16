import { materialPalette, PaletteName, proportionPalette } from "@floor/atlas/materials";
import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { assetFaceStyle, contrast, inspectAssetRules } from "../workbench/_lib/asset-rules";

const cameraAt = (height = 28.867513) => {
  const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, .1, 1000);
  camera.position.set(35.355339, height, 35.355339);
  camera.lookAt(0, 0, 0);
  return camera;
};
const box = (material: PaletteName) => {
  const indexed = new THREE.BoxGeometry();
  const geometry = indexed.toNonIndexed();
  indexed.dispose();
  const count = geometry.getAttribute("position").count;
  geometry.setAttribute(
    "_MAT",
    new THREE.Float32BufferAttribute(new Float32Array(count).fill(PaletteName.literals.indexOf(material)), 1),
  );
  geometry.setAttribute("_SURFACE", new THREE.Float32BufferAttribute(new Float32Array(count).fill(1), 1));
  geometry.setAttribute("_LIGHT", new THREE.Float32BufferAttribute(new Float32Array(count), 1));
  return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
};
const dispose = (mesh: ReturnType<typeof box>) => {
  mesh.geometry.dispose();
  mesh.material.dispose();
};

describe("asset rules before rendering", () => {
  test("a hidden timber underside is excluded, and exposing it fails contrast", () => {
    const mesh = box("timber-0");
    const above = inspectAssetRules({ object: mesh, camera: cameraAt(), palette: materialPalette, theme: "day" });
    expect(above.faces.some(face => face.tone === "timber-0")).toBe(false);
    expect(above.checks.filter(check => check.status === "Failed")).toEqual([]);
    const below = inspectAssetRules({
      object: mesh,
      camera: cameraAt(-28.867513),
      palette: materialPalette,
      theme: "day",
    });
    expect(below.faces.some(face => face.tone === "timber-0")).toBe(true);
    expect(below.checks.find(check => check.rule === "visible-face-line-contrast")?.status).toBe("Failed");
    dispose(mesh);
  });

  test("normal-cone checks include a downward band on a front-facing curved face", () => {
    const mesh = box("steel-0");
    const normal = mesh.geometry.getAttribute("normal");
    // This front-facing face has a low normal on one corner. Its actual
    // geometric winding remains visible, so discarding back-facing vertex
    // normals would incorrectly exempt a possible interpolated dark band.
    normal.setXYZ(0, 1, -2, 0);
    const before = inspectAssetRules({ object: mesh, camera: cameraAt(), palette: materialPalette, theme: "day" });
    expect(before.checks.find(check => check.rule === "visible-face-line-contrast")?.status).toBe("Failed");
    const corrected = inspectAssetRules({ object: mesh, camera: cameraAt(), palette: proportionPalette, theme: "day" });
    expect(corrected.checks.find(check => check.rule === "visible-face-line-contrast")?.status).toBe("Passed");
    dispose(mesh);
  });

  test("the shared night light mapping uses its face-local dark stroke", () => {
    const mesh = box("glass-0");
    const light = mesh.geometry.getAttribute("_LIGHT");
    for (let index = 0; index < light.count; index++) light.setX(index, 1);
    const report = inspectAssetRules({ object: mesh, camera: cameraAt(), palette: proportionPalette, theme: "night" });
    expect(report.faces.every(face => face.material === "screen-light-0" && face.lineContrast >= 3)).toBe(true);
    expect(report.checks.find(check => check.rule === "brass-bindings-and-scales")?.status).toBe("NotExercised");
    expect(contrast(proportionPalette.colors["brass-3"].night, proportionPalette.colors["screen-light-0"].night))
      .toBeLessThan(1.5);
    expect(assetFaceStyle(-1, 0, "day")._tag).toBe("None");
    expect(assetFaceStyle(-1, 1, "night")._tag).toBe("None");
    dispose(mesh);
  });

  test("brass cannot pass without instrument binding and mounting evidence", () => {
    const mesh = box("brass-0");
    const report = inspectAssetRules({ object: mesh, camera: cameraAt(), palette: proportionPalette, theme: "day" });
    expect(report.checks.find(check => check.rule === "brass-bindings-and-scales")?.status).toBe("Failed");
    dispose(mesh);
  });

  test("interpolated authoring attributes reject geometry rather than inventing an identity", () => {
    const mesh = box("steel-0");
    mesh.geometry.getAttribute("_SURFACE").setX(0, 2);
    const report = inspectAssetRules({ object: mesh, camera: cameraAt(), palette: proportionPalette, theme: "day" });
    expect(report.checks.find(check => check.rule === "geometry-attributes")?.status).toBe("Failed");
    dispose(mesh);
  });

  test("an empty scene supplies no geometry or contrast evidence", () => {
    const report = inspectAssetRules({
      object: new THREE.Group(),
      camera: cameraAt(),
      palette: proportionPalette,
      theme: "day",
    });
    expect(report.faces).toEqual([]);
    expect(report.checks.find(check => check.rule === "geometry-attributes")?.status).toBe("Unmeasured");
    expect(report.checks.find(check => check.rule === "visible-face-line-contrast")?.status).toBe("Unmeasured");
  });

  test("changing the camera or culling cannot reuse a matched-view preflight", () => {
    const mesh = box("timber-0");
    const camera = cameraAt();
    camera.position.x = 12;
    camera.lookAt(0, 0, 0);
    const wrongCamera = inspectAssetRules({ object: mesh, camera, palette: proportionPalette, theme: "day" });
    expect(wrongCamera.checks.find(check => check.rule === "orthographic-isometric-camera")?.status).toBe("Failed");
    mesh.material.side = THREE.DoubleSide;
    const wrongCull = inspectAssetRules({ object: mesh, camera: cameraAt(), palette: proportionPalette, theme: "day" });
    expect(wrongCull.checks.find(check => check.rule === "geometry-attributes")?.status).toBe("Failed");
    dispose(mesh);
  });
});
