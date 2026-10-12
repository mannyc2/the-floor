import { describe, expect, it } from "@effect/vitest";
import { assignTiers } from "@floor/districts";
import { Array, Effect, Option } from "effect";
import { createLayout, drawStall } from "../src/layout";
import type { AtlasMarket } from "../src/types";
import { layoutWindow } from "../src/visibility";

// oxlint-disable-next-line effect/noNullish -- This fixture represents an absent numeric observation on the public renderer DTO.
const missingReading = null;
const fixtureMarket = (id: string, overrides: Partial<AtlasMarket> = {}): AtlasMarket => ({
  id,
  name: id,
  symbol: id,
  chainId: 8453,
  protocol: "Test protocol",
  kind: "constant-product",
  baseSymbol: "A",
  quoteSymbol: "B",
  priceUsd: missingReading,
  liquidityUsd: missingReading,
  volume24hUsd: missingReading,
  change24h: missingReading,
  verified: false,
  stale: false,
  source: "synthetic",
  ...overrides,
});
const options = {
  lens: "flow" as const,
  moorings: new Set<string>(),
  explodedId: Option.none<string>(),
  activeMarketId: Option.none<string>(),
};
const render = (markets: readonly AtlasMarket[], settings: Parameters<typeof createLayout>[1] = options) =>
  createLayout(markets, {
    tiers: markets.map(market => ({ marketId: market.id, tier: "works" })),
    ...settings,
  });

