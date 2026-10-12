import type { AdoptedDesign, Design, Emblem, PublicAgent, PublicReceipt } from "@floor/contract";
import type { MarketSlot, MarketTier } from "@floor/districts";
import type { FitContext } from "@floor/gate";
import type { KitMaterial, KitPart, KitShape, Point3 } from "@floor/kit";
import { DateTime, Match, Option, Order } from "effect";
import { adoptedMachineGeometry } from "./adopted";
import { eligibleEvidence } from "./evidence";
import type { AtlasEvidence, AtlasLens, AtlasMarket } from "./types";
import { type LayoutWindow, visibleIn } from "./visibility";

export interface MarketPosition {
  readonly market: AtlasMarket;
  readonly x: number;
  readonly z: number;
  readonly height: number;
  readonly radius: number;
  readonly tier: "tower" | "works" | "stall";
}
export interface WorldLabel {
  readonly id: string;
  readonly text: string;
  readonly kind: "island" | "district" | "market" | "landmark";
  readonly position: Point3;
  readonly minZoom: number;
  readonly maxZoom: number;
  readonly priority: number;
  readonly subtitle?: string;
}
export interface AtlasLayout {
  readonly parts: readonly KitPart[];
  readonly markets: readonly MarketPosition[];
  readonly labels: readonly WorldLabel[];
  readonly paths: readonly (readonly Point3[])[];
  readonly activeId: Option.Option<string>;
  readonly radius: number;
  readonly agentPlacements: readonly AgentPlacement[];
  readonly receiptStamps: readonly ReceiptStamp[];
  readonly stallSpans: readonly StallSpan[];
  readonly marketSpans: readonly StallSpan[];
  readonly marketDrawings: readonly MarketDrawing[];
  readonly drawingOptions: DrawingOptions;
  readonly labelOptions: LabelOptions;
  readonly staticPaths: readonly (readonly Point3[])[];
  readonly window: Option.Option<LayoutWindow>;
}
export interface StallSpan {
  readonly marketId: string;
  readonly start: number;
  readonly count: number;
}
export interface AgentPlacement {
  readonly agent: PublicAgent;
  readonly marketId: Option.Option<string>;
  readonly position: Point3;
}
export interface ReceiptStamp {
  readonly receipt: PublicReceipt;
  readonly agent: PublicAgent;
  readonly position: Point3;
}
export type MarketDetail = "hidden" | "stall" | "silhouette" | "instrument";
export interface DrawingOptions {
  readonly explodedId: Option.Option<string>;
  readonly confirmed: readonly { readonly receipt: PublicReceipt; readonly agent: PublicAgent }[];
  readonly adoptedDesigns: readonly AdoptedDesign[];
  readonly seconds?: number;
}
export interface MarketDrawing {
  readonly marketId: string;
  readonly detail: MarketDetail;
  readonly parts: readonly KitPart[];
  readonly paths: readonly (readonly Point3[])[];
  readonly receiptStamps: readonly ReceiptStamp[];
}
export interface LabelOptions {
  readonly lens: AtlasLens;
  readonly moorings: ReadonlySet<string>;
  readonly attention: ReadonlyMap<string, number>;
  readonly explodedId: Option.Option<string>;
}

/** Submission, adoption and rendering share current footprints; the technical design permits no custom stall parts. */
export const designFit = (
  design: Design,
  marketId: string,
  markets: readonly MarketPosition[],
): Option.Option<FitContext> =>
  Option.map(Option.fromUndefinedOr(markets.find(item => item.market.id === marketId)), site => ({
    plinthAvailable: site.market.kind === design.kind && site.tier === design.tier && site.tier !== "stall",
    maxWidth: site.radius * 2,
    maxDepth: site.radius * 2,
    overlapsMachine: markets.some(other =>
      other.market.id !== marketId
      && Math.abs(other.x - site.x) < other.radius + design.bounds.width / 2
      && Math.abs(other.z - site.z) < other.radius + design.bounds.depth / 2
    ),
  }));

class Builder {
  readonly parts: KitPart[] = [];
  readonly paths: Point3[][] = [];
  readonly receiptStamps: ReceiptStamp[] = [];
  part(shape: KitShape, material: KitMaterial, at: Point3, size: Point3, detail = 0, rotation?: Point3): void {
    const part = { shape, material, position: at, size, detail };
    this.parts.push(rotation ? { ...part, rotation } : part);
  }
  box(at: Point3, size: Point3, material: KitMaterial = "structure", detail = 0): void {
    this.part("box", material, at, size, detail);
  }
  cylinder(at: Point3, size: Point3, material: KitMaterial = "structure", detail = 0): void {
    this.part("cylinder", material, at, size, detail);
  }
  beam(from: Point3, to: Point3, thickness = 0.12, material: KitMaterial = "steel", detail = 1): void {
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const dz = to[2] - from[2];
    const length = Math.hypot(dx, dy, dz);
    this.part(
      "cylinder",
      material,
      [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2],
      [thickness, length, thickness],
      detail,
      [Math.atan2(dz, Math.hypot(dx, dy)), 0, -Math.atan2(dx, dy)],
    );
  }
  path(points: readonly Point3[]): void {
    this.paths.push([...points]);
  }
  ticks(x: number, y: number, z: number, height: number, detail = 2): void {
    for (let tick = 0; tick <= 10; tick++) {
      const tickY = y + height * tick / 10;
      this.path([[x, tickY, z], [x + (tick % 5 === 0 ? 0.45 : 0.24), tickY, z]]);
    }
    this.box([x - 0.06, y + height / 2, z + 0.04], [0.16, height, 0.12], "steel", detail);
  }
}

