import * as math from "@floor/chains/math";
import { expect, test } from "bun:test";
import { Effect, Predicate, Schema } from "effect";
import { expectEqual, runTest } from "./_runtime";
import oracle from "./fixtures/math-oracle.json";

const Expected = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("success"),
    value: Schema.Union([Schema.String, Schema.Array(Schema.String)]),
  }),
  Schema.Struct({ status: Schema.Literal("error"), error: Schema.String }),
]);
const Integer = Schema.String.check(Schema.isPattern(/^-?\d+$/));
const feeFields = { inputs: Schema.Tuple([Integer, Integer]), expected: Expected };
const deltaFields = {
  inputs: Schema.Tuple([Integer, Integer, Integer]),
  rounding: Schema.Literals(["up", "down"]),
  expected: Expected,
};
const Row = Schema.Union([
  Schema.Struct({ method: Schema.Literal("getExcludedFeeAmount"), ...feeFields }),
  Schema.Struct({ method: Schema.Literal("getIncludedFeeAmount"), ...feeFields }),
  Schema.Struct({ method: Schema.Literal("getDeltaAmountBaseUnsigned"), ...deltaFields }),
  Schema.Struct({ method: Schema.Literal("getDeltaAmountQuoteUnsigned"), ...deltaFields }),
]);

const evaluate = (row: typeof Row.Type): Effect.Effect<readonly bigint[] | bigint, math.MathError> => {
  if (row.method === "getExcludedFeeAmount") {
    return math.getExcludedFeeAmount(BigInt(row.inputs[0]), BigInt(row.inputs[1]));
  }
  if (row.method === "getIncludedFeeAmount") {
    return math.getIncludedFeeAmount(BigInt(row.inputs[0]), BigInt(row.inputs[1]));
  }
  if (row.method === "getDeltaAmountBaseUnsigned") {
    return math.getDeltaAmountBaseUnsigned(
      BigInt(row.inputs[0]),
      BigInt(row.inputs[1]),
      BigInt(row.inputs[2]),
      row.rounding,
    );
  }
  return math.getDeltaAmountQuoteUnsigned(
    BigInt(row.inputs[0]),
    BigInt(row.inputs[1]),
    BigInt(row.inputs[2]),
    row.rounding,
  );
};

test("all 940 recorded SDK 1.5.13 arithmetic cases retain their exact outcomes", () =>
  runTest(Effect.gen(function*() {
    const rows = yield* Schema.decodeUnknownEffect(Schema.Array(Row))(oracle.rows);
    expect(rows).toHaveLength(940);
    for (const row of rows) {
      const actual = yield* evaluate(row).pipe(Effect.match({
        onFailure: (error) => ({ status: "error", error: error._tag }),
        onSuccess: (value) => ({
          status: "success",
          value: Predicate.isBigInt(value) ? value.toString() : value.map(String),
        }),
      }));
      expectEqual(actual, row.expected);
    }
  })));

test("negative unsigned inputs fail before bigint arithmetic", () =>
  runTest(Effect.gen(function*() {
    const invalid: ReadonlyArray<Effect.Effect<readonly bigint[] | bigint, math.MathError>> = [
      math.getExcludedFeeAmount(-1n, 1n),
      math.getExcludedFeeAmount(1n, -1n),
      math.getIncludedFeeAmount(-1n, 1n),
      math.getIncludedFeeAmount(1n, -1n),
      math.getDeltaAmountBaseUnsigned(-1n, 1n, 1n, "up"),
      math.getDeltaAmountBaseUnsigned(1n, -1n, 1n, "up"),
      math.getDeltaAmountBaseUnsigned(1n, 2n, -1n, "down"),
      math.getDeltaAmountQuoteUnsigned(-1n, 1n, 1n, "down"),
      math.getDeltaAmountQuoteUnsigned(1n, -1n, 1n, "up"),
      math.getDeltaAmountQuoteUnsigned(1n, 2n, -1n, "up"),
    ];
    for (const computation of invalid) {
      const tag = yield* computation.pipe(
        Effect.match({ onFailure: (error) => error._tag, onSuccess: () => "unexpected_success" }),
      );
      expect(tag).toBe("MathInvalidInput");
    }
  })));