describe("atlas reading boundaries", () => {
  it.effect("renders declared tier identity at every address and camera level", () =>
    Effect.sync(() => {
      const observations = Array.makeBy(1000, index =>
        fixtureMarket(`declared-${index.toString().padStart(4, "0")}`, {
          liquidityUsd: index % 50 < 40 ? 20_000 : index % 50 < 49 ? 80_000 : 10_000_000,
        }));
      const tiers = assignTiers(
        observations.map(market => ({
          marketId: market.id,
          districtId: "d",
          liquidityUsd: Option.fromNullishOr(market.liquidityUsd),
          activity: { lowerBound: 200, complete: true },
        })),
        observations.map((market, index) => ({
          marketId: market.id,
          tier: index % 50 < 40 ? "stall" : index % 50 < 49 ? "works" : "tower",
        })),
      );
      const scene = createLayout(observations, { ...options, tiers });
      expect(["stall", "works", "tower"].map(tier => scene.markets.filter(item => item.tier === tier).length)).toEqual([
        800,
        180,
        20,
      ]);
      const distant = scene.markets[999];
      expect(distant?.tier).toBe("tower");
      if (!distant) {
        return;
      }
      const close = createLayout(observations, {
        ...options,
        tiers,
        window: layoutWindow([distant.x, distant.z], 6, 1440, 900),
      });
      expect(close.marketDrawings.find(item => item.marketId === distant.market.id)?.detail).toBe("instrument");
      expect(close.marketDrawings.some(item => item.detail === "hidden")).toBe(true);
      const wide = createLayout(observations, { ...options, tiers, window: layoutWindow([0, 0], 0.1, 1440, 900) });
      expect(wide.marketDrawings.filter(item => item.detail === "silhouette")).toHaveLength(200);
      expect(wide.markets.map(item => [item.market.id, item.tier, item.x, item.z])).toEqual(
        scene.markets.map(item => [item.market.id, item.tier, item.x, item.z]),
      );
      expect(createLayout(observations, options).markets.every(item => item.tier === "stall")).toBe(true);
    }));
  it.effect("reserves every address for a full future footprint without moving promoted sites", () =>
    Effect.sync(() => {
      const observations = Array.makeBy(1000, index => fixtureMarket(`site-${index.toString().padStart(4, "0")}`));
      const slots = observations.map((market, slot) => ({ marketId: market.id, slot }));
      const before = createLayout(observations, { ...options, slots });
      const promoted = createLayout(observations, {
        ...options,
        slots,
        tiers: observations.map(market => ({ marketId: market.id, tier: "tower" })),
        window: layoutWindow([0, 0], 0.1, 1440, 900),
      });
      expect(promoted.markets.map(item => [item.x, item.z])).toEqual(before.markets.map(item => [item.x, item.z]));
      const sites = new Set(before.markets.map(item => `${item.x}:${item.z}`));
      expect(sites.size).toBe(observations.length);
      let closest = Number.POSITIVE_INFINITY;
      for (const [index, item] of before.markets.entries()) {
        for (const other of before.markets.slice(index + 1)) {
          closest = Math.min(closest, Math.hypot(item.x - other.x, item.z - other.z));
        }
      }
      expect(closest).toBeGreaterThanOrEqual(10);
    }));
  it("does not draw readings when they have not been observed", () => {
    const result = render([
      fixtureMarket("pool"),
      fixtureMarket("rack", { kind: "concentrated-liquidity" }),
      fixtureMarket("curve", { kind: "bonding-curve" }),
    ], options);
    expect(result.parts.filter((part) => ["brass", "water", "accent"].includes(part.material))).toHaveLength(0);
  });

  it("uses the authoritative flowing market rather than a liquidity ranking", () => {
    const result = render([
      fixtureMarket("large", { liquidityUsd: 9_000_000, volume24hUsd: 100_000 }),
      fixtureMarket("moving", { liquidityUsd: 100, valueMovingUsd: 40 }),
    ], { ...options, activeMarketId: Option.some("moving") });
    expect(result.activeId).toEqual(Option.some("moving"));
    expect(result.parts.filter((part) => part.material === "accent")).toHaveLength(1);
  });

  it("withdraws the orange signal when the identified market is stale or missing", () => {
    const stale = render([fixtureMarket("old", { stale: true })], { ...options, activeMarketId: Option.some("old") });
    const absent = render([fixtureMarket("present")], { ...options, activeMarketId: Option.some("missing") });
    for (const result of [stale, absent]) {
      expect(Option.isNone(result.activeId)).toBe(true);
      expect(result.parts.some((part) => part.material === "accent")).toBe(false);
    }
  });

  it("draws no liquid in observed empty reserves and bands", () => {
    const result = render([
      fixtureMarket("empty", { reserve0: 0, reserve1: 0 }),
      fixtureMarket("dry", { kind: "concentrated-liquidity", bands: [{ lower: 0, upper: 1, liquidity: 0 }] }),
    ], options);
    expect(result.parts.some((part) => part.material === "water")).toBe(false);
  });

  it("keeps all three machine forms to one orange part, including exploded views", () => {
    for (const kind of ["constant-product", "concentrated-liquidity", "bonding-curve"] as const) {
      const result = render([fixtureMarket("active", { kind, progress: 0.4 })], {
        ...options,
        explodedId: Option.some("active"),
        activeMarketId: Option.some("active"),
      });
      expect(result.parts.filter((part) => part.material === "accent")).toHaveLength(1);
    }
  });

  it("places the same markets consistently regardless of arrival order", () => {
    const markets = [
      fixtureMarket("b", { liquidityUsd: 100 }),
      fixtureMarket("a", { liquidityUsd: 100 }),
      fixtureMarket("c", { liquidityUsd: 10 }),
    ];
    const a = render(markets, options);
    const b = render(markets.toReversed(), options);
    expect(a.markets.map(({ market: entry, x, z }) => [entry.id, x, z])).toEqual(
      b.markets.map(({ market: entry, x, z }) => [entry.id, x, z]),
    );
  });

  it("uses quote-token prices to locate concentrated liquidity bands", () => {
    const pool = fixtureMarket("quote-pool", {
      kind: "concentrated-liquidity",
      source: "chain",
      priceUsd: 2000,
      priceQuote: 0.5,
      bands: [{ lower: 0.4, upper: 0.6, liquidity: 100 }],
    });
    const observed = render([pool], options);
    expect(observed.parts.filter(part => part.material === "brass" && part.shape === "sphere")).toHaveLength(1);
    const outside = render([{ ...pool, priceQuote: 0.7 }], options);
    expect(outside.parts.filter(part => part.material === "brass" && part.shape === "sphere")).toHaveLength(0);
  });

  it("keeps partial stall geometry equal to a fresh layout when observations change", () => {
    const markets = Array.makeBy(30, index =>
      fixtureMarket(`market-${index.toString().padStart(2, "0")}`, {
        liquidityUsd: 100,
        agentCount: 1,
      }));
    const settings = {
      ...options,
      tiers: markets.map((market, index) => ({
        marketId: market.id,
        tier: index < 24 ? "works" as const : "stall" as const,
      })),
    };
    const original = render(markets, settings);
    expect(original.stallSpans).toHaveLength(6);
    for (const item of original.markets.filter(entry => entry.tier === "stall")) {
      for (
        const [liquidityUsd, stale, active] of [[0, false, false], [200, true, false], [300, false, true]] as const
      ) {
        const changed = { ...item.market, liquidityUsd, stale };
        const activeMarketId = active ? Option.some(changed.id) : Option.none<string>();
        const fresh = render(markets.map(entry => entry.id === changed.id ? changed : entry), {
          ...settings,
          activeMarketId,
        });
        const span = fresh.stallSpans.find(entry => entry.marketId === changed.id);
        expect(span).toBeDefined();
        if (!span) continue;
        expect(drawStall({ ...item, market: changed }, active)).toEqual(
          fresh.parts.slice(span.start, span.start + span.count),
        );
        expect(span.count).toBe(active ? 3 : liquidityUsd === 0 ? 1 : 2);
      }
    }
  });
});