const polygon = (count: number, phase = Math.PI / 2, star = false): readonly (readonly [number, number])[] =>
  Array.from({ length: count + 1 }, (_, index): readonly [number, number] => {
    const radius = star && index % 2 === 1 ? 0.42 : 1;
    const angle = phase + index * Math.PI * 2 / count;
    return [Math.cos(angle) * radius, Math.sin(angle) * radius];
  });
function emblem(b: Builder, identity: Emblem, at: Point3, size: number): void {
  const cross: readonly (readonly [number, number])[] = [
    [-0.3, 1],
    [0.3, 1],
    [0.3, 0.3],
    [1, 0.3],
    [1, -0.3],
    [0.3, -0.3],
    [0.3, -1],
    [-0.3, -1],
    [-0.3, -0.3],
    [-1, -0.3],
    [-1, 0.3],
    [-0.3, 0.3],
    [-0.3, 1],
  ];
  const crescent = [
    ...Array.from({ length: 13 }, (_, index): readonly [number, number] => {
      const angle = Math.PI / 2 + index * Math.PI / 12;
      return [Math.cos(angle), Math.sin(angle)];
    }),
    ...Array.from({ length: 13 }, (_, index): readonly [number, number] => {
      const angle = Math.PI * 1.5 - index * Math.PI / 12;
      return [0.45 + Math.cos(angle) * 0.45, Math.sin(angle)];
    }),
  ];
  const outline = Match.value(identity.shape).pipe(
    Match.when("circle", () => polygon(16)),
    Match.when("triangle", () => polygon(3)),
    Match.when("square", () => polygon(4, Math.PI / 4)),
    Match.when("diamond", () => polygon(4)),
    Match.when("hexagon", () => polygon(6)),
    Match.when("star", () => polygon(10, Math.PI / 2, true)),
    Match.when("cross", () => cross),
    Match.when("crescent", () => crescent),
    Match.exhaustive,
  );
  const point = ([x, y]: readonly [number, number]): Point3 => [at[0] + x * size, at[1] + y * size, at[2]];
  b.path(outline.map(point));
  if (identity.modifier === "ring") b.path(polygon(12).map(([x, y]) => point([x * 0.5, y * 0.5])));
  if (identity.modifier === "bar") b.path([point([-0.6, 0]), point([0.6, 0])]);
  if (identity.modifier === "dot") b.part("sphere", "steel", at, [size * 0.25, size * 0.25, size * 0.25], 2);
}

const positive = (value: AtlasMarket["reserve0"]): value is number =>
  Option.exists(Option.fromNullishOr(value), (reading) => Number.isFinite(reading) && reading >= 0);
const gaugeFraction = (value: number): number => value === 0 ? 0 : value / 10 ** Math.ceil(Math.log10(value));
const flow = (market: AtlasMarket): number =>
  market.stale ? 0 : Math.max(0, market.valueMovingUsd ?? market.volume24hUsd ?? 0);

function lighthouse(b: Builder, x: number, z: number): void {
  b.cylinder([x, 1.7, z], [13, 1.2, 13]);
  b.cylinder([x, 2.5, z], [10.8, 0.4, 10.8], "paper");
  b.cylinder([x, 7.4, z], [5.8, 9.6, 5.8]);
  for (let level = 0; level < 4; level++) {
    b.cylinder([x, 3 + level * 2.5, z], [6.8, 0.24, 6.8], "steel");
    for (let side = 0; side < 8; side++) {
      const angle = side * Math.PI / 4;
      const sx = x + Math.cos(angle) * 3.05;
      const sz = z + Math.sin(angle) * 3.05;
      b.box([sx, 4 + level * 2.2, sz], [0.25, 1.7, 0.25], "steel", 1);
    }
  }
  b.cylinder([x, 13, z], [8.4, 0.5, 8.4], "steel");
  b.cylinder([x, 14.7, z], [4.2, 2.9, 4.2], "paper");
  for (let side = 0; side < 8; side++) {
    const a = side * Math.PI / 4;
    b.cylinder([x + Math.cos(a) * 2.1, 14.7, z + Math.sin(a) * 2.1], [0.18, 3, 0.18], "steel");
  }
  b.part("cone", "structure", [x, 17, z], [7.4, 2, 7.4]);
  b.cylinder([x, 19, z], [0.22, 2.6, 0.22], "steel");
  b.part("sphere", "steel", [x, 20.4, z], [0.65, 0.65, 0.65]);
  for (let step = 0; step < 6; step++) {
    b.box([x, 0.2 + step * 0.19, z + 8.2 - step * 0.5], [5, 0.35, 0.65]);
  }
  for (let side = 0; side < 12; side++) {
    const a = side * Math.PI / 6;
    const c = Math.cos(a), s = Math.sin(a);
    b.beam([x + 3.4 * c, 12.6, z + 3.4 * s], [x + 3.4 * c, 13.9, z + 3.4 * s], 0.1);
  }
  b.part("ring", "steel", [x, 13.9, z], [7.9, 7.9, 0.8], 0, [Math.PI / 2, 0, 0]);
}

