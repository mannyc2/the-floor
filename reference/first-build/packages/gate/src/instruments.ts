import type { Design } from "@floor/contract";
import type { KitPart, Point3 } from "@floor/kit";
import { Option, Record } from "effect";

export interface DesignReading {
  /** The native observed value is kept separate from its bounded visual projection. */
  readonly value: number;
  readonly fraction: number;
  readonly history?: readonly { readonly timestamp: number; readonly price: number }[];
  readonly bands?: readonly { readonly lower: number; readonly upper: number; readonly liquidity: number }[];
  readonly quote?: number;
}
export type DesignReadings = Readonly<Record<string, DesignReading>>;
export interface DesignTrace {
  readonly reading: string;
  readonly fromTimestamp: number;
  readonly toTimestamp: number;
  /** Receipt marks use this baseline below the trace, so they never imply an interpolated execution price. */
  readonly position: Point3;
  readonly width: number;
}
export interface DesignPrimitives {
  readonly parts: readonly KitPart[];
  readonly paths: readonly (readonly Point3[])[];
  readonly traces: readonly DesignTrace[];
  readonly labels: readonly { readonly reading: string; readonly value: number; readonly position: Point3 }[];
  readonly animatedNodes: number;
}
export interface DesignGeometryCost {
  readonly parts: number;
  readonly animatedNodes: number;
}

function instrument(part: Design["parts"][number], kind: string, fraction: number): readonly KitPart[] {
  const x = part.position[0], y = part.position[1], z = part.position[2] + part.size[2] / 2 + 0.25;
  const height = Math.max(1.2, Math.min(3, part.size[1]));
  const bottom = y - height / 2;
  const front: Point3 = [x, y, z];
  if (["arc", "utilization-dial", "weight-scale"].includes(kind)) {
    return [
      { shape: "ring", material: "brass", position: front, size: [1.7, 1.7, 0.7] },
      {
        shape: "box",
        material: "brass",
        position: [x, y + 0.3, z + 0.09],
        size: [0.11, 1.05, 0.13],
        rotation: [0, 0, Math.PI * (0.75 - fraction * 1.5)],
      },
    ];
  }
  if (["tray-rack", "tide-gauge"].includes(kind)) {
    return Array.from(
      { length: 6 },
      (_, index): KitPart => ({
        shape: "box",
        material: "brass",
        position: [x, bottom + height * index / 5, z],
        size: [index / 5 <= fraction ? 1 : 0.5, 0.07, 0.16],
      }),
    );
  }
  if (["pour", "freight", "pump", "trapdoor"].includes(kind)) {
    return [
      { shape: "box", material: "steel", position: front, size: [1.5, 0.15, 0.2] },
      {
        shape: "sphere",
        material: "brass",
        position: [x - 0.65 + fraction * 1.3, y + 0.22, z],
        size: [0.35, 0.35, 0.35],
      },
    ];
  }
  return [
    { shape: "box", material: "steel", position: front, size: [0.18, height, 0.16] },
    { shape: "box", material: "brass", position: [x, bottom + fraction * height, z + 0.12], size: [0.8, 0.12, 0.15] },
    ...Array.from(
      { length: 6 },
      (_, index): KitPart => ({
        shape: "box",
        material: "brass",
        position: [x + 0.23, bottom + height * index / 5, z + 0.1],
        size: [0.3, 0.06, 0.12],
      }),
    ),
  ];
}

function observedHistory(part: Design["parts"][number], reading: string, value: DesignReading): DesignPrimitives {
  const history = value.history?.filter(point => Number.isFinite(point.timestamp) && Number.isFinite(point.price))
    .toSorted((a, b) => a.timestamp - b.timestamp).slice(-32) ?? [];
  const first = history[0], last = history.at(-1);
  if (!first || !last || history.length < 2) return { parts: [], paths: [], traces: [], labels: [], animatedNodes: 0 };
  const width = Math.max(1.2, Math.min(2, part.size[0]));
  const height = Math.max(1.2, Math.min(3, part.size[1]));
  const x = part.position[0] - width / 2, y = part.position[1] - height / 2;
  const z = part.position[2] + part.size[2] / 2 + 0.3;
  const prices = history.map(point => point.price);
  const low = Math.min(...prices), high = Math.max(...prices), span = last.timestamp - first.timestamp;
  const path: Point3[] = history.map(point => [
    x + (span > 0 ? (point.timestamp - first.timestamp) / span : 0.5) * width,
    y + (high > low ? (point.price - low) / (high - low) : 0.5) * height,
    z + 0.05,
  ]);
  const endpoint = path.at(-1);
  const parts: KitPart[] = [{
    shape: "box",
    material: "paper",
    position: [x + width / 2, y + height / 2, z],
    size: [width + 0.15, height + 0.25, 0.07],
  }];
  if (endpoint) parts.push({ shape: "sphere", material: "brass", position: endpoint, size: [0.12, 0.12, 0.12] });
  return {
    parts,
    paths: [path],
    traces: [{
      reading,
      fromTimestamp: first.timestamp,
      toTimestamp: last.timestamp,
      position: [x, y - 0.14, z + 0.07],
      width,
    }],
    labels: [],
    animatedNodes: 2,
  };
}

