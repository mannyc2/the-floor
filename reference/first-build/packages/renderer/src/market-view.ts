import type { MarketView } from "@floor/markets/schema";
import { Array, DateTime, Option, Result } from "effect";
import type { AtlasMarket } from "./types";

/** Liquidity ticks are token1/token0 prices; the displayed pair may have the opposite orientation. */
const tickPrice = (market: MarketView, tick: number): number => {
  const ratio = Math.pow(1.0001, tick) * Math.pow(10, market.token0.decimals - market.token1.decimals);
  return market.token.address === market.token0.address ? ratio : 1 / ratio;
};

export const atlasMarket = (market: MarketView): AtlasMarket => ({
  id: market.id,
  name: market.name,
  symbol: market.symbol,
  chainId: 8453,
  protocol: market.venue,
  kind: market.kind,
  baseSymbol: market.token.symbol,
  quoteSymbol: market.quote.symbol,
  priceUsd: market.priceUsd,
  priceQuote: market.reading.price,
  liquidityUsd: market.liquidityUsd,
  volume24hUsd: market.volume24hUsd,
  valueMovingUsd: market.valueMovingUsd,
  tradeCount: Option.getOrNull(Option.map(Option.fromNullOr(market.flow), flow => flow.trades)),
  change24h: market.change24h,
  verified: true,
  // Recorded observations retain their instrument values; provenance is distinct from missing or invalid data.
  stale: false,
  reserve0: market.reading.reserve0,
  reserve1: market.reading.reserve1,
  source: market.reading.provenance.source,
  bands: Array.map(market.reading.bands, band => {
    const first = tickPrice(market, band.tickLower);
    const second = tickPrice(market, band.tickUpper);
    return { lower: Math.min(first, second), upper: Math.max(first, second), liquidity: Number(band.liquidity) };
  }),
  progress: market.reading.progress,
  priceHistory: Array.filterMap(market.history, point =>
    DateTime.make(point.timestamp).pipe(
      Option.map(timestamp => ({ timestamp: DateTime.toEpochMillis(timestamp), price: point.price })),
      Result.fromOption(() => "Invalid observed timestamp"),
    )),
});