function harbour(b: Builder, radius: number): void {
  const w = radius * 1.6, d = radius * 1.15;
  b.box([0, -1.7, 0], [w + 3.2, 0.7, d + 3.2]);
  b.box([0, -0.8, 0], [w, 1.4, d]);
  b.box([0, 0.06, 0], [w - 0.6, 0.26, d - 0.6], "paper");
  for (let level = 0; level < 3; level++) {
    const p = level * 1.1;
    b.path([
      [-w / 2 - p, -1.1 - level * 0.04, -d / 2 - p],
      [w / 2 + p, -1.1 - level * 0.04, -d / 2 - p],
      [w / 2 + p, -1.1 - level * 0.04, d / 2 + p],
      [-w / 2 - p, -1.1 - level * 0.04, d / 2 + p],
      [-w / 2 - p, -1.1 - level * 0.04, -d / 2 - p],
    ]);
  }
  // Quays and empty architecture do not imply markets or balances.
  for (let i = 0; i < 5; i++) {
    const x = -w / 2 + 8 + i * (w - 16) / 4;
    b.box([x, -0.5, d / 2 + 6.5], [5, 0.9, 14], "structure");
    b.box([x, 0, d / 2 + 6.5], [4.7, 0.16, 14], "paper");
    for (let segment = 0; segment < 13; segment++) {
      b.path([[x - 2.3, 0.12, d / 2 + segment], [x + 2.3, 0.12, d / 2 + segment]]);
    }
    for (const offset of [-1.9, 1.9]) {
      for (const z of [d / 2 + 2, d / 2 + 11]) {
        b.cylinder([x + offset, 0.35, z], [0.45, 0.9, 0.45], "steel");
        b.cylinder([x + offset, 0.83, z], [0.8, 0.14, 0.8], "steel");
      }
    }
  }
  for (let i = 0; i < 30; i++) {
    const x = -w / 2 + i * w / 29;
    b.box([x, -0.65, d / 2 + 0.08], [0.12, 1.2, 0.18], "steel", 1);
  }
  const quayX = -w / 2 + 5;
  for (const z of [-d / 2 + 5, -d / 2 + 14]) {
    b.box([quayX, 0.8, z], [6.8, 1.3, 6]);
    b.box([quayX, 3.1, z], [6, 3.2, 4.8], "paper");
    b.part("box", "structure", [quayX - 1.7, 5.2, z], [3.7, 0.28, 6.2], 0, [0, 0, -0.42]);
    b.part("box", "structure", [quayX + 1.7, 5.2, z], [3.7, 0.28, 6.2], 0, [0, 0, 0.42]);
    for (let i = 0; i < 4; i++) b.box([quayX - 2.1 + i * 1.4, 2.8, z + 2.45], [0.7, 1.4, 0.12], "steel", 1);
  }
  lighthouse(b, w / 2 - 5, -d / 2 - 6);
  b.box([w / 2 - 5, -0.3, -d / 2 - 1], [4, 0.7, 12]);
  // Small engraved paving strokes provide scale without adding invented activity.
  for (let i = 0; i < 26; i++) {
    const x = -w / 2 + 4 + i * (w - 8) / 25;
    b.path([[x, 0.22, d / 2 - 3.2], [x + 0.9, 0.22, d / 2 - 3.2]]);
  }
  b.path([[-w / 2 + 11, 0.23, -d / 2 + 3], [-w / 2 + 11, 0.23, d / 2 - 5], [w / 2 - 3, 0.23, d / 2 - 5]]);
  b.path([[-w / 2 + 13, 0.23, -d / 2 + 3], [-w / 2 + 13, 0.23, d / 2 - 7], [w / 2 - 3, 0.23, d / 2 - 7]]);
}

function tideGauge(
  b: Builder,
  market: AtlasMarket,
  x: number,
  y: number,
  z: number,
  scale: number,
  records: readonly { readonly receipt: PublicReceipt; readonly agent: PublicAgent }[],
): void {
  b.box([x, y, z], [1.8 * scale, 0.3 * scale, 1.7 * scale]);
  b.cylinder([x - 0.5 * scale, y + 1.3 * scale, z], [0.75 * scale, 2.5 * scale, 0.75 * scale], "paper", 1);
  b.part("cylinder", "paper", [x + 0.55 * scale, y + 1.1 * scale, z], [1.2 * scale, 1.2 * scale, 1.2 * scale], 1, [
    Math.PI / 2,
    0,
    0,
  ]);
  b.ticks(x - 0.6 * scale, y + 0.2 * scale, z + 0.43 * scale, 2.1 * scale);
  const history = market.priceHistory?.filter((point) => positive(point.price) && Number.isFinite(point.timestamp))
    .toSorted((a, c) => a.timestamp - c.timestamp).slice(-32);
  if (history && history.length > 1 && !market.stale) {
    const first = history[0], last = history.at(-1);
    if (!first || !last) return;
    const prices = history.map((point) => point.price);
    const low = Math.min(...prices), high = Math.max(...prices);
    // The trace is denominated in the market's quote token; a USD display conversion cannot drive this float.
    const fraction = high > low ? (last.price - low) / (high - low) : 0.5;
    const floatY = y + (0.3 + Math.min(1, Math.max(0, fraction)) * 1.9) * scale;
    b.cylinder([x - 0.5 * scale, floatY, z], [0.8 * scale, 0.14 * scale, 0.8 * scale], "brass", 1);
    b.beam(
      [x - 0.5 * scale, floatY, z],
      [x + 0.55 * scale, y + 1.6 * scale, z + 0.61 * scale],
      0.065 * scale,
      "brass",
      2,
    );
    const span = last.timestamp - first.timestamp;
    b.path(
      history.map(point => [
        x + (0.08 + (span > 0 ? (point.timestamp - first.timestamp) / span : 0.5) * 0.95) * scale,
        y + (0.78 + (high > low ? (point.price - low) / (high - low) : 0.5) * 0.5) * scale,
        z + 0.62 * scale,
      ]),
    );
    // The mark sits below the trace, so its timestamp does not invent an execution price between observed samples.
    const visibleRecords = records.flatMap(record => {
      const at = Option.map(DateTime.make(record.receipt.updatedAt), DateTime.toEpochMillis);
      return Option.isSome(at) && at.value >= first.timestamp && at.value <= last.timestamp
        ? [{ ...record, at: at.value }]
        : [];
    }).slice(-16);
    for (const { receipt, agent, at } of visibleRecords) {
      const fractionAt = span > 0 ? (at - first.timestamp) / span : 0.5;
      const position: Point3 = [x + (0.08 + fractionAt * 0.95) * scale, y + 0.61 * scale, z + 0.64 * scale];
      emblem(b, agent.emblem, position, 0.055 * scale);
      b.receiptStamps.push({ receipt, agent, position });
    }
  }
}

