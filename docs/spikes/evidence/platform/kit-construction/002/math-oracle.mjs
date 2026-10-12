import * as sdk from "@meteora-ag/dynamic-bonding-curve-sdk";
import BN from "bn.js";
import { Effect } from "effect";
import * as math from "./math.ts";
import { probeMath } from "./math-probe.ts";

const normalize = (value) => Array.isArray(value)
  ? value.map((item) => item.toString(10))
  : value.toString(10);
const bn = (value) => new BN(value.toString(10));
const rows = [];

function nativeResult(effect) {
  return Effect.runSync(Effect.match(effect, {
    onFailure: (error) => ({ status: "error", error: error._tag }),
    onSuccess: (value) => ({ status: "success", value: normalize(value) }),
  }));
}

function oracleResult(call) {
  try {
    return { status: "success", value: normalize(call()) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("subtraction overflow")) {
      return { status: "error", error: "MathUnderflow" };
    }
    if (message.includes("division by zero") || message === "Denominator cannot be zero") {
      return { status: "error", error: "MathDivisionByZero" };
    }
    return { status: "unexpected_error", message };
  }
}

function compare(method, inputs, rounding) {
  const args = rounding === undefined ? inputs : [...inputs, rounding];
  const sdkArgs = rounding === undefined
    ? inputs.map(bn)
    : [...inputs.map(bn), rounding === "up" ? sdk.Rounding.Up : sdk.Rounding.Down];
  const actual = nativeResult(math[method](...args));
  const expected = oracleResult(() => sdk[method](...sdkArgs));
  rows.push({
    method,
    inputs: inputs.map(String),
    ...(rounding === undefined ? {} : { rounding }),
    actual,
    expected,
    pass: JSON.stringify(actual) === JSON.stringify(expected),
  });
}

const amounts = [
  0n, 1n, 2n, 99n, 100n, 101n, 999_999_999n, 1_000_000_000n,
  1_000_000_001n, (1n << 64n) - 1n, 1n << 128n, (1n << 256n) - 1n,
];
const fees = [0n, 1n, 10_000_000n, 20_000_000n, 100_000_000n, 999_999_999n,
  1_000_000_000n, 1_000_000_001n, 2_000_000_000n];
for (const fee of fees) {
  for (const amount of amounts) {
    compare("getExcludedFeeAmount", [fee, amount]);
    compare("getIncludedFeeAmount", [fee, amount]);
  }
}

const q64 = 1n << 64n;
const priceRanges = [
  [0n, 0n], [0n, 1n], [1n, 0n], [1n, 1n], [1n, 2n], [2n, 3n], [3n, 2n],
  [q64 - 1n, q64], [q64, q64 + 1n], [q64, q64 * 2n],
  [32_609_545_905_467_449n, 130_438_178_253_327_822n],
  [(1n << 128n) - 2n, (1n << 128n) - 1n],
];
const liquidities = [0n, 1n, 2n, q64 - 1n, 1n << 128n,
  34_783_514_678_091_156_834_964_035_168_207n, (1n << 256n) - 1n];
for (const [lower, upper] of priceRanges) {
  for (const liquidity of liquidities) {
    for (const rounding of ["down", "up"]) {
      compare("getDeltaAmountBaseUnsigned", [lower, upper, liquidity], rounding);
      compare("getDeltaAmountQuoteUnsigned", [lower, upper, liquidity], rounding);
    }
  }
}

// Fixed seeds exercise remainders without relying on clocks or nondeterminism.
let seed = 0x1a2b3c4dn;
function next() {
  seed = (seed * 6_364_136_223_846_793_005n + 1_442_695_040_888_963_407n)
    & ((1n << 64n) - 1n);
  return seed;
}
for (let index = 0; index < 64; index += 1) {
  const fee = next() % 1_000_000_000n;
  const amount = next();
  compare("getExcludedFeeAmount", [fee, amount]);
  compare("getIncludedFeeAmount", [fee, amount]);
  const lower = next() + 1n;
  const upper = lower + next();
  const liquidity = (next() << 64n) + next();
  for (const rounding of ["down", "up"]) {
    compare("getDeltaAmountBaseUnsigned", [lower, upper, liquidity], rounding);
    compare("getDeltaAmountQuoteUnsigned", [lower, upper, liquidity], rounding);
  }
}

