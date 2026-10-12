import { Reading } from "@floor/contract";
import { assignTiers, batchLatest, type MarketTier } from "@floor/districts";
import type { MarketRecording } from "@floor/markets/schema";
import { atlasMarket } from "@floor/renderer/market-view";
import { Array, Option, Schema } from "effect";
import { AtlasMarket } from "../../packages/renderer/src/types";

export const scenarioNames = ["1k", "50k", "agents", "launch-storm", "cascade"] as const;
export type ScenarioName = typeof scenarioNames[number];
export interface BenchScenario {
  readonly name: ScenarioName;
  readonly markets: number;
  readonly agents: number;
  readonly readingsPerSecond: number;
  readonly launches: number;
  readonly tiers: { readonly stall: number; readonly works: number; readonly tower: number };
  readonly description: string;
}
export const scenarios: readonly BenchScenario[] = [
  {
    name: "1k",
    markets: 1_000,
    agents: 2_000,
    readingsPerSecond: 4_000,
    launches: 0,
    tiers: { stall: 800, works: 180, tower: 20 },
    description: "One thousand markets · four thousand readings per second",
  },
  {
    name: "50k",
    markets: 50_000,
    agents: 0,
    readingsPerSecond: 4_000,
    launches: 0,
    tiers: { stall: 40_000, works: 9_000, tower: 1_000 },
    description: "Fifty thousand markets · whole-atlas stress",
  },
  {
    name: "agents",
    markets: 1_000,
    agents: 10_000,
    readingsPerSecond: 4_000,
    launches: 0,
    tiers: { stall: 800, works: 180, tower: 20 },
    description: "Ten thousand instanced figures · camera through every zoom",
  },
  {
    name: "launch-storm",
    markets: 500,
    agents: 500,
    readingsPerSecond: 2_000,
    launches: 500,
    tiers: { stall: 400, works: 90, tower: 10 },
    description: "Five hundred synthetic casts added over one minute",
  },
  {
    name: "cascade",
    markets: 1_000,
    agents: 2_000,
    readingsPerSecond: 4_000,
    launches: 0,
    tiers: { stall: 800, works: 180, tower: 20 },
    description: "Synthetic cascade stress shaped by recorded pool deltas; no liquidation evidence",
  },
];
const seededTier = (scenario: BenchScenario, index: number): MarketTier["tier"] => {
  const phase = index % 50;
  return phase < scenario.tiers.stall / scenario.markets * 50
    ? "stall"
    : phase < (scenario.tiers.stall + scenario.tiers.works) / scenario.markets * 50
    ? "works"
    : "tower";
};

/** Recorded pool magnitudes shape the load; every scaled or replay-timed observation remains synthetic. */
export function generateScenario(scenario: BenchScenario, recording: MarketRecording): readonly AtlasMarket[] {
  const samples = recording.snapshots.flatMap(snapshot => snapshot.markets).map(atlasMarket);
  if (samples.length === 0) return [];
  return Array.makeBy(scenario.markets, index => {
    const sample = Option.getOrThrow(Array.get(samples, index % samples.length));
    const tier = seededTier(scenario, index);
    const liquidity = tier === "stall"
      ? 1_000 + index % 40 * 1_000
      : tier === "works"
      ? 60_000 + index % 30 * 20_000
      : 10_000_000 + index * 10_000;
    const price = sample.priceUsd ?? 1;
    return AtlasMarket.make({
      ...sample,
      id: `synthetic:${index.toString().padStart(6, "0")}`,
      name: `Bench market ${index + 1}`,
      symbol: `B${index + 1}`,
      protocol: `Synthetic ${tier}; sampled ${sample.protocol}`,
      liquidityUsd: liquidity,
      priceUsd: price,
      valueMovingUsd: liquidity / 100,
      verified: false,
      stale: false,
      source: "synthetic",
      reserve0: liquidity / price / 2,
      reserve1: liquidity / 2,
      agentCount: Math.floor(scenario.agents / scenario.markets) + (index < scenario.agents % scenario.markets ? 1 : 0),
    });
  });
}