function tank(
  b: Builder,
  x: number,
  y: number,
  z: number,
  reserve: AtlasMarket["reserve0"],
  stale: boolean,
  height: number,
): void {
  b.cylinder([x, y + 0.15, z], [3, 0.3, 3], "steel");
  b.cylinder([x, y + 0.5, z], [2.6, 0.5, 2.6], "structure");
  for (const dx of [-1.3, 1.3]) {
    for (const dz of [-0.75, 0.75]) b.box([x + dx, y + height / 2, z + dz], [0.13, height, 0.13], "steel");
  }
  b.part("ring", "steel", [x, y + height, z], [3, 3, 0.75], 0, [Math.PI / 2, 0, 0]);
  b.part("ring", "structure", [x, y + height * 0.55, z], [3, 3, 0.75], 1, [Math.PI / 2, 0, 0]);
  if (positive(reserve) && reserve > 0) {
    const liquidHeight = gaugeFraction(reserve) * (height - 0.8);
    b.cylinder([x, y + 0.5 + liquidHeight / 2, z], [2.46, liquidHeight, 2.46], stale ? "frost" : "water");
    if (!stale) b.box([x + 1.37, y + 0.5 + liquidHeight / 2, z + 0.7], [0.13, liquidHeight, 0.17], "brass");
  }
  b.ticks(x + 1.45, y + 0.5, z + 0.88, height - 0.8);
}

function constantProductMachine(
  b: Builder,
  market: AtlasMarket,
  x: number,
  y: number,
  z: number,
  h: number,
  active: boolean,
): void {
  b.box([x, y + 0.4, z], [1, 0.9, 1], "steel");
  b.box([x, y + 0.9, z], [7.8, 0.24, 0.8], "steel");
  tank(b, x - 2.3, y + 1, z, market.reserve0, market.stale, h);
  tank(b, x + 2.3, y + 1, z, market.reserve1, market.stale, h * 0.83);
  b.beam([x - 2.3, y + h + 1.2, z], [x - 2.3, y + h + 2, z], 0.24);
  b.beam([x - 2.3, y + h + 2, z], [x + 2.3, y + h + 2, z], 0.24);
  b.beam([x + 2.3, y + h + 2, z], [x + 2.3, y + h * 0.83 + 1.2, z], 0.24);
  if (active) b.cylinder([x + 2.3, y + h * 0.83 + 0.9, z], [0.42, 1.1, 0.42], "accent");
  b.part("ring", "steel", [x, y + 1.2, z + 0.5], [2.1, 2.1, 0.7], 1);
  if (positive(market.priceQuote) && !market.stale) {
    const a = gaugeFraction(market.priceQuote) * Math.PI;
    b.beam([x, y + 1.2, z + 0.57], [x + Math.cos(a) * 0.8, y + 1.2 + Math.sin(a) * 0.8, z + 0.57], 0.1, "brass");
    for (let tick = 0; tick <= 10; tick++) {
      const angle = tick / 10 * Math.PI;
      b.path([[x + Math.cos(angle) * 0.86, y + 1.2 + Math.sin(angle) * 0.86, z + 0.59], [
        x + Math.cos(angle),
        y + 1.2 + Math.sin(angle),
        z + 0.59,
      ]]);
    }
  }
}

function concentratedMachine(
  b: Builder,
  market: AtlasMarket,
  x: number,
  y: number,
  z: number,
  h: number,
  active: boolean,
): void {
  const bands = market.bands?.slice(0, 7) ?? [];
  const quote = Option.fromNullishOr(market.priceQuote);
  const count = Math.max(4, bands.length);
  const maximum = Math.max(1, ...bands.map((band) => band.liquidity));
  for (const dx of [-3.2, 3.2]) {
    for (const dz of [-1.6, 1.6]) b.box([x + dx, y + h / 2 + 0.2, z + dz], [0.18, h + 1.3, 0.18], "steel");
  }
  for (let i = 0; i < count; i++) {
    const ty = y + 0.6 + i * h / count;
    b.box([x, ty, z], [6.5, 0.16, 3.5]);
    b.box([x, ty + 0.2, z - 1.63], [6.5, 0.4, 0.14]);
    b.box([x - 3.17, ty + 0.2, z], [0.14, 0.4, 3.5]);
    b.box([x + 3.17, ty + 0.2, z], [0.14, 0.4, 3.5]);
    const band = bands[i];
    if (band && positive(band.liquidity) && band.liquidity > 0) {
      b.box(
        [x, ty + 0.09 + band.liquidity / maximum * 0.18, z],
        [6.1, band.liquidity / maximum * 0.34, 3.1],
        market.stale ? "frost" : "water",
      );
      if (
        Option.exists(quote, value => positive(value) && value >= band.lower && value <= band.upper) && !market.stale
      ) {
        b.part("sphere", "brass", [x + 2.7, ty + 0.46, z + 1.5], [0.42, 0.42, 0.42]);
      }
    }
  }
  b.ticks(x + 3.5, y + 0.3, z + 1.8, h);
  if (active) b.cylinder([x - 2.4, y + 0.95, z + 1.5], [0.42, 1.5, 0.42], "accent");
}

