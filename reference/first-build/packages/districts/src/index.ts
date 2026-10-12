import { defaults, type Reading, Tier } from "@floor/contract";
import { Option, Order, Result, Schema } from "effect";

export const MarketSlot = Schema.Struct({
  marketId: Schema.String,
  slot: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});
export type MarketSlot = typeof MarketSlot.Type;
export const MarketTier = Schema.Struct({ marketId: Schema.String, tier: Tier });
export type MarketTier = typeof MarketTier.Type;

export interface TierObservation {
  readonly marketId: string;
  readonly districtId: string;
  readonly liquidityUsd: Option.Option<number>;
  readonly activity: { readonly lowerBound: number; readonly complete: boolean };
}

/** Missing daily coverage can establish activity, but cannot establish inactivity or erase a previously observed tier. */
export function assignTiers(
  observations: readonly TierObservation[],
  previous: readonly MarketTier[],
): readonly MarketTier[] {
  const prior = new Map(previous.map(assignment => [assignment.marketId, assignment.tier]));
  const districts = new Map<string, TierObservation[]>();
  for (const observation of observations) {
    const district = districts.get(observation.districtId) ?? [];
    district.push(observation);
    districts.set(observation.districtId, district);
  }
  const percentiles = new Map<string, number>();
  for (const district of districts.values()) {
    const ordered = district.toSorted((left, right) =>
      Option.getOrElse(left.liquidityUsd, () => 0) - Option.getOrElse(right.liquidityUsd, () => 0)
      || Order.String(left.marketId, right.marketId)
    );
    ordered.forEach((observation, index) => percentiles.set(observation.marketId, (index + 1) / ordered.length));
  }
  return observations.map(observation => {
    const oldTier = prior.get(observation.marketId) ?? "stall";
    if (Option.isNone(observation.liquidityUsd)) return { marketId: observation.marketId, tier: oldTier };
    const factor = oldTier === "stall" ? 1 + defaults.tierHysteresis : 1 - defaults.tierHysteresis;
    if (!observation.activity.complete && observation.activity.lowerBound < defaults.worksTradesPerDay * factor) {
      return {
        marketId: observation.marketId,
        tier: observation.liquidityUsd.value < defaults.worksLiquidityUsd * factor ? "stall" : oldTier,
      };
    }
    return {
      marketId: observation.marketId,
      tier: nextTier({
        previous: oldTier,
        liquidityUsd: observation.liquidityUsd.value,
        tradesPerDay: observation.activity.lowerBound,
        districtPercentile: percentiles.get(observation.marketId) ?? 0,
      }),
    };
  });
}

export interface TierInput {
  readonly previous: Tier;
  readonly liquidityUsd: number;
  readonly tradesPerDay: number;
  readonly districtPercentile: number;
}
export function nextTier(input: TierInput): Tier {
  const factor = input.previous === "stall" ? 1 + defaults.tierHysteresis : 1 - defaults.tierHysteresis;
  const works = input.liquidityUsd >= defaults.worksLiquidityUsd * factor
    && input.tradesPerDay >= defaults.worksTradesPerDay * factor;
  if (!works) return "stall";
  const topShare = 1 - input.districtPercentile;
  const towerThreshold = (1 - defaults.towerPercentile)
    * (input.previous === "tower" ? 1 + defaults.tierHysteresis : 1 - defaults.tierHysteresis);
  return topShare <= towerThreshold ? "tower" : "works";
}
export interface Point {
  readonly x: number;
  readonly z: number;
}
export function limitMovement(previous: Point, target: Point, width: number, elapsedSeconds: number): Point {
  const dx = target.x - previous.x;
  const dz = target.z - previous.z;
  const distance = Math.hypot(dx, dz);
  const allowance = Math.max(0, width) * Math.max(0, elapsedSeconds) / 3600 * defaults.layoutWidthsPerHour;
  if (distance === 0 || distance <= allowance) return target;
  return { x: previous.x + dx / distance * allowance, z: previous.z + dz / distance * allowance };
}
export interface MovingMarket {
  readonly id: string;
  readonly valueMoving: number;
}
export function chooseOrange(markets: readonly MovingMarket[]): Option.Option<string> {
  let chosen = Option.none<MovingMarket>();
  for (const market of markets) {
    if (!Number.isFinite(market.valueMoving) || market.valueMoving <= 0) continue;
    if (
      Option.isNone(chosen) || market.valueMoving > chosen.value.valueMoving
      || (market.valueMoving === chosen.value.valueMoving && Order.String(market.id, chosen.value.id) < 0)
    ) {
      chosen = Option.some(market);
    }
  }
  return Option.map(chosen, market => market.id);
}
export class NonChainReading
  extends Schema.TaggedError<NonChainReading>()("NonChainReading", { message: Schema.String })
{}
export function acceptLiveReading(reading: Reading): Result.Result<Reading, NonChainReading> {
  if (reading.source !== "chain") {
    return Result.fail(new NonChainReading({ message: "Live districts accept chain readings only" }));
  }
  return Result.succeed(reading);
}
export function replayAt(readings: readonly Reading[], blockNumber: number): readonly Reading[] {
  const latest = new Map<string, Reading>();
  for (
    const reading of readings.toSorted((a, b) => a.blockNumber - b.blockNumber || Order.String(a.marketId, b.marketId))
  ) {
    if (reading.blockNumber <= blockNumber) latest.set(reading.marketId, reading);
  }
  return [...latest.values()].toSorted((a, b) => Order.String(a.marketId, b.marketId));
}
export interface DistrictAnchor extends Point {
  readonly id: string;
  readonly weight: number;
}
/** Weighted cells classify locations without moving their persistent district anchors. */
export function weightedCell(point: Point, anchors: readonly DistrictAnchor[]): Option.Option<string> {
  const sorted = anchors.toSorted((a, b) =>
    (Math.hypot(point.x - a.x, point.z - a.z) ** 2 - a.weight)
      - (Math.hypot(point.x - b.x, point.z - b.z) ** 2 - b.weight) || Order.String(a.id, b.id)
  );
  return Option.map(Option.fromUndefinedOr(sorted[0]), (anchor) => anchor.id);
}
export function batchLatest(readings: readonly Reading[]): readonly Reading[] {
  const latest = new Map<string, Reading>();
  for (const reading of readings) {
    const previous = latest.get(reading.marketId);
    if (!previous || reading.blockNumber >= previous.blockNumber) latest.set(reading.marketId, reading);
  }
  return [...latest.values()];
}
