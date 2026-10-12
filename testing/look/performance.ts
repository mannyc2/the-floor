import { Effect, Option } from "effect";
import { MeasurementError } from "./pixels";

export const phoneProfile = {
  width: 390,
  height: 844,
  dpr: 3,
  cpuThrottlingRate: 4,
  warmupFrames: 10,
  measuredFrames: 120,
};
export const summarizeTimes = Effect.fnUntraced(function*(values: ReadonlyArray<number>) {
  if (values.some((value) => !Number.isFinite(value) || value < 0)) {
    return yield* new MeasurementError({
      operation: "summarizeTimes",
      invariant: "Timing samples must be finite nonnegative measurements",
    });
  }
  const sorted = values.toSorted((left, right) => left - right);
  const percentile = (fraction: number) => Option.fromNullishOr(sorted[Math.floor((sorted.length - 1) * fraction)]);
  return {
    count: values.length,
    p50: percentile(0.5),
    p95: percentile(0.95),
    p99: percentile(0.99),
    over16_7ms: values.filter((value) => value > 16.7).length,
    cpuBudget16_7ms: Option.map(percentile(0.95), (value) => value <= 16.7),
  };
});