function bondingCurveMachine(
  b: Builder,
  market: AtlasMarket,
  x: number,
  y: number,
  z: number,
  h: number,
  active: boolean,
): void {
  const points: Point3[] = [];
  for (let i = 0; i <= 22; i++) {
    const p = i / 22;
    points.push([x - 3.3 + p * 6.6, y + 0.4 + p * p * h, z]);
  }
  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1], to = points[i];
    if (from && to) b.beam(from, to, 0.24, "steel");
  }
  for (let i = 0; i <= 4; i++) {
    const p = i / 4;
    const px = x - 3.3 + p * 6.6;
    b.box([px, y + (0.4 + p * p * h) / 2, z], [0.16, 0.4 + p * p * h, 0.6], "structure");
    b.path([[px - 0.15, y + 0.4 + p * p * h, z + 0.3], [px + 0.15, y + 0.4 + p * p * h, z + 0.3]]);
  }
  if (positive(market.progress) && !market.stale) {
    const p = Math.min(1, market.progress);
    b.part("sphere", active ? "accent" : "brass", [x - 3.3 + p * 6.6, y + 0.9 + p * p * h, z], [1.15, 1.15, 1.15]);
  } else if (active) b.cylinder([x - 3.3, y + 0.8, z], [0.4, 0.7, 0.4], "accent");
  b.box([x + 3.3, y + h + 1, z], [0.13, 1.2, 2], "steel");
}

function fullMachine(
  b: Builder,
  item: MarketPosition,
  active: boolean,
  exploded: boolean,
  records: readonly { readonly receipt: PublicReceipt; readonly agent: PublicAgent }[],
): void {
  const { market, x, z, tier } = item;
  const lift = exploded ? 2.7 : 0;
  const y = 0.9 + lift;
  const tower = tier === "tower";
  const h = tower ? 6.3 : 4.2;
  b.box([x, 0.42, z], [9.5, 0.65, 8.8]);
  b.box([x, 0.79, z], [9, 0.12, 8.3], "paper");
  if (exploded) {
    for (const corner of [-3.8, 3.8]) b.path([[x + corner, 0.8, z - 3], [x + corner, y, z - 3]]);
  }
  switch (market.kind) {
    case "constant-product":
      constantProductMachine(b, market, x, y, z, h, active);
      break;
    case "concentrated-liquidity":
      concentratedMachine(b, market, x, y, z, h, active);
      break;
    case "bonding-curve":
      bondingCurveMachine(b, market, x, y, z, h, active);
      break;
  }
  tideGauge(b, market, x + 3, y + 0.2, z + 3, 0.85, records);
  b.box([x - 1.5, 1.12, z + 4.17], [3.4, 0.6, 0.16], "paper");
}

function stall(b: Builder, item: MarketPosition, active: boolean): void {
  const { x, z, market } = item;
  b.part("stall", "structure", [x, 0, z], [1, 1, 1]);
  if (positive(market.liquidityUsd) && market.liquidityUsd > 0) {
    b.box([x, 1.1 + gaugeFraction(market.liquidityUsd) * 0.9, z + 1.38], [
      0.6,
      gaugeFraction(market.liquidityUsd) * 1.8,
      0.18,
    ], market.stale ? "frost" : "water");
  }
  if (active) b.cylinder([x + 1.2, 2.1, z + 1.4], [0.4, 0.65, 0.4], "accent");
}

/** Stall updates share the same construction as initial layout, keeping partial GPU replacements observationally equal. */
export function drawStall(item: MarketPosition, active: boolean): readonly KitPart[] {
  const builder = new Builder();
  stall(builder, item, active);
  return builder.parts;
}

function silhouette(b: Builder, item: MarketPosition, active: boolean): void {
  const { x, z, tier, market } = item;
  const height = tier === "tower" ? 9.5 : 5.5;
  b.box([x, 0.5, z], [9.5, 0.8, 8.8]);
  if (market.kind === "constant-product") {
    b.cylinder([x - 1.8, height / 2 + 0.9, z], [2.7, height, 2.7], "paper");
    b.cylinder([x + 1.8, height / 2 + 0.9, z], [2.7, height, 2.7], "paper");
  } else if (market.kind === "concentrated-liquidity") {
    b.box([x, height / 2 + 0.9, z], [6.8, height, 1.8], "paper");
    b.box([x, height + 1.1, z], [7.4, 0.35, 2.4], "steel");
  } else {
    b.cylinder([x, height / 2 + 0.9, z], [4.5, height, 4.5], "paper");
    b.part("cone", "steel", [x, height + 1.5, z], [5, 1.2, 5]);
  }
  if (active) b.cylinder([x + 3.5, 1.6, z + 3.6], [0.4, 0.7, 0.4], "accent");
}

