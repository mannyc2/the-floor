import { describe, expect, it } from "@effect/vitest";
import { lilyPondDesign } from "@floor/gate";
import { designGeometry, fitDesignGeometry } from "@floor/gate/geometry";
import { KitScene } from "@floor/kit";
import { Effect, Option } from "effect";
import * as THREE from "three";
import { adoptedMachineGeometry } from "../src/adopted";
import {
  animatedDesignMarkets,
  commitDesignAnimation,
  designAnimationDue,
  planDesignAnimation,
} from "../src/animation";
import { designReadings } from "../src/design-readings";
import { cacheMarkets } from "../src/incremental";
import { createLayout } from "../src/layout";
import type { AtlasMarket } from "../src/types";
import { layoutWindow } from "../src/visibility";

const market: AtlasMarket = {
  id: "observed-market",
  name: "Observed native readings",
  symbol: "TEST",
  chainId: 8453,
  protocol: "Measured fixture",
  kind: "constant-product",
  baseSymbol: "BASE",
  quoteSymbol: "QUOTE",
  priceQuote: 0.5,
  priceUsd: 2000,
  liquidityUsd: 100,
  volume24hUsd: 100,
  change24h: 0,
  reserve0: 12,
  reserve1: 24,
  tradeCount: 3,
  verified: true,
  stale: false,
  source: "chain",
  bands: [{ lower: 0.4, upper: 0.6, liquidity: 40 }, { lower: 0.6, upper: 0.8, liquidity: 0 }],
  priceHistory: [{ timestamp: 1000, price: 0.4 }, { timestamp: 2000, price: 0.6 }, { timestamp: 4000, price: 0.5 }],
};
const adoption = {
  electionId: "holder-vote",
  marketId: market.id,
  adoptedAt: "2026-01-01T00:00:00.000Z",
  design: { ...lilyPondDesign, tokenId: market.id },
};
const layoutOptions = {
  lens: "flow" as const,
  moorings: new Set<string>(),
  explodedId: Option.none<string>(),
  activeMarketId: Option.some(market.id),
  tiers: [{ marketId: market.id, tier: "works" as const }],
  adoptedDesigns: [adoption],
};

