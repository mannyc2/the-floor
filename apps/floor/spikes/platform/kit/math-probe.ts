import { Effect, Schema } from "effect";
import {
  getDeltaAmountBaseUnsigned,
  getDeltaAmountQuoteUnsigned,
  getExcludedFeeAmount,
  getIncludedFeeAmount,
  type MathError,
} from "./math";

export class MathProbeFailure extends Schema.TaggedError<MathProbeFailure>()(
  "MathProbeFailure",
  { check: Schema.String, expected: Schema.String, actual: Schema.String },
) {}

const check = Effect.fnUntraced(function*(
  label: string,
  actual: string,
  expected: string,
) {
  if (actual !== expected) {
    return yield* new MathProbeFailure({ check: label, expected, actual });
  }
  return actual;
});

const expectFailure = Effect.fnUntraced(function*(
  label: string,
  effect: Effect.Effect<unknown, MathError>,
  expected: MathError["_tag"],
) {
  const actual = yield* Effect.match(effect, {
    onSuccess: () => "unexpected_success",
    onFailure: (error) => error._tag,
  });
  yield* check(label, actual, expected);
  return actual;
});

export const probeMath = Effect.fnUntraced(function*() {
  const excluded = yield* getExcludedFeeAmount(10_000_000n, 101n);
  const included = yield* getIncludedFeeAmount(10_000_000n, 99n);
  const baseDown = yield* getDeltaAmountBaseUnsigned(2n, 3n, 7n, "down");
  const baseUp = yield* getDeltaAmountBaseUnsigned(2n, 3n, 7n, "up");
  const q64 = 1n << 64n;
  const quoteDown = yield* getDeltaAmountQuoteUnsigned(q64, q64 * 2n, q64 + 1n, "down");
  const quoteUp = yield* getDeltaAmountQuoteUnsigned(q64, q64 * 2n, q64 + 1n, "up");

  // Fixed expected values were cross-checked with SDK 1.5.13. In particular,
  // both delta fixtures have nonzero remainders, so a rounding regression fails.
  yield* check("excluded amount", excluded[0].toString(), "99");
  yield* check("excluded fee", excluded[1].toString(), "2");
  yield* check("included amount", included[0].toString(), "100");
  yield* check("included fee", included[1].toString(), "1");
  yield* check("base down", baseDown.toString(), "1");
  yield* check("base up", baseUp.toString(), "2");
  yield* check("quote down", quoteDown.toString(), "1");
  yield* check("quote up", quoteUp.toString(), "2");

  const underflow = yield* expectFailure(
    "reversed price range",
    getDeltaAmountBaseUnsigned(3n, 2n, 7n, "down"),
    "MathUnderflow",
  );
  const divisionByZero = yield* expectFailure(
    "fee denominator zero even for zero amount",
    getIncludedFeeAmount(1_000_000_000n, 0n),
    "MathDivisionByZero",
  );
  const invalidInput = yield* expectFailure(
    "negative unsigned amount",
    getExcludedFeeAmount(10_000_000n, -1n),
    "MathInvalidInput",
  );
  return {
    status: "pass",
    checks: 11,
    excludedFee: { amount: excluded[0].toString(), fee: excluded[1].toString() },
    includedFee: { amount: included[0].toString(), fee: included[1].toString() },
    baseDelta: { down: baseDown.toString(), up: baseUp.toString() },
    quoteDelta: { down: quoteDown.toString(), up: quoteUp.toString() },
    negativeControls: { underflow, divisionByZero, invalidInput },
  };
});