function drawAdopted(
  b: Builder,
  item: MarketPosition,
  adoption: AdoptedDesign,
  options: DrawingOptions,
  active: boolean,
): boolean {
  const geometry = adoptedMachineGeometry(
    item,
    adoption,
    Option.contains(options.explodedId, item.market.id),
    options.seconds ?? 0,
  );
  if (Option.isNone(geometry)) return false;
  b.box([item.x, 0.42, item.z], [9.5, 0.65, 8.8]);
  b.box([item.x, 0.79, item.z], [9, 0.12, 8.3], "paper");
  for (const part of geometry.value.parts) b.parts.push(part);
  for (const path of geometry.value.paths) b.path(path);
  for (const trace of geometry.value.traces) {
    if (trace.reading !== "history" || trace.toTimestamp <= trace.fromTimestamp) continue;
    for (const { receipt, agent } of options.confirmed) {
      if (receipt.marketId !== item.market.id) continue;
      const at = Option.map(DateTime.make(receipt.updatedAt), DateTime.toEpochMillis);
      if (Option.isNone(at) || at.value < trace.fromTimestamp || at.value > trace.toTimestamp) continue;
      const fraction = (at.value - trace.fromTimestamp) / (trace.toTimestamp - trace.fromTimestamp);
      const position: Point3 = [trace.position[0] + fraction * trace.width, trace.position[1], trace.position[2]];
      emblem(b, agent.emblem, position, 0.05);
      b.receiptStamps.push({ receipt, agent, position });
    }
  }
  if (active) b.cylinder([item.x + 3.5, 1.6, item.z + 3.6], [0.4, 0.7, 0.4], "accent");
  return true;
}

/** Full instruments and distant silhouettes describe the same authoritative tier at every camera level. */
export function drawMarket(
  item: MarketPosition,
  detail: MarketDetail,
  options: DrawingOptions,
  active: boolean,
): MarketDrawing {
  const builder = new Builder();
  if (detail === "stall") stall(builder, item, active);
  else if (detail === "silhouette") silhouette(builder, item, active);
  else if (detail === "instrument") {
    const adoption = options.adoptedDesigns.find(value => value.marketId === item.market.id);
    if (!adoption || !drawAdopted(builder, item, adoption, options, active)) {
      fullMachine(
        builder,
        item,
        active,
        Option.contains(options.explodedId, item.market.id),
        options.confirmed.filter(entry => entry.receipt.marketId === item.market.id),
      );
    }
  }
  return {
    marketId: item.market.id,
    detail,
    parts: builder.parts,
    paths: builder.paths,
    receiptStamps: builder.receiptStamps,
  };
}

function placeSites(count: number): { x: number; z: number }[] {
  const stallPositions: { x: number; z: number }[] = count > 0 ? [{ x: 0, z: 0 }] : [];
  for (let ring = 1; stallPositions.length < count; ring++) {
    for (let column = -ring; column <= ring; column++) {
      for (const row of [-ring, ring]) {
        const x = column * 12, z = row * 12;
        stallPositions.push({ x, z });
      }
    }
    for (let row = -ring + 1; row < ring; row++) {
      for (const column of [-ring, ring]) {
        const x = column * 12, z = row * 12;
        stallPositions.push({ x, z });
      }
    }
  }
  return stallPositions;
}

const marketPriority = (
  market: AtlasMarket,
  lens: AtlasLens,
  moorings: ReadonlySet<string>,
  attention: ReadonlyMap<string, number>,
): number =>
  Match.value(lens).pipe(
    Match.when("mine", () => moorings.has(market.id) ? 1000 : 0),
    Match.when("flow", () => flow(market)),
    Match.when("attention", () =>
      attention.get(market.id) ?? (market.source === "synthetic" ? market.agentCount ?? 0 : 0)),
    Match.when("risk", () =>
      market.riskScore ?? (market.stale ? 1 : 0)),
    Match.when("liquidity", () => market.liquidityUsd ?? 0),
    Match.exhaustive,
  );

export const marketLabel = (item: MarketPosition, options: LabelOptions): WorldLabel => ({
  id: item.market.id,
  text: item.market.symbol,
  kind: "market",
  position: [item.x, item.height + (Option.contains(options.explodedId, item.market.id) ? 2.7 : 0), item.z],
  minZoom: item.tier === "stall" ? 2.5 : item.tier === "tower" ? 0.85 : 1.25,
  maxZoom: 30,
  priority: item.tier === "stall"
    ? 20
    : 50 + Math.log10(1 + Math.max(0, marketPriority(item.market, options.lens, options.moorings, options.attention))),
  subtitle: item.market.protocol,
});

export interface LayoutOptions {
  readonly lens: AtlasLens;
  readonly moorings: ReadonlySet<string>;
  readonly explodedId: Option.Option<string>;
  readonly activeMarketId: Option.Option<string>;
  readonly slots?: readonly MarketSlot[];
  readonly tiers?: readonly MarketTier[];
  readonly evidence?: AtlasEvidence;
  readonly adoptedDesigns?: readonly AdoptedDesign[];
  readonly seconds?: number;
  readonly window?: LayoutWindow;
  readonly placement?: Option.Option<Pick<AtlasLayout, "markets" | "radius">>;
}