describe("adopted machine observations", () => {
  it("keeps native values and observed time intervals separate from visual gauge fractions", () => {
    const readings = designReadings(market);
    expect(readings["price"]?.value).toBe(0.5);
    expect(readings["trades"]?.value).toBe(3);
    expect(readings["reserve0"]?.value).toBe(12);
    expect(readings["liquidityBands"]?.bands).toEqual(market.bands);
    const geometry = designGeometry(lilyPondDesign, readings);
    const trace = geometry.traces.find(value => value.reading === "history");
    expect(trace).toMatchObject({ fromTimestamp: 1000, toTimestamp: 4000 });
    const history = geometry.paths[0];
    expect(history).toHaveLength(3);
    if (!history || !trace) return;
    expect(history[1]?.[0]).toBeCloseTo(trace.position[0] + trace.width / 3);
    expect(history[2]?.[0]).toBeCloseTo(trace.position[0] + trace.width);
    expect(designGeometry(lilyPondDesign, designReadings({ ...market, priceUsd: 900_000 })).parts).toEqual(
      geometry.parts,
    );
  });

  it("leaves unavailable observations unmarked instead of substituting calibration values", () => {
    const readings = designReadings({ ...market, stale: true });
    expect(readings).toEqual({});
    const geometry = designGeometry(lilyPondDesign, readings);
    expect(geometry.parts.some(part => part.material === "brass")).toBe(false);
    expect(geometry.paths).toHaveLength(0);
    expect(geometry.traces).toHaveLength(0);
  });

  it("confines translated and driven custom parts to the existing market slot without claiming orange", () => {
    const design = {
      ...lilyPondDesign,
      tokenId: market.id,
      drivers: [{ partId: "reeds", property: "height", expression: { op: "constant" as const, value: 5000 } }],
    };
    const placed = adoptedMachineGeometry(
      { market, x: 30, z: -20, height: 8.5, radius: 5, tier: "works" },
      { electionId: "holder-vote", marketId: market.id, adoptedAt: "2026-01-01T00:00:00.000Z", design },
    );
    expect(Option.isSome(placed)).toBe(true);
    if (Option.isNone(placed)) return;
    expect(placed.value.parts.some(part => part.material === "accent")).toBe(false);
    for (const part of placed.value.parts) {
      const half = new THREE.Vector3(...part.size).multiplyScalar(0.5);
      const transform = new THREE.Matrix4().compose(
        new THREE.Vector3(...part.position),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(...(part.rotation ?? [0, 0, 0]))),
        new THREE.Vector3(1, 1, 1),
      );
      const extent = new THREE.Box3(half.clone().negate(), half).applyMatrix4(transform);
      expect(extent.min.x).toBeGreaterThanOrEqual(25 - 1e-9);
      expect(extent.max.x).toBeLessThanOrEqual(35 + 1e-9);
      expect(extent.min.z).toBeGreaterThanOrEqual(-25 - 1e-9);
      expect(extent.max.z).toBeLessThanOrEqual(-15 + 1e-9);
      expect(extent.min.y).toBeGreaterThanOrEqual(0.9 - 1e-9);
      expect(extent.max.y).toBeLessThanOrEqual(8.5 + 1e-9);
    }
  });

  it("keeps protected instruments fixed when a custom driver moves beyond the declared body", () => {
    const ordinary = fitDesignGeometry(designGeometry(lilyPondDesign, designReadings(market)), lilyPondDesign.bounds);
    const animated = fitDesignGeometry(
      designGeometry({
        ...lilyPondDesign,
        drivers: [{ partId: "reeds", property: "height", expression: { op: "constant", value: 5000 } }],
      }, designReadings(market)),
      lilyPondDesign.bounds,
    );
    expect(Option.isSome(ordinary)).toBe(true);
    expect(Option.isSome(animated)).toBe(true);
    if (Option.isNone(ordinary) || Option.isNone(animated)) return;
    expect(animated.value.parts.filter(part => part.material === "brass"))
      .toEqual(ordinary.value.parts.filter(part => part.material === "brass"));
    expect(animated.value.paths).toEqual(ordinary.value.paths);
    expect(animated.value.traces).toEqual(ordinary.value.traces);
    expect(animated.value.labels).toEqual(ordinary.value.labels);
  });

  it.effect("advances accepted time drivers through existing scene buffers while keeping readings and source geometry fixed", () =>
    Effect.gen(function*() {
      const layout = createLayout([market], layoutOptions);
      const cache = cacheMarkets(layout, [market]);
      const ids = animatedDesignMarkets(layout, cache, false);
      expect(ids).toEqual([market.id]);
      const scene = yield* Effect.acquireRelease(
        Effect.sync(() => new KitScene(layout.parts, "day", cache.keys)),
        value => Effect.sync(() => value.dispose()),
      );
      const objects = [...scene.group.children];
      const first = planDesignAnimation(layout, cache, ids, 0);
      const later = planDesignAnimation(layout, cache, ids, Math.PI / 2);
      const before = first.changes[0]?.drawing, after = later.changes[0]?.drawing;
      expect(before).toBeDefined();
      expect(after).toBeDefined();
      expect(after?.parts).not.toEqual(before?.parts);
      expect(after?.parts.filter(part => part.material === "brass")).toEqual(
        before?.parts.filter(part => part.material === "brass"),
      );
      expect(after?.parts.filter(part => part.material === "accent")).toHaveLength(1);
      expect(after?.paths).toEqual(before?.paths);
      expect(scene.update(later.parts)).toBe(true);
      expect(scene.group.children).toEqual(objects);
      const committed = commitDesignAnimation(layout, cache, later, Math.PI / 2);
      expect(committed.markets[0]?.market).toBe(market);
      expect(committed.drawingOptions.seconds).toBe(Math.PI / 2);
      expect(cache.markets.get(market.id)?.drawing).toBe(after);
    }));

  it("schedules at most four animation steps per second and stops for reduced motion, distant silhouettes or culling", () => {
    const layout = createLayout([market], layoutOptions);
    expect(animatedDesignMarkets(layout, cacheMarkets(layout, [market]), true)).toEqual([]);
    const distant = createLayout([market], { ...layoutOptions, window: layoutWindow([0, 0], 0.6, 1440, 1000) });
    expect(animatedDesignMarkets(distant, cacheMarkets(distant, [market]), false)).toEqual([]);
    const culled = createLayout([market], { ...layoutOptions, window: layoutWindow([10_000, 10_000], 6, 1440, 1000) });
    expect(animatedDesignMarkets(culled, cacheMarkets(culled, [market]), false)).toEqual([]);
    let previous = 0;
    const steps: number[] = [];
    for (let now = 0; now <= 1000; now++) {
      if (!designAnimationDue(previous, now)) continue;
      previous = now;
      steps.push(now);
    }
    expect(steps).toEqual([250, 500, 750, 1000]);
  });
});
