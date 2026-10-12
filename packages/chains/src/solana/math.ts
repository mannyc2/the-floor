// Native-bigint ports of four Meteora Dynamic Bonding Curve SDK 1.5.13 helpers.
// Only this arithmetic is ported; it is not a curve quote. For non-negative
// inputs every outcome must match the SDK results recorded in
// test/fixtures/math-oracle.json, including which error wins when several
// checks could fail, so the arithmetic checks follow the SDK's order. The SDK's
// only role was producing that recording; it is not a dependency of this
// package and must stay out of production.
//
// Effect.fnUntraced, not Effect.fn: this arithmetic is not a useful tracing
// boundary. A span and stack capture on every call would add cost and trace
// noise, and each error's `operation` already names the failing computation.
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
// The SDK rounds quote deltas up by dividing by 2^128 but down with `>> 128`.
// For the non-negative products admitted here the shift equals division, so
// both roundings can share multiplyDivide.
const quoteDenominator = 1n << 128n;

// Every input is an unsigned on-chain integer, but bigint and the SDK's BN
// both accept negatives silently, so rejecting them is a contract beyond SDK
// parity. There is deliberately no upper bound: the SDK's intermediates are
// unbounded too, and the instruction codecs enforce field widths. Inputs are
// checked in the order listed, so the first negative one is reported.
const requireUnsigned = Effect.fnUntraced(function*(
  inputs: Readonly<Record<string, bigint>>,
  operation: string,
) {
  for (const [argument, value] of Object.entries(inputs)) {
    if (value < 0n) return yield* new MathInvalidInput({ operation, argument });
  }
  return void 0;
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
  // The SDK rejects a zero denominator before its shortcut for zero operands, so
  // a zero product over zero still fails as it does there. Native bigint would
  // throw a RangeError defect instead of this typed error.
  if (denominator === 0n) return yield* new MathDivisionByZero({ operation });
  const product = left * right;
  // bigint division truncates toward zero, so these are a true ceiling and floor
  // only because callers pass non-negative operands.
  return rounding === "up"
    ? (product + denominator - 1n) / denominator
    : product / denominator;
});

export const getExcludedFeeAmount = Effect.fnUntraced(function*(
  tradeFeeNumerator: bigint,
  includedFeeAmount: bigint,
): Effect.fn.Return<readonly [bigint, bigint], MathError> {
  const operation = "getExcludedFeeAmount";
  yield* requireUnsigned({ tradeFeeNumerator, includedFeeAmount }, operation);
  const tradingFee = yield* multiplyDivide(
    includedFeeAmount,
    tradeFeeNumerator,
    feeDenominator,
    "up",
    operation,
  );
  const excludedFeeAmount = yield* subtract(includedFeeAmount, tradingFee, operation);
  return [excludedFeeAmount, tradingFee];
});

export const getIncludedFeeAmount = Effect.fnUntraced(function*(
  tradeFeeNumerator: bigint,
  excludedFeeAmount: bigint,
): Effect.fn.Return<readonly [bigint, bigint], MathError> {
  const operation = "getIncludedFeeAmount";
  yield* requireUnsigned({ tradeFeeNumerator, excludedFeeAmount }, operation);
  const denominator = yield* subtract(feeDenominator, tradeFeeNumerator, operation);
  const includedFeeAmount = yield* multiplyDivide(
    excludedFeeAmount,
    feeDenominator,
    denominator,
    "up",
    operation,
  );
  const feeAmount = yield* subtract(includedFeeAmount, excludedFeeAmount, operation);
  return [includedFeeAmount, feeAmount];
});

export const getDeltaAmountBaseUnsigned = Effect.fnUntraced(function*(
  lowerSqrtPrice: bigint,
  upperSqrtPrice: bigint,
  liquidity: bigint,
  rounding: Rounding,
): Effect.fn.Return<bigint, MathError> {
  const operation = "getDeltaAmountBaseUnsigned";
  yield* requireUnsigned({ lowerSqrtPrice, upperSqrtPrice, liquidity }, operation);
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
): Effect.fn.Return<bigint, MathError> {
  const operation = "getDeltaAmountQuoteUnsigned";
  yield* requireUnsigned({ lowerSqrtPrice, upperSqrtPrice, liquidity }, operation);
  const priceDelta = yield* subtract(upperSqrtPrice, lowerSqrtPrice, operation);
  return yield* multiplyDivide(liquidity, priceDelta, quoteDenominator, rounding, operation);
});