function placementFor(
  markets: readonly AtlasMarket[],
  options: LayoutOptions,
): Pick<AtlasLayout, "markets" | "radius"> {
  const existing = options.placement ?? Option.none();
  if (Option.isSome(existing)) return existing.value;
  // Every persistent address reserves the largest footprint before promotion, so tier changes never force a neighbour to move.
  const slots = options.slots
    ?? markets.toSorted((a, c) => Order.String(a.id, c.id)).map((market, slot) => ({ marketId: market.id, slot }));
  const byId = new Map(slots.map(assignment => [assignment.marketId, assignment.slot]));
  const placed = markets.flatMap(market =>
    Option.match(Option.fromUndefinedOr(byId.get(market.id)), { onNone: () => [], onSome: slot => [{ market, slot }] })
  ).toSorted((a, c) => a.slot - c.slot);
  const highestSlot = slots.reduce((highest, assignment) => Math.max(highest, assignment.slot), -1);
  const positions = placeSites(highestSlot + 1);
  const extent = positions.reduce(
    (maximum, position) => Math.max(maximum, Math.abs(position.x), Math.abs(position.z)),
    0,
  );
  const tierById = new Map((options.tiers ?? []).map(assignment => [assignment.marketId, assignment.tier]));
  const locations = placed.flatMap(({ market, slot }) => {
    const position = positions[slot];
    if (!position) return [];
    const tier = tierById.get(market.id) ?? "stall";
    return [{
      market,
      ...position,
      height: tier === "tower" ? 11 : tier === "works" ? 8.5 : 4.1,
      radius: tier === "stall" ? 2.1 : 5,
      tier,
    }];
  });
  return { markets: locations, radius: Math.max(42, (extent + 8) / 0.575) };
}

function drawSyntheticAgents(
  b: Builder,
  locations: readonly MarketPosition[],
  moorings: ReadonlySet<string>,
  window: Option.Option<LayoutWindow>,
): void {
  let remainingAgents = 10_000;
  for (const item of locations) {
    const visible = !Option.exists(window, value => !visibleIn(item, value));
    if (visible && moorings.has(item.market.id)) {
      b.cylinder([item.x - item.radius, 1.4, item.z + item.radius], [0.11, 2.3, 0.11], "steel", 1);
      b.box([item.x - item.radius + 0.5, 2.2, item.z + item.radius], [1, 0.72, 0.06], "paper", 1);
      b.part("sphere", "steel", [item.x - item.radius, 2.65, item.z + item.radius], [0.22, 0.22, 0.22], 1);
    }
    const count = item.market.source === "synthetic"
      ? Math.min(remainingAgents, Math.max(0, Math.floor(item.market.agentCount ?? 0)))
      : 0;
    remainingAgents -= count;
    if (!visible) continue;
    for (let i = 0; i < count; i++) {
      const angle = i * 2.3999632297;
      const orbit = item.radius + 0.4 + Math.sqrt(i) * 0.2;
      const x = item.x + Math.cos(angle) * orbit, z = item.z + Math.sin(angle) * orbit;
      b.cylinder([x, 0.62, z], [0.26, 0.72, 0.26], "steel", 2);
      b.part("sphere", "paper", [x, 1.15, z], [0.4, 0.4, 0.4], 2);
    }
  }
}

function drawObservedAgents(
  b: Builder,
  locations: readonly MarketPosition[],
  agents: readonly PublicAgent[],
  associations: ReadonlyMap<string, string>,
  radius: number,
  labels: WorldLabel[],
): readonly AgentPlacement[] {
  const locationById = new Map(locations.map(location => [location.market.id, location]));
  const localCounts = new Map<string, number>();
  let quayCount = 0;
  const agentPlacements: AgentPlacement[] = [];
  for (const agent of agents) {
    const marketId = Option.fromUndefinedOr(associations.get(agent.id));
    const market = Option.flatMap(marketId, id => Option.fromUndefinedOr(locationById.get(id)));
    const position: Point3 = Option.match(market, {
      onNone: () => {
        const index = quayCount++;
        return [
          -radius * 0.8 + 8 + index % 5 * (radius * 1.6 - 16) / 4,
          0.62,
          radius * 0.575 + 2 + Math.floor(index / 5) * 0.8,
        ];
      },
      onSome: item => {
        const index = localCounts.get(item.market.id) ?? 0;
        localCounts.set(item.market.id, index + 1);
        const angle = Math.PI * 0.25 + index * 2.3999632297;
        const orbit = item.radius + 0.5 + Math.sqrt(index) * 0.28;
        return [item.x + Math.cos(angle) * orbit, 0.62, item.z + Math.sin(angle) * orbit];
      },
    });
    b.cylinder(position, [0.26, 0.72, 0.26], "steel", 2);
    b.box([position[0], 1.16, position[2]], [0.55, 0.55, 0.12], "paper", 2);
    emblem(b, agent.emblem, [position[0], 1.16, position[2] + 0.08], 0.23);
    agentPlacements.push({ agent, marketId, position });
    labels.push({
      id: `agent:${agent.id}`,
      text: agent.name,
      kind: "landmark",
      position: [position[0], 1.8, position[2]],
      minZoom: 3,
      maxZoom: 30,
      priority: 35,
      subtitle: "Research desk",
    });
  }
  return agentPlacements;
}

