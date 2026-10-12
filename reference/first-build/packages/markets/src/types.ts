import { Option, Schema } from "effect";

export const Provenance = Schema.Struct({
  chainId: Schema.Literal(8453),
  blockNumber: Schema.Int,
  blockHash: Schema.String,
  blockTimestamp: Schema.String,
  observedAt: Schema.String,
  source: Schema.Literals(["chain", "recording"]),
});
export type Provenance = typeof Provenance.Type;
export const TokenInfo = Schema.Struct({
  address: Schema.String,
  symbol: Schema.String,
  name: Schema.String,
  decimals: Schema.Int,
});
export type TokenInfo = typeof TokenInfo.Type;
export const PricePoint = Schema.Struct({
  blockNumber: Schema.Int,
  timestamp: Schema.String,
  price: Schema.Finite,
  source: Schema.Literals(["chain", "recording"]),
});
export type PricePoint = typeof PricePoint.Type;
export const LiquidityBand = Schema.Struct({
  tickLower: Schema.Int,
  tickUpper: Schema.Int,
  liquidity: Schema.String,
  active: Schema.Boolean,
});
export type LiquidityBand = typeof LiquidityBand.Type;
export const MarketReading = Schema.Struct({
  provenance: Provenance,
  price: Schema.Finite,
  reserve0: Schema.Finite,
  reserve1: Schema.Finite,
  reserve0Raw: Schema.String,
  reserve1Raw: Schema.String,
  tick: Schema.optional(Schema.Int),
  sqrtPriceX96: Schema.optional(Schema.String),
  liquidity: Schema.optional(Schema.String),
  bands: Schema.Array(LiquidityBand),
  supply: Schema.optional(Schema.Finite),
  graduationThreshold: Schema.optional(Schema.Finite),
  graduationBasis: Schema.optional(Schema.Literals(["quote-raised", "tokens-sold"])),
  graduationUnit: Schema.optional(Schema.String),
  virtualTokenReserveRaw: Schema.optional(Schema.String),
  virtualQuoteReserveRaw: Schema.optional(Schema.String),
  progress: Schema.optional(Schema.Finite),
  graduated: Schema.optional(Schema.Boolean),
});
export type MarketReading = typeof MarketReading.Type;
export const MarketView = Schema.Struct({
  id: Schema.String,
  address: Schema.String,
  kind: Schema.Literals(["constant-product", "concentrated-liquidity", "bonding-curve"]),
  venue: Schema.String,
  token: TokenInfo,
  quote: TokenInfo,
  token0: TokenInfo,
  token1: TokenInfo,
  reading: MarketReading,
  history: Schema.Array(PricePoint),
  priceUsd: Schema.NullOr(Schema.Finite),
  liquidityUsd: Schema.NullOr(Schema.Finite),
  change24h: Schema.NullOr(Schema.Finite),
  flow: Schema.NullOr(
    Schema.Struct({
      trades: Schema.Int,
      windowSeconds: Schema.Int,
      quoteVolume: Schema.Finite,
      volumeUsd: Schema.NullOr(Schema.Finite),
      fromBlock: Schema.Int,
      toBlock: Schema.Int,
    }),
  ),
  valueMovingUsd: Schema.NullOr(Schema.Finite),
  volume24hUsd: Schema.NullOr(Schema.Finite),
  districtId: Schema.String,
  name: Schema.String,
  symbol: Schema.String,
});
export type MarketView = typeof MarketView.Type;
export const MarketSnapshot = Schema.Struct({
  ...Provenance.fields,
  markets: Schema.Array(MarketView),
  status: Schema.Struct({ mode: Schema.Literals(["live", "recording", "unavailable"]), message: Schema.String }),
});
export type MarketSnapshot = typeof MarketSnapshot.Type;
export const MarketRecording = Schema.Struct({
  version: Schema.Literal(1),
  description: Schema.String,
  capturedAt: Schema.String,
  rpcHost: Schema.String,
  snapshots: Schema.Array(MarketSnapshot),
});
export type MarketRecording = typeof MarketRecording.Type;
interface PoolIdentity {
  readonly address: `0x${string}`;
  readonly venue: string;
  readonly districtId: string;
}
export type PoolConfig =
  & PoolIdentity
  & (
    | { readonly kind: "constant-product"; readonly stableCheck?: boolean }
    | { readonly kind: "concentrated-liquidity" }
    | { readonly kind: "bonding-curve"; readonly bonding: `0x${string}`; readonly token: `0x${string}` }
  );

// JSON clients distinguish an unavailable observation from a measured zero. These constructors own that conversion.
export const emptyMarket = (
  pool: PoolConfig,
  address: string,
  token: TokenInfo,
  quote: TokenInfo,
  token0: TokenInfo,
  token1: TokenInfo,
  reading: MarketReading,
): MarketView => ({
  id: `base:${address.toLowerCase()}`,
  address,
  kind: pool.kind,
  venue: pool.venue,
  token,
  quote,
  token0,
  token1,
  reading,
  history: [],
  priceUsd: null,
  liquidityUsd: null,
  change24h: null,
  flow: null,
  valueMovingUsd: null,
  volume24hUsd: null,
  districtId: pool.districtId,
  name: token.name,
  symbol: token.symbol,
});
export const enrichMarket = (
  market: MarketView,
  quoteUsd: Option.Option<number>,
  history: readonly PricePoint[],
  change: Option.Option<number>,
  observedFlow: Option.Option<Omit<NonNullable<MarketView["flow"]>, "volumeUsd">>,
): MarketView => {
  const priceUsd = Option.map(quoteUsd, quote => market.reading.price * quote);
  const quoteReserve = market.quote.address === market.token0.address
    ? market.reading.reserve0
    : market.reading.reserve1;
  const baseReserve = market.token.address === market.token0.address
    ? market.reading.reserve0
    : market.reading.reserve1;
  const liquidityUsd = Option.map(quoteUsd, quote => quoteReserve * quote + baseReserve * market.reading.price * quote);
  const flow = Option.map(
    observedFlow,
    value => ({ ...value, volumeUsd: Option.getOrNull(Option.map(quoteUsd, quote => value.quoteVolume * quote)) }),
  );
  return {
    ...market,
    history,
    priceUsd: Option.getOrNull(priceUsd),
    liquidityUsd: Option.getOrNull(liquidityUsd),
    change24h: Option.getOrNull(change),
    flow: Option.getOrNull(flow),
    valueMovingUsd: Option.getOrNull(Option.flatMap(flow, value => Option.fromNullOr(value.volumeUsd))),
  };
};
export const withMarketHistory = (
  market: MarketView,
  history: readonly PricePoint[],
  change: Option.Option<number>,
): MarketView => ({ ...market, history, change24h: Option.getOrNull(change) });
