import { describe, expect, it } from "@effect/vitest";
import { KitScene } from "@floor/kit";
import { Array, Effect, Option } from "effect";
import { cacheMarkets, commitMarketUpdate, planMarketUpdate } from "../src/incremental";
import { createLayout } from "../src/layout";
import { AtlasMarket } from "../src/types";

// oxlint-disable-next-line effect/noNullish -- The renderer's public JSON contract represents unavailable observations as null.
const unavailable = null;

const markets = Array.makeBy(40, index =>
  AtlasMarket.make({
    id: `market:${index.toString().padStart(3, "0")}`,
    name: `Market${index}`,
    symbol: `M${index}`,
    chainId: 8453,
    protocol: "Layout fixture",
    kind: "constant-product",
    baseSymbol: "A",
    quoteSymbol: "B",
    priceUsd: 3,
    priceQuote: 3,
    liquidityUsd: 20_000 + index,
    volume24hUsd: unavailable,
    change24h: unavailable,
    verified: true,
    stale: false,
    source: "chain",
    reserve0: 1_000,
    reserve1: 3_000,
  }));
const slots = markets.map((market, slot) => ({ marketId: market.id, slot }));
const options = {
  lens: "flow" as const,
  moorings: new Set<string>(),
  explodedId: Option.none<string>(),
  activeMarketId: Option.some("market:025"),
  slots,
  tiers: markets.map((market, index) => ({
    marketId: market.id,
    tier: index < 24 ? "works" as const : "stall" as const,
  })),
};

describe("Incremental observed stall updates", () => {
  it.effect("matches a fresh layout through reserve, liquidity, staleness and orange transitions without replacing GPU buffers", () =>
    Effect.gen(function*() {
      const original = createLayout(markets, options);
      const cache = cacheMarkets(original, markets);
      const scene = yield* Effect.acquireRelease(
        Effect.sync(() => new KitScene(original.parts, "day", cache.keys)),
        value => Effect.sync(() => value.dispose()),
      );
      const gpuObjects = [...scene.group.children];
      const changed = markets.map(market =>
        market.id === "market:025"
          ? { ...market, liquidityUsd: 55_000, priceUsd: 12, reserve0: 44 }
          : market.id === "market:031"
          ? { ...market, priceUsd: 88, liquidityUsd: 63_000, symbol: "LATEST" }
          : market
      );
      const active = Option.some("market:031");
      const update = yield* Effect.fromOption(planMarketUpdate(original, markets, changed, active, cache));
      expect(scene.update(update.parts)).toBe(true);
      const committed = commitMarketUpdate(original, cache, update);
      const fresh = createLayout(changed, { ...options, activeMarketId: active });
      expect(committed).toEqual(fresh);
      expect(scene.partCount).toBe(fresh.parts.length);
      expect(scene.group.children).toEqual(gpuObjects);
      expect(committed.parts.filter(part => part.material === "accent")).toHaveLength(1);
      const stale = changed.map(market => market.id === "market:031" ? { ...market, stale: true } : market);
      const next = yield* Effect.fromOption(planMarketUpdate(committed, changed, stale, active, cache));
      // A new frost material partition is allowed to request a complete rebuild, leaving existing data untouched.
      const before = scene.partCount;
      expect(scene.update(next.parts)).toBe(false);
      expect(scene.partCount).toBe(before);
      expect(scene.group.children).toEqual(gpuObjects);
      const staleCommitted = commitMarketUpdate(committed, cache, next);
      expect(staleCommitted).toEqual(createLayout(stale, { ...options, activeMarketId: active }));
      expect(staleCommitted.parts.some(part => part.material === "accent")).toBe(false);
    }));
  it.effect("keeps updated observations even when a stall's geometry is unchanged", () =>
    Effect.gen(function*() {
      const original = createLayout(markets, options);
      const cache = cacheMarkets(original, markets);
      const changed = markets.map(market =>
        market.id === "market:029" ? { ...market, priceUsd: 47, reserve0: 7, reserve1: 329 } : market
      );
      const update = yield* Effect.fromOption(
        planMarketUpdate(original, markets, changed, options.activeMarketId, cache),
      );
      expect(update.parts).toEqual([]);
      const committed = commitMarketUpdate(original, cache, update);
      expect(committed).toEqual(createLayout(changed, options));
      expect(committed.markets.find(item => item.market.id === "market:029")?.market.priceUsd).toBe(47);
    }));
  it.effect("updates full instruments incrementally and reevaluates identity or figure topology", () =>
    Effect.sync(() => {
      const original = createLayout(markets, options);
      const cache = cacheMarkets(original, markets);
      const detailed = markets.map(market => market.id === "market:001" ? { ...market, reserve0: 700 } : market);
      const figures = markets.map(market => market.id === "market:029" ? { ...market, agentCount: 10 } : market);
      const update = planMarketUpdate(original, markets, detailed, options.activeMarketId, cache);
      expect(Option.isSome(update)).toBe(true);
      if (Option.isSome(update)) {
        expect(commitMarketUpdate(original, cache, update.value)).toEqual(createLayout(detailed, options));
      }
      expect(Option.isNone(planMarketUpdate(original, markets, figures, options.activeMarketId, cache))).toBe(true);
      expect(Option.isNone(planMarketUpdate(original, markets, markets.slice(1), options.activeMarketId, cache))).toBe(
        true,
      );
    }));
});
