import type { Design } from "@floor/contract";
import type { KitMaterial, KitPart, KitShape, Point3 } from "@floor/kit";
import { Option, Record, Result } from "effect";
import * as THREE from "three";
import { evaluateDriver } from "./drivers";

import {
  customAnimatedNodes,
  type DesignPrimitives,
  type DesignReadings,
  type DesignTrace,
  readingGeometry,
} from "./instruments";
export { calibrationGeometryReadings, designGeometryBudget } from "./instruments";
export type { DesignGeometryCost, DesignReading, DesignReadings, DesignTrace } from "./instruments";

export interface DesignGeometry extends DesignPrimitives {
  /** A reading-independent frame prevents theme animation from displacing protected instruments. */
  readonly frame: { readonly minimum: Point3; readonly maximum: Point3 };
}

interface Materials extends Readonly<Record<string, KitMaterial>> {}
interface Shapes extends Readonly<Record<string, KitShape>> {}
const material: Materials = {
  steel: "steel",
  glass: "frost",
  stone: "structure",
  brick: "rust",
  timber: "structure",
  "enamel-green": "water",
  enamel: "paper",
  paint: "paper",
  paper: "paper",
  water: "water",
};
const shape: Shapes = {
  cylinder: "cylinder",
  tank: "cylinder",
  pipe: "cylinder",
  column: "cylinder",
  ball: "sphere",
  wheel: "ring",
  roof: "cone",
  reeds: "cylinder",
};

function partExtent(part: KitPart): THREE.Box3 {
  const half = new THREE.Vector3(...part.size).multiplyScalar(0.5);
  const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(part.rotation ?? [0, 0, 0])));
  const matrix = new THREE.Matrix4().compose(new THREE.Vector3(...part.position), rotation, new THREE.Vector3(1, 1, 1));
  return new THREE.Box3(half.clone().negate(), half).applyMatrix4(matrix);
}

const point3 = (value: THREE.Vector3): Point3 => [value.x, value.y, value.z];

function referenceFrame(design: Design): THREE.Box3 {
  const frame = new THREE.Box3();
  for (const part of design.parts) frame.union(partExtent({ ...part, shape: "box", material: "structure" }));
  for (const binding of design.readings) {
    const part = design.parts.find(candidate => candidate.id === binding.partId);
    if (!part) continue;
    // This envelope reserves every possible instrument position, including an absent reading, without inventing data.
    frame.union(partExtent({
      shape: "box",
      material: "structure",
      position: [part.position[0], part.position[1], part.position[2] + part.size[2] / 2 + 0.35],
      size: [2.8, Math.max(2.8, Math.min(3, part.size[1]) + 0.6), 1],
    }));
    frame.expandByPoint(
      new THREE.Vector3(
        part.position[0],
        part.position[1] + part.size[1] / 2 + 0.3,
        part.position[2] + part.size[2] / 2 + 0.3,
      ),
    );
  }
  return frame;
}

function confinedPart(part: KitPart, frame: THREE.Box3): KitPart {
  const extent = partExtent(part), size = extent.getSize(new THREE.Vector3());
  const available = frame.getSize(new THREE.Vector3());
  const scale = Math.min(
    1,
    available.x / Math.max(size.x, 0.001),
    available.y / Math.max(size.y, 0.001),
    available.z / Math.max(size.z, 0.001),
  );
  const center = new THREE.Vector3(...part.position);
  const half = size.multiplyScalar(scale / 2);
  center.clamp(frame.min.clone().add(half), frame.max.clone().sub(half));
  return {
    ...part,
    position: point3(center),
    size: [part.size[0] * scale, part.size[1] * scale, part.size[2] * scale],
  };
}