for (const rounding of ["down", "up"]) {
  compare("getDeltaAmountBaseUnsigned", [2n, 3n, 7n], rounding);
  compare("getDeltaAmountQuoteUnsigned", [q64, q64 * 2n, q64 + 1n], rounding);
}

// Negative values are outside the unsigned API contract, so this validation is
// explicit additional behavior rather than a claim of SDK parity for negatives.
const invalidInputs = [
  ["getExcludedFeeAmount", [-1n, 1n]],
  ["getExcludedFeeAmount", [1n, -1n]],
  ["getIncludedFeeAmount", [-1n, 1n]],
  ["getIncludedFeeAmount", [1n, -1n]],
  ["getDeltaAmountBaseUnsigned", [-1n, 1n, 1n, "up"]],
  ["getDeltaAmountBaseUnsigned", [1n, -1n, 1n, "up"]],
  ["getDeltaAmountBaseUnsigned", [1n, 2n, -1n, "down"]],
  ["getDeltaAmountQuoteUnsigned", [-1n, 1n, 1n, "down"]],
  ["getDeltaAmountQuoteUnsigned", [1n, -1n, 1n, "up"]],
  ["getDeltaAmountQuoteUnsigned", [1n, 2n, -1n, "up"]],
].map(([method, inputs]) => {
  const actual = nativeResult(math[method](...inputs));
  return {
    method,
    inputs: inputs.map(String),
    actual,
    pass: actual.status === "error" && actual.error === "MathInvalidInput",
  };
});

const source = Bun.file(new URL("./math.ts", import.meta.url));
const sdkSource = Bun.file(new URL(import.meta.resolve("@meteora-ag/dynamic-bonding-curve-sdk")));
const sourceHash = (bytes) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
const report = {
  status: rows.every((row) => row.pass) && invalidInputs.every((row) => row.pass)
    ? "pass" : "fail",
  scope: "Native-bigint fee inclusion/exclusion and base/quote delta rounding only; no full curve quote or networking.",
  sdkVersion: "1.5.13",
  effectVersion: "4.0.3",
  mathSourceSha256: sourceHash(await source.arrayBuffer()),
  sdkSourceSha256: sourceHash(await sdkSource.arrayBuffer()),
  parityVectors: rows.length,
  parityFailures: rows.filter((row) => !row.pass).length,
  unsignedContractVectors: invalidInputs.length,
  unsignedContractFailures: invalidInputs.filter((row) => !row.pass).length,
  successVectors: rows.filter((row) => row.actual.status === "success").length,
  underflowVectors: rows.filter((row) => row.actual.error === "MathUnderflow").length,
  divisionByZeroVectors: rows.filter((row) => row.actual.error === "MathDivisionByZero").length,
  limitations: [
    "Unsigned inputs only; negative-input rejection is an additional explicit contract.",
    "Unbounded intermediate bigint matches these SDK helpers; instruction codecs enforce on-chain field widths separately.",
    "The official SDK is imported only by this development oracle driver.",
  ],
  rows,
  invalidInputs,
};
await Bun.write(new URL("./math-oracle.json", import.meta.url), JSON.stringify(report, null, 2) + "\n");
const probe = Effect.runSync(probeMath());
await Bun.write(new URL("./math-probe-result.json", import.meta.url), JSON.stringify(probe, null, 2) + "\n");
console.log(JSON.stringify({
  status: report.status,
  parityVectors: report.parityVectors,
  parityFailures: report.parityFailures,
  unsignedContractVectors: report.unsignedContractVectors,
  unsignedContractFailures: report.unsignedContractFailures,
  successVectors: report.successVectors,
  underflowVectors: report.underflowVectors,
  divisionByZeroVectors: report.divisionByZeroVectors,
}));
if (report.status !== "pass") throw new Error("Native-bigint math oracle parity failed");