function drawMarketBatch(
  b: Builder,
  locations: readonly MarketPosition[],
  context: {
    readonly window: Option.Option<LayoutWindow>;
    readonly activeId: Option.Option<string>;
    readonly drawingOptions: DrawingOptions;
    readonly labelOptions: LabelOptions;
  },
) {
  const { window, activeId, drawingOptions, labelOptions } = context;
  const stallSpans: StallSpan[] = [];
  const marketSpans: StallSpan[] = [];
  const marketDrawings: MarketDrawing[] = [];
  const labels: WorldLabel[] = [];
  for (const item of locations) {
    const { market } = item;
    const detail: MarketDetail = Option.exists(window, value => !visibleIn(item, value))
      ? "hidden"
      : item.tier === "stall"
      ? "stall"
      : Option.exists(window, value => !value.detailed)
      ? "silhouette"
      : "instrument";
    const start = b.parts.length;
    const drawing = drawMarket(item, detail, drawingOptions, Option.contains(activeId, market.id));
    for (const part of drawing.parts) b.parts.push(part);
    for (const path of drawing.paths) b.path(path);
    for (const stamp of drawing.receiptStamps) b.receiptStamps.push(stamp);
    marketDrawings.push(drawing);
    const span = { marketId: market.id, start, count: b.parts.length - start };
    marketSpans.push(span);
    if (item.tier === "stall") stallSpans.push(span);
    if (detail === "hidden") continue;
    labels.push(marketLabel(item, labelOptions));
  }
  return { stallSpans, marketSpans, marketDrawings, labels };
}

export function createLayout(markets: readonly AtlasMarket[], options: LayoutOptions): AtlasLayout {
  const b = new Builder();
  const window = Option.fromUndefinedOr(options.window);
  const evidence = Option.map(Option.fromUndefinedOr(options.evidence), eligibleEvidence);
  const agents = Option.match(evidence, { onNone: (): readonly PublicAgent[] => [], onSome: value => value.agents });
  const identities = new Map(agents.map(agent => [agent.id, agent]));
  const receipts = Option.match(evidence, {
    onNone: (): readonly PublicReceipt[] => [],
    onSome: value => value.receipts,
  });
  const confirmed = receipts.filter(receipt => receipt.status === "confirmed").flatMap(receipt =>
    Option.match(Option.fromUndefinedOr(identities.get(receipt.agentId)), {
      onNone: () => [],
      onSome: agent => [{ receipt, agent }],
    })
  );
  const marketIds = new Set(markets.map(market => market.id));
  const associations = new Map<string, string>();
  const notes = Option.match(evidence, { onNone: () => [], onSome: value => value.notes });
  const activity = [
    ...notes.map(note => ({ id: note.id, agentId: note.agentId, marketId: note.marketId, at: note.createdAt })),
    ...receipts.map(receipt => ({
      id: receipt.id,
      agentId: receipt.agentId,
      marketId: receipt.marketId,
      at: receipt.updatedAt,
    })),
  ].filter(item => marketIds.has(item.marketId)).toSorted((a, c) =>
    Order.String(a.at, c.at) || Order.String(a.id, c.id)
  );
  for (const item of activity) associations.set(item.agentId, item.marketId);
  const attention = new Map<string, number>();
  for (const agent of agents) {
    const marketId = Option.fromUndefinedOr(associations.get(agent.id));
    if (Option.isSome(marketId)) attention.set(marketId.value, (attention.get(marketId.value) ?? 0) + 1);
  }
  const { markets: locations, radius } = placementFor(markets, options);
  harbour(b, radius);
  const activeId = Option.filter(
    options.activeMarketId,
    (id) => markets.some((market) => market.id === id && !market.stale),
  );
  const drawingOptions: DrawingOptions = {
    explodedId: options.explodedId,
    seconds: options.seconds ?? 0,
    confirmed,
    adoptedDesigns: (options.adoptedDesigns ?? []).filter(adoption =>
      Option.exists(
        designFit(adoption.design, adoption.marketId, locations),
        fit => fit.plinthAvailable && !fit.overlapsMachine,
      )
    ),
  };
  const labelOptions: LabelOptions = {
    lens: options.lens,
    moorings: options.moorings,
    attention,
    explodedId: options.explodedId,
  };
  const staticPaths = [...b.paths];
  const labels: WorldLabel[] = [
    {
      id: "island:base",
      text: "Base",
      kind: "island",
      position: [0, 0, -radius * 0.63],
      minZoom: 0,
      maxZoom: 2.2,
      priority: 100,
      subtitle: "The harbour island",
    },
    {
      id: "landmark:lighthouse",
      text: "The clockwork light",
      kind: "landmark",
      position: [radius * 0.8 - 5, 21, -radius * 0.575 - 6],
      minZoom: 0.6,
      maxZoom: 3.4,
      priority: 70,
    },
    {
      id: "district:quay",
      text: "Exchange quay",
      kind: "district",
      position: [-5, 0.3, radius * 0.575 + 5],
      minZoom: 0.7,
      maxZoom: 4.2,
      priority: 90,
    },
  ];
  const { stallSpans, marketSpans, marketDrawings, labels: marketLabels } = drawMarketBatch(b, locations, {
    window,
    activeId,
    drawingOptions,
    labelOptions,
  });
  for (const label of marketLabels) labels.push(label);
  drawSyntheticAgents(b, locations, options.moorings, window);
  const agentPlacements = drawObservedAgents(b, locations, agents, associations, radius, labels);
  return {
    parts: b.parts,
    markets: locations,
    labels,
    paths: b.paths,
    activeId,
    radius,
    agentPlacements,
    receiptStamps: b.receiptStamps,
    stallSpans,
    marketSpans,
    marketDrawings,
    drawingOptions,
    labelOptions,
    staticPaths,
    window,
  };
}
