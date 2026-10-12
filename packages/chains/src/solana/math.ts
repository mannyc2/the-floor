import { Effect, Schema } from "effect";

export type Rounding = "up" | "down";

export class MathUnderflow extends Schema.TaggedError<MathUnderflow>()(
  "MathUnderflow",
  { operation: Schema.String },
) {}

export class MathDivisionByZero extends Schema.TaggedError<MathDivisionByZero>()(
  "MathDivisionByZero",
  { operation: Schema.String },
) {}

export class MathInvalidInput extends Schema.TaggedError<MathInvalidInput>()(
  "MathInvalidInput",
  { operation: Schema.String, argument: Schema.String },
) {}

export type MathError = MathUnderflow | MathDivisionByZero | MathInvalidInput;

const feeDenominator = 1_000_000_000n;
const quoteDenominator = 1n << 128n;

const unsigned = Effect.fnUntraced(function*(
  value: bigint,
  argument: string,
  operation: string,
) {
  // These are unsigned on-chain amounts; native bigint itself has no such bound.
  if (value < 0n) return yield* new MathInvalidInput({ operation, argument });
  return value;
});

const subtract = Effect.fnUntraced(function*(
  left: bigint,
  right: bigint,
  operation: string,
) {
  if (right > left) return yield* new MathUnderflow({ operation });
  return left - right;
});

const multiplyDivide = Effect.fnUntraced(function*(
  left: bigint,
  right: bigint,
  denominator: bigint,
  rounding: Rounding,
  operation: string,
) {
  // Check before zero numerators to preserve the SDK's division-by-zero behavior.
  if (denominator === 0n) return yield* new MathDivisionByZero({ operation });
  const product = left * right;
  return rounding === "up"
    ? (product + denominator - 1n) / denominator
    : product / denominator;
});

// This bounded adapter ports SDK 1.5.13 arithmetic only. The SDK is a dev oracle,
// never a runtime dependency, and these helpers are not a full curve quotation.
export const getExcludedFeeAmount = Effect.fnUntraced(function*(
  tradeFeeNumerator: bigint,
  includedFeeAmount: bigint,
) {
  const operation = "getExcludedFeeAmount";
  yield* unsigned(tradeFeeNumerator, "tradeFeeNumerator", operation);
  yield* unsigned(includedFeeAmount, "includedFeeAmount", operation);
  const tradingFee = yield* multiplyDivide(
    includedFeeAmount,
    tradeFeeNumerator,
    feeDenominator,
    "up",
    operation,
  );
  const excludedFeeAmount = yield* subtract(includedFeeAmount, tradingFee, operation);
  const result: readonly [bigint, bigint] = [excludedFeeAmount, tradingFee];
  return result;
});

export const getIncludedFeeAmount = Effect.fnUntraced(function*(
  tradeFeeNumerator: bigint,
  excludedFeeAmount: bigint,
) {
  const operation = "getIncludedFeeAmount";
  yield* unsigned(tradeFeeNumerator, "tradeFeeNumerator", operation);
  yield* unsigned(excludedFeeAmount, "excludedFeeAmount", operation);
  const denominator = yield* subtract(feeDenominator, tradeFeeNumerator, operation);
  const includedFeeAmount = yield* multiplyDivide(
    excludedFeeAmount,
    feeDenominator,
    denominator,
    "up",
    operation,
  );
  const feeAmount = yield* subtract(includedFeeAmount, excludedFeeAmount, operation);
  const result: readonly [bigint, bigint] = [includedFeeAmount, feeAmount];
  return result;
});

export const getDeltaAmountBaseUnsigned = Effect.fnUntraced(function*(
  lowerSqrtPrice: bigint,
  upperSqrtPrice: bigint,
  liquidity: bigint,
  rounding: Rounding,
) {
  const operation = "getDeltaAmountBaseUnsigned";
  yield* unsigned(lowerSqrtPrice, "lowerSqrtPrice", operation);
  yield* unsigned(upperSqrtPrice, "upperSqrtPrice", operation);
  yield* unsigned(liquidity, "liquidity", operation);
  const priceDelta = yield* subtract(upperSqrtPrice, lowerSqrtPrice, operation);
  return yield* multiplyDivide(
    liquidity,
    priceDelta,
    lowerSqrtPrice * upperSqrtPrice,
    rounding,
    operation,
  );
});

export const getDeltaAmountQuoteUnsigned = Effect.fnUntraced(function*(
  lowerSqrtPrice: bigint,
  upperSqrtPrice: bigint,
  liquidity: bigint,
  rounding: Rounding,
) {
  const operation = "getDeltaAmountQuoteUnsigned";
  yield* unsigned(lowerSqrtPrice, "lowerSqrtPrice", operation);
  yield* unsigned(upperSqrtPrice, "upperSqrtPrice", operation);
  yield* unsigned(liquidity, "liquidity", operation);
  const priceDelta = yield* subtract(upperSqrtPrice, lowerSqrtPrice, operation);
  return yield* multiplyDivide(liquidity, priceDelta, quoteDenominator, rounding, operation);
});
