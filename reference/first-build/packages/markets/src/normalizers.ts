import { Effect, Schema } from "effect";
import { formatUnits } from "viem";
import type { LiquidityBand, MarketReading, Provenance, TokenInfo } from "./types";

export class InvalidPoolReading
  extends Schema.TaggedError<InvalidPoolReading>()("InvalidPoolReading", { message: Schema.String })
{}
interface PoolInput {
  readonly token0: TokenInfo;
  readonly token1: TokenInfo;
  readonly baseAddress: string;
  readonly reserve0: bigint;
  readonly reserve1: bigint;
  readonly provenance: Provenance;
}
const units = (raw: bigint, decimals: number) => Number(formatUnits(raw, decimals));
const reserves = (input: PoolInput) => ({
  reserve0: units(input.reserve0, input.token0.decimals),
  reserve1: units(input.reserve1, input.token1.decimals),
  reserve0Raw: input.reserve0.toString(),
  reserve1Raw: input.reserve1.toString(),
});
export const normalizeConstantProduct = Effect.fn("Markets.normalizeConstantProduct")(function*(input: PoolInput) {
  const r = reserves(input);
  const forward = input.baseAddress.toLowerCase() === input.token0.address.toLowerCase();
  const numerator = forward ? r.reserve1 : r.reserve0;
  const denominator = forward ? r.reserve0 : r.reserve1;
  if (denominator <= 0 || numerator <= 0) {
    return yield* new InvalidPoolReading({ message: "Pool has no measurable liquidity" });
  }
  const price = numerator / denominator;
  if (!Number.isFinite(price) || price <= 0) {
    return yield* new InvalidPoolReading({ message: "Price cannot be represented as a finite positive reading" });
  }
  return { ...r, provenance: input.provenance, price, bands: [] } satisfies MarketReading;
});
export const normalizeConcentratedLiquidity = Effect.fn("Markets.normalizeConcentratedLiquidity")(
  function*(
    input: PoolInput & {
      readonly sqrtPriceX96: bigint;
      readonly tick: number;
      readonly liquidity: bigint;
      readonly bands: readonly LiquidityBand[];
    },
  ) {
    if (input.sqrtPriceX96 <= 0n) return yield* new InvalidPoolReading({ message: "Pool is not initialized" });
    // Decimal correction belongs after squaring Q96; reserves are not a valid concentrated-liquidity price.
    const ratio = (Number(input.sqrtPriceX96) / 2 ** 96) ** 2 * 10 ** (input.token0.decimals - input.token1.decimals);
    const forward = input.baseAddress.toLowerCase() === input.token0.address.toLowerCase();
    const price = forward ? ratio : 1 / ratio;
    if (!Number.isFinite(price) || price <= 0) {
      return yield* new InvalidPoolReading({ message: "Price cannot be represented as a finite positive reading" });
    }
    return {
      ...reserves(input),
      provenance: input.provenance,
      price,
      sqrtPriceX96: input.sqrtPriceX96.toString(),
      tick: input.tick,
      liquidity: input.liquidity.toString(),
      bands: input.bands,
    } satisfies MarketReading;
  },
);
export const normalizeBondingCurve = Effect.fn("Markets.normalizeBondingCurve")(
  function*(
    input: PoolInput & {
      readonly virtualTokenReserve: bigint;
      readonly virtualQuoteReserve: bigint;
      readonly supply: bigint;
      readonly graduation:
        | { readonly basis: "quote-raised"; readonly threshold: bigint }
        | { readonly basis: "tokens-sold"; readonly remainingThreshold: bigint; readonly initialSupply: bigint };
      readonly graduated: boolean;
    },
  ) {
    const forward = input.baseAddress.toLowerCase() === input.token0.address.toLowerCase();
    const tokenDecimals = forward ? input.token0.decimals : input.token1.decimals;
    const quoteDecimals = forward ? input.token1.decimals : input.token0.decimals;
    const tokenReserve = units(input.virtualTokenReserve, tokenDecimals);
    const target = input.graduation.basis === "quote-raised"
      ? input.graduation.threshold
      : input.graduation.initialSupply - input.graduation.remainingThreshold;
    if (tokenReserve <= 0 || input.virtualQuoteReserve <= 0n || target <= 0n) {
      return yield* new InvalidPoolReading({ message: "Invalid curve reserves or threshold" });
    }
    // Virtuals graduates when remaining token reserves cross a bound; treating it as quote raised gives a false progress gauge.
    const measured = input.graduation.basis === "quote-raised"
      ? (forward ? input.reserve1 : input.reserve0)
      : input.graduation.initialSupply - input.virtualTokenReserve;
    const price = units(input.virtualQuoteReserve, quoteDecimals) / tokenReserve;
    if (!Number.isFinite(price) || price <= 0) {
      return yield* new InvalidPoolReading({
        message: "Curve price cannot be represented as a finite positive reading",
      });
    }
    const quote = forward ? input.token1 : input.token0;
    const token = forward ? input.token0 : input.token1;
    return {
      ...reserves(input),
      provenance: input.provenance,
      price,
      bands: [],
      supply: units(input.supply, tokenDecimals),
      graduationThreshold: units(target, input.graduation.basis === "quote-raised" ? quoteDecimals : tokenDecimals),
      graduationBasis: input.graduation.basis,
      graduationUnit: input.graduation.basis === "quote-raised" ? quote.symbol : token.symbol,
      virtualTokenReserveRaw: input.virtualTokenReserve.toString(),
      virtualQuoteReserveRaw: input.virtualQuoteReserve.toString(),
      progress: input.graduated ? 1 : Math.min(1, Math.max(0, Number(measured) / Number(target))),
      graduated: input.graduated,
    } satisfies MarketReading;
  },
);