/** The synthetic prior represents the requested settled scene; the production hysteresis policy verifies every assignment. */
export const scenarioTiers = (scenario: BenchScenario, markets: readonly AtlasMarket[]): readonly MarketTier[] =>
  assignTiers(
    markets.map(market => ({
      marketId: market.id,
      districtId: "synthetic-district",
      liquidityUsd: Option.fromNullishOr(market.liquidityUsd),
      activity: { lowerBound: 200, complete: true },
    })),
    markets.map((market, index) => ({ marketId: market.id, tier: seededTier(scenario, index) })),
  );

export interface ScenarioBatch {
  readonly markets: readonly AtlasMarket[];
  readonly inputReadings: number;
  readonly emittedReadings: number;
  readonly launches: number;
}

/** The same district coalescer consumes contract-decoded readings before the renderer receives them. */
export function nextBatch(
  scenario: BenchScenario,
  initial: readonly AtlasMarket[],
  current: readonly AtlasMarket[],
  batch: number,
  elapsedMs: number,
): ScenarioBatch {
  const launches = scenario.launches === 0
    ? 0
    : Math.min(scenario.launches, Math.floor(elapsedMs / 60_000 * scenario.launches));
  const available = scenario.launches === 0 ? initial : initial.slice(0, launches);
  const count = Math.floor(scenario.readingsPerSecond / 4);
  const targetCount = Math.min(available.length, count);
  if (targetCount === 0) return { markets: available, inputReadings: 0, emittedReadings: 0, launches };
  const readingCount = count;
  const readings = Array.makeBy(readingCount, index => {
    const market = Option.getOrThrow(Array.get(available, (batch * targetCount + index) % available.length));
    const wave = scenario.name === "cascade" ? 1 - (batch % 24) / 32 : 1 + Math.sin((batch + index) / 9) * 0.015;
    return Reading.make({
      marketId: market.id,
      kind: market.kind,
      chainId: market.chainId,
      blockNumber: batch,
      blockHash: `synthetic-batch-${batch}`,
      blockTimestamp: batch * 250,
      source: "synthetic",
      values: {
        price: (market.priceUsd ?? 1) * wave,
        priceQuote: (market.priceQuote ?? market.priceUsd ?? 1) * wave,
        reserve0: (market.reserve0 ?? 1) / wave,
        reserve1: (market.reserve1 ?? 1) * wave,
        flow: (market.valueMovingUsd ?? 1) * (2 - wave),
      },
    });
  });
  const latest = batchLatest(readings);
  const updates = new Map(latest.map(reading => [reading.marketId, reading]));
  return {
    markets: available.map((market, index) => {
      const reading = updates.get(market.id);
      if (!reading) return current[index] ?? market;
      // This schema is the bench's fixed synthetic input contract, not a cast of provider data.
      const values = reading.values;
      return {
        ...market,
        priceUsd: Option.getOrElse(
          Schema.decodeUnknownOption(Schema.Finite)(values["price"]),
          () => market.priceUsd ?? 1,
        ),
        priceQuote: Option.getOrElse(
          Schema.decodeUnknownOption(Schema.Finite)(values["priceQuote"]),
          () => market.priceQuote ?? market.priceUsd ?? 1,
        ),
        reserve0: Option.getOrElse(
          Schema.decodeUnknownOption(Schema.Finite)(values["reserve0"]),
          () => market.reserve0 ?? 1,
        ),
        reserve1: Option.getOrElse(
          Schema.decodeUnknownOption(Schema.Finite)(values["reserve1"]),
          () => market.reserve1 ?? 1,
        ),
        valueMovingUsd: Option.getOrElse(
          Schema.decodeUnknownOption(Schema.Finite)(values["flow"]),
          () => market.valueMovingUsd ?? 1,
        ),
      };
    }),
    inputReadings: readings.length,
    emittedReadings: latest.length,
    launches,
  };
}
