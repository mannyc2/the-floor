import { Effect } from "effect";
import * as THREE from "three";
import { ProjectionGenerator } from "three-edge-projection/src/ProjectionGenerator.js";
import { validateConvexSilhouette } from "../../../testing/look/silhouettes";
import type { Point, Segment } from "../../../testing/look/silhouettes";
import type { Engine } from "../src/map/_lib/renderer/engine";
import { WorkbenchFailure } from "./runtime";
import { sceneDigest } from "./scene-evidence";

const sourceVersion = "0.0.10+3ac00e1d7bb87bf417ddbd93a5cc7c683a2d0567";

const projectPoint = (point: THREE.Vector3, camera: THREE.OrthographicCamera, width: number, height: number): Point => {
  point.project(camera);
  return { x: (point.x + 1) * width / 2, y: (1 - point.y) * height / 2 };
};

const projectMeshes = Effect.fn("Workbench.projectMeshes")(
  function*(meshes: ReadonlyArray<THREE.Mesh>, camera: THREE.OrthographicCamera, width: number) {
    const material = yield* Effect.acquireRelease(
      Effect.sync(() => new THREE.MeshBasicMaterial()),
      (owned) => Effect.sync(() => owned.dispose()),
    );
    const scene = new THREE.Scene();
    const transformed: Array<THREE.BufferGeometry> = [];
    yield* Effect.addFinalizer(() => Effect.sync(() => transformed.forEach((geometry) => geometry.dispose())));
    const view = new THREE.Matrix4().makeRotationX(-Math.PI / 2).multiply(camera.matrixWorldInverse);
    for (const mesh of meshes) {
      if (!mesh.visible || !mesh.layers.test(camera.layers)) continue;
      const originalGeometry: THREE.BufferGeometry = mesh.geometry;
      const count = mesh instanceof THREE.InstancedMesh ? mesh.count : 1;
      for (let index = 0; index < count; index += 1) {
        const instance = new THREE.Matrix4();
        if (mesh instanceof THREE.InstancedMesh) mesh.getMatrixAt(index, instance);
        const geometry = originalGeometry.clone().applyMatrix4(instance).applyMatrix4(mesh.matrixWorld).applyMatrix4(
          view,
        );
        transformed.push(geometry);
        scene.add(new THREE.Mesh(geometry, material));
      }
    }
    return yield* Effect.try({
      try: () => {
        const generator = new ProjectionGenerator();
        generator.angleThreshold = 35;
        generator.includeIntersectionEdges = true;
        const iterator = generator.generate(scene);
        let result = iterator.next();
        while (result.done !== true) result = iterator.next();
        const geometry = result.value.visibleEdges.getLineGeometry();
        transformed.push(geometry);
        const points = geometry.getAttribute("position"), scale = width / (camera.right - camera.left);
        const segments: Array<Segment> = [];
        for (let index = 0; index < points.count; index += 2) {
          segments.push({
            a: { x: (points.getX(index) - camera.left) * scale, y: (points.getZ(index) + camera.top) * scale },
            b: { x: (points.getX(index + 1) - camera.left) * scale, y: (points.getZ(index + 1) + camera.top) * scale },
          });
        }
        return segments;
      },
      catch: (cause) => new WorkbenchFailure({ operation: "cpu-edge-projection", cause }),
    });
  },
  Effect.scoped,
);

export const projectTargets = Effect.fn("Workbench.projectTargets")(function*(engine: Engine) {
  const data = engine.diagnosticScene(), info = engine.inspect();
  data.scene.updateMatrixWorld(true);
  const sourceSceneSha256 = yield* sceneDigest(engine);
  const segments = yield* projectMeshes(data.meshes, data.camera, info.width);
  const primitiveCases = yield* Effect.forEach(
    data.meshes.filter((mesh) =>
      ["synthetic-cylinder", "synthetic-primitive-box", "synthetic-primitive-sphere"].includes(mesh.name)
    ),
    Effect.fnUntraced(function*(mesh) {
      const vertices = mesh.geometry.getAttribute("position");
      const projected = Array.from({ length: vertices.count }, (_, index) =>
        projectPoint(
          new THREE.Vector3().fromBufferAttribute(vertices, index).applyMatrix4(mesh.matrixWorld),
          data.camera,
          info.width,
          info.height,
        ));
      const target = yield* projectMeshes([mesh], data.camera, info.width);
      const checked = yield* validateConvexSilhouette(projected, target);
      return { name: mesh.name, ...checked, projectedVertices: projected, targetSegments: target };
    }),
    { concurrency: 1 },
  );
  if (primitiveCases.length !== 3) {
    return yield* new WorkbenchFailure({
      operation: "primitive-evidence",
      cause: "Expected the cylinder, box and sphere",
    });
  }
  const cylinder = data.syntheticCylinder;
  const side = (y: number, reverse: boolean) =>
    Array.from({ length: 65 }, (_, index) => {
      const angle = -Math.PI / 4 + (reverse ? 64 - index : index) * Math.PI / 64;
      return projectPoint(
        new THREE.Vector3(
          cylinder.center.x + cylinder.radius * Math.cos(angle),
          y,
          cylinder.center.z + cylinder.radius * Math.sin(angle),
        ),
        data.camera,
        info.width,
        info.height,
      );
    });
  const region = [
    ...side(cylinder.center.y - cylinder.height / 4, false),
    ...side(cylinder.center.y + cylinder.height / 4, true),
  ];
  const silhouetteSampleCss = projectPoint(
    new THREE.Vector3(
      cylinder.center.x + cylinder.radius / Math.sqrt(2),
      cylinder.center.y,
      cylinder.center.z - cylinder.radius / Math.sqrt(2),
    ),
    data.camera,
    info.width,
    info.height,
  );
  return {
    sourceSceneSha256,
    generator: "three-edge-projection",
    generatorVersion: sourceVersion,
    width: info.width,
    height: info.height,
    segments,
    cylinderRegion: region,
    silhouetteSampleCss,
    regionSpecification:
      "Synthetic cylinder: camera-facing half of the side wall, middle half of its height; orthographic projection of 65 angular samples per horizontal boundary. The harness erodes two CSS pixels and excludes target lines.",
    camera: { projection: data.camera.projectionMatrix.toArray(), world: data.camera.matrixWorld.toArray() },
    primitiveCases,
  };
});
