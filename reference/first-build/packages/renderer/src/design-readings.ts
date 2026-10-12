import type { DesignReading, DesignReadings } from "@floor/gate/geometry";
import { Option, Record } from "effect";
import type { AtlasMarket } from "./types";

const observed = (value: AtlasMarket["reserve0"]): Option.Option<number> =>
  Option.filter(Option.fromNullishOr(value), observation => Number.isFinite(observation) && observation >= 0);
// The decimal gauge projection changes only presentation; drivers retain the original native-unit observation.
const magnitude = (value: number): number => value === 0 ? 0 : value / 10 ** Math.ceil(Math.log10(value));

/** No calibration or USD substitution enters an adopted instrument. Missing source values leave its mark absent. */
export function designReadings(market: AtlasMarket): DesignReadings {
  if (market.stale) return {};
  const entries = new Map<string, DesignReading>();
  for (
    const [name, source] of [
      ["reserve0", market.reserve0],
      ["reserve1", market.reserve1],
      ["price", market.priceQuote],
      ["trades", market.tradeCount],
      ["progress", market.progress],
    ] as const
  ) {
    const value = observed(source);
    if (Option.isSome(value)) {
      entries.set(name, {
        value: value.value,
        fraction: name === "progress" ? Math.max(0, Math.min(1, value.value)) : magnitude(value.value),
      });
    }
  }
  const history =
    market.priceHistory?.filter(point =>
      Number.isFinite(point.timestamp) && Number.isFinite(point.price) && point.price > 0
    ).toSorted((a, b) => a.timestamp - b.timestamp).slice(-32) ?? [];
  const last = history.at(-1);
  if (history.length > 1 && last) {
    const prices = history.map(point => point.price);
    const low = Math.min(...prices), high = Math.max(...prices);
    const fraction = high > low ? (last.price - low) / (high - low) : 0.5;
    entries.set("history", { value: last.price, fraction, history });
    const price = entries.get("price");
    if (price) entries.set("price", { ...price, fraction, history });
  }
  const bands =
    market.bands?.filter(band =>
      Number.isFinite(band.lower) && Number.isFinite(band.upper) && band.lower <= band.upper
      && Number.isFinite(band.liquidity) && band.liquidity >= 0
    ) ?? [];
  const total = bands.reduce((sum, band) => sum + band.liquidity, 0);
  if (bands.length > 0 && Number.isFinite(total)) {
    const price = observed(market.priceQuote);
    const reading = {
      value: total,
      fraction: magnitude(total),
      bands,
    };
    entries.set("liquidityBands", Option.isSome(price) ? { ...reading, quote: price.value } : reading);
  }
  return Record.fromEntries(entries);
}