function declaredPart(
  part: Design["parts"][number],
  design: Design,
  samples: Readonly<Record<string, number>>,
  seconds: number,
): KitPart {
  const position: [number, number, number] = [...part.position];
  const size: [number, number, number] = [...part.size];
  const rotation: [number, number, number] = [0, 0, 0];
  for (const driver of design.drivers.filter(candidate => candidate.partId === part.id)) {
    const result = evaluateDriver(driver.expression, samples, seconds);
    if (Result.isFailure(result)) continue;
    if (driver.property === "rotation") rotation[1] = result.success;
    if (driver.property === "sway") rotation[2] = result.success;
    if (driver.property === "height") position[1] += result.success;
    if (driver.property === "scale") {
      for (const dimension of [0, 1, 2] as const) size[dimension] *= Math.max(0, result.success);
    }
  }
  return {
    shape: shape[part.kit] ?? "box",
    material: material[part.material] ?? "structure",
    position,
    size,
    rotation,
  };
}

/** Gate previews, adopted machines and permanent plates construct the same parts and protected instruments. */
export function designGeometry(design: Design, readings: DesignReadings, seconds = 0): DesignGeometry {
  const nativeValues = Record.map(readings, reading => reading.value);
  const frame = referenceFrame(design);
  const parts: KitPart[] = design.parts.map(part =>
    confinedPart(declaredPart(part, design, nativeValues, seconds), frame)
  );
  const paths: (readonly Point3[])[] = [];
  const traces: DesignTrace[] = [];
  const labels: { readonly reading: string; readonly value: number; readonly position: Point3 }[] = [];
  let animatedNodes = customAnimatedNodes(design);
  for (const binding of design.readings) {
    const part = design.parts.find(candidate => candidate.id === binding.partId);
    const value = readings[binding.reading];
    // Missing observations are unmarked; zero is reserved for an actual measured zero.
    if (!part || !value || !Number.isFinite(value.value) || !Number.isFinite(value.fraction)) continue;
    labels.push({
      reading: binding.reading,
      value: value.value,
      position: [
        part.position[0],
        part.position[1] + part.size[1] / 2 + 0.3,
        part.position[2] + part.size[2] / 2 + 0.3,
      ],
    });
    const reading = readingGeometry(part, binding, value);
    parts.push(...reading.parts);
    paths.push(...reading.paths);
    traces.push(...reading.traces);
    animatedNodes += reading.animatedNodes;
  }
  return {
    parts,
    paths,
    traces,
    labels,
    animatedNodes,
    frame: { minimum: point3(frame.min), maximum: point3(frame.max) },
  };
}

/** Rotated parts, protected instruments and custom driver states stay inside the same declared physical footprint. */
export function fitDesignGeometry(
  geometry: DesignGeometry,
  bounds: Design["bounds"],
  origin: Point3 = [0, 0, 0],
): Option.Option<DesignGeometry> {
  const extent = new THREE.Box3(
    new THREE.Vector3(...geometry.frame.minimum),
    new THREE.Vector3(...geometry.frame.maximum),
  );
  for (const part of geometry.parts) {
    if (![...part.position, ...part.size, ...(part.rotation ?? [])].every(Number.isFinite)) return Option.none();
  }
  if (extent.isEmpty()) return Option.some(geometry);
  const size = extent.getSize(new THREE.Vector3()), center = extent.getCenter(new THREE.Vector3());
  if (![size.x, size.y, size.z, center.x, center.y, center.z].every(Number.isFinite)) return Option.none();
  const scale = Math.min(
    1,
    bounds.width / Math.max(size.x, 0.001),
    bounds.height / Math.max(size.y, 0.001),
    bounds.depth / Math.max(size.z, 0.001),
  );
  const point = (value: Point3): Point3 => [
    origin[0] + (value[0] - center.x) * scale,
    origin[1] + (value[1] - extent.min.y) * scale,
    origin[2] + (value[2] - center.z) * scale,
  ];
  return Option.some({
    animatedNodes: geometry.animatedNodes,
    frame: { minimum: point(geometry.frame.minimum), maximum: point(geometry.frame.maximum) },
    parts: geometry.parts.map(part => ({
      ...part,
      position: point(part.position),
      size: [part.size[0] * scale, part.size[1] * scale, part.size[2] * scale],
    })),
    paths: geometry.paths.map(path => path.map(point)),
    traces: geometry.traces.map(trace => ({ ...trace, position: point(trace.position), width: trace.width * scale })),
    labels: geometry.labels.map(label => ({ ...label, position: point(label.position) })),
  });
}