function observedBands(part: Design["parts"][number], value: DesignReading): readonly KitPart[] {
  const bands = value.bands?.filter(band => Number.isFinite(band.liquidity) && band.liquidity >= 0).slice(0, 7) ?? [];
  if (bands.length === 0) return [];
  const height = Math.max(1.2, Math.min(3, part.size[1]));
  const maximum = Math.max(1, ...bands.map(band => band.liquidity));
  const x = part.position[0], y = part.position[1] - height / 2, z = part.position[2] + part.size[2] / 2 + 0.3;
  return bands.flatMap((band, index): readonly KitPart[] => {
    const row = y + (bands.length === 1 ? 0.5 : index / (bands.length - 1)) * height;
    const width = band.liquidity / maximum * 1.5;
    const parts: KitPart[] = [{ shape: "box", material: "steel", position: [x, row, z], size: [1.5, 0.04, 0.1] }];
    if (width > 0) {
      parts.push({
        shape: "box",
        material: "brass",
        position: [x - 0.75 + width / 2, row + 0.055, z],
        size: [width, 0.06, 0.13],
      });
    }
    if (Option.exists(Option.fromUndefinedOr(value.quote), quote => quote >= band.lower && quote <= band.upper)) {
      parts.push({ shape: "sphere", material: "brass", position: [x + 0.95, row, z], size: [0.13, 0.13, 0.13] });
    }
    return parts;
  });
}

export function readingGeometry(
  part: Design["parts"][number],
  binding: Design["readings"][number],
  value: DesignReading,
): DesignPrimitives {
  if (binding.instrument === "tide-gauge" && value.history) return observedHistory(part, binding.reading, value);
  if (binding.instrument === "tray-rack" && value.bands) {
    const parts = observedBands(part, value);
    return {
      parts,
      paths: [],
      traces: [],
      labels: [],
      animatedNodes: parts.filter(item => item.material === "brass").length,
    };
  }
  return {
    parts: instrument(part, binding.instrument, Math.max(0, Math.min(1, value.fraction))),
    paths: [],
    traces: [],
    labels: [],
    animatedNodes: ["tray-rack", "tide-gauge"].includes(binding.instrument) ? 6 : 1,
  };
}

export const customAnimatedNodes = (design: Design): number =>
  new Set([...design.drivers.map(driver => driver.partId), ...design.behaviours.map(behaviour => behaviour.partId)])
    .size;

/** Reserve the largest generated instrument state before acceptance, including bounded native histories and band racks. */
export function designGeometryBudget(design: Design): DesignGeometryCost {
  let parts = design.parts.length, animatedNodes = customAnimatedNodes(design);
  for (const binding of design.readings) {
    const part = design.parts.find(candidate => candidate.id === binding.partId);
    if (!part) continue;
    const sample = calibrationGeometryReadings({ [binding.reading]: 0.5 })[binding.reading];
    if (!sample) continue;
    const maximal = readingGeometry(
      part,
      binding,
      binding.reading === "liquidityBands"
        ? {
          ...sample,
          quote: 0.5,
          bands: Array.from({ length: 7 }, () => ({ lower: 0, upper: 1, liquidity: 1 })),
        }
        : sample,
    );
    const withoutHistory = binding.reading === "price" && binding.instrument === "tide-gauge"
      ? readingGeometry(part, binding, { value: 0.5, fraction: 0.5 })
      : maximal;
    parts += Math.max(
      maximal.parts.length + maximal.paths.length,
      withoutHistory.parts.length + withoutHistory.paths.length,
    );
    animatedNodes += Math.max(maximal.animatedNodes, withoutHistory.animatedNodes);
  }
  return { parts, animatedNodes };
}

/** Synthetic calibration is explicit at the gate boundary, never used by the live market adapter. */
export const calibrationGeometryReadings = (samples: Readonly<Record<string, number>>): DesignReadings =>
  Record.map(samples, (value, name) => {
    const reading = { value, fraction: value };
    if (name === "history" || name === "price") {
      return {
        ...reading,
        history: [{ timestamp: 0, price: 0 }, { timestamp: 1, price: 1 }, { timestamp: 2, price: value }],
      };
    }
    if (name === "liquidityBands") {
      return {
        ...reading,
        quote: value,
        bands: Array.from(
          { length: 7 },
          (_, index) => ({ lower: index / 7, upper: (index + 1) / 7, liquidity: value / 7 }),
        ),
      };
    }
    return reading;
  });
