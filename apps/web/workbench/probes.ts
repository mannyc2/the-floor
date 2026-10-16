// Workbench-only diagnostics. The production entry does not import this module.
import { Effect, Option } from "effect";
import * as THREE from "three";
import { MeshBVH } from "three-mesh-bvh";
import type { Engine } from "./renderer-probe";
import { WorkbenchFailure } from "./runtime";

const probes = new WeakMap<Engine, ReturnType<typeof createDiagnostics>>();
export const diagnostics = (engine: Engine) => {
  const existing = probes.get(engine);
  if (existing) return existing;
  const value = createDiagnostics(engine);
  probes.set(engine, value);
  return value;
};
const createDiagnostics = (engine: Engine) => {
  const data = engine.diagnosticScene();
  // BVH construction can rewrite indices. Clone so the independent oracle never
  // changes geometry submitted by the production renderer.
  const clones = data.geometries.map(geometry => ({ original: geometry, clone: geometry.clone() }));
  const trees = new Map(clones.map(pair => [pair.original, new MeshBVH(pair.clone)]));
  engine.onDispose(() => clones.forEach(pair => pair.clone.dispose()));
  const objects = data.entities.map(entity => {
    const matrix = entity.mesh.matrixWorld.clone();
    if (entity.mesh instanceof THREE.InstancedMesh && Option.isSome(entity.maybeInstance)) {
      const instance = new THREE.Matrix4();
      entity.mesh.getMatrixAt(entity.maybeInstance.value, instance);
      matrix.multiply(instance);
    }
    return {
      id: entity.id,
      mesh: entity.mesh,
      inverse: matrix.clone().invert(),
      matrix,
      bounds: (entity.mesh.geometry.boundingBox?.clone() ?? new THREE.Box3()).applyMatrix4(matrix),
      tree: trees.get(entity.mesh.geometry),
    };
  });
  const raycaster = new THREE.Raycaster(), localRay = new THREE.Ray(), hitPoint = new THREE.Vector3();
  const oracle = (x: number, y: number, snap = true) => {
    const info = engine.inspect();
    const sampleX = snap ? (Math.floor(x * info.dpr) + .5) / info.dpr : x;
    const sampleY = snap ? (Math.floor(y * info.dpr) + .5) / info.dpr : y;
    raycaster.setFromCamera(
      new THREE.Vector2(sampleX / info.width * 2 - 1, 1 - sampleY / info.height * 2),
      data.camera,
    );
    const ray = raycaster.ray, closest = { distance: Infinity, id: 0 };
    objects.forEach(object => {
      if (
        !object.mesh.visible || !object.mesh.layers.test(data.camera.layers) || !object.tree
        || !ray.intersectsBox(object.bounds)
      ) return;
      localRay.copy(ray).applyMatrix4(object.inverse);
      const hit = object.tree.raycastFirst(localRay, THREE.FrontSide);
      if (hit) {
        hitPoint.copy(hit.point).applyMatrix4(object.matrix);
        const distance = ray.origin.distanceTo(hitPoint);
        if (distance < closest.distance) {
          closest.distance = distance;
          closest.id = object.id;
        }
      }
    });
    return closest.id;
  };
  const line = Effect.fn("Workbench.lineProfile")(function*() {
    const info = engine.inspect(), bytes = engine.frameBytes();
    // The dense 1000-desk field occludes the central cylinder. Measure an
    // existing exposed vertical leg on its frontmost desk instead; no
    // geometry is moved, hidden or added for this measurement.
    const sample = info.desks === 1000 ? "frontmost-desk-front-right-leg" : "synthetic-cylinder";
    const point = info.desks === 1000
      ? engine.project(-23.8 + 1.06, .65, 43.2 + .64)
      : engine.project(-3.5 + .52 / Math.sqrt(2), 1.15, -3.5 - .52 / Math.sqrt(2));
    const width = engine.canvas.width, height = engine.canvas.height;
    const center = Math.round(point.x * info.dpr), y = Math.floor(point.y * info.dpr);
    const scan = Array.from({ length: 12 * info.dpr + 1 }, (_, i) => {
      const x = center - 6 * info.dpr + i, offset = ((height - 1 - y) * width + x) * 4;
      return { x, dark: (bytes[offset] ?? 255) < 128 };
    });
    const runs: Array<{ start: number; end: number }> = [];
    scan.forEach((pixel, i) => {
      if (!pixel.dark) return;
      if (scan[i - 1]?.dark !== true) runs.push({ start: pixel.x, end: pixel.x });
      else {
        const last = runs.at(-1);
        if (last) last.end = pixel.x;
      }
    });
    const nearest = Option.fromUndefinedOr(
      runs.toSorted((a, b) => Math.abs((a.start + a.end) / 2 - center) - Math.abs((b.start + b.end) / 2 - center))[0],
    );
    if (Option.isNone(nearest)) {
      return yield* new WorkbenchFailure({ operation: "line-profile", cause: `No thresholded edge at ${sample}` });
    }
    const measured = nearest.value;
    return {
      sample,
      point,
      center,
      y,
      runs,
      widthCssPx: (measured.end - measured.start + 1) / info.dpr,
      centerDistanceCssPx: Math.abs((measured.start + measured.end + 1) / 2 - point.x * info.dpr) / info.dpr,
    };
  });
  const picking = (count: number) => {
    const random = { seed: 20261012 };
    const next = () => {
      random.seed = (Math.imul(random.seed, 1664525) + 1013904223) >>> 0;
      return random.seed / 2 ** 32;
    };
    const info = engine.inspect();
    const pixels = engine.frameBytes();
    const results = Array.from({ length: count }, () => {
      const x = next() * info.width, y = next() * info.height;
      const actual = engine.pick(x, y), expected = oracle(x, y);
      const offset =
        ((engine.canvas.height - 1 - Math.floor(y * info.dpr)) * engine.canvas.width + Math.floor(x * info.dpr)) * 4;
      const isLine = (pixels[offset] ?? 255) < 128;
      if (actual === expected) return { match: true, nonzero: actual > 0, isLine };
      const cx = (Math.floor(x * info.dpr) + .5) / info.dpr, cy = (Math.floor(y * info.dpr) + .5) / info.dpr;
      const witnesses = [-.49, 0, .49].flatMap(dx =>
        [-.49, 0, .49].map(dy => ({ dx, dy, id: oracle(cx + dx / info.dpr, cy + dy / info.dpr, false) }))
      );
      return {
        match: false,
        nonzero: actual > 0,
        isLine,
        mismatch: {
          x,
          y,
          actual,
          expected,
          classification: witnesses.some(point => point.id === actual)
            ? "subpixel-rasterization-boundary"
            : "unexplained",
          witnesses,
        },
      };
    });
    return {
      seed: 20261012,
      count,
      dpr: info.dpr,
      nonzero: results.filter(row => row.nonzero).length,
      lineSamples: results.filter(row => row.isLine).length,
      matches: results.filter(row => row.match).length,
      mismatches: results.flatMap(row => row.mismatch ? [row.mismatch] : []),
    };
  };
  return { oracle, line, picking };
};
