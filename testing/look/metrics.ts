import { Effect, Option } from "effect";
import { expandDisk, MeasurementError, sameDimensions, validateMask, validateRaster } from "./pixels";
import type { Dpr, Raster } from "./pixels";

const count = (mask: Raster) => mask.data.reduce((total, value) => total + value, 0);
export const scores = Effect.fnUntraced(function*(prediction: Raster, target: Raster, dpr: Dpr) {
  yield* validateMask(prediction);
  yield* validateMask(target);
  yield* sameDimensions(prediction, target);
  const predictionPixels = count(prediction), targetPixels = count(target);
  if (predictionPixels === 0 || targetPixels === 0) {
    return {
      status: "empty",
      predictionPixels,
      targetPixels,
      exactF1: targetPixels === 0 ? Option.none<number>() : Option.some(0),
      tolerantF1: targetPixels === 0 ? Option.none<number>() : Option.some(0),
      exactPrecision: Option.none<number>(),
      exactRecall: Option.none<number>(),
      tolerantPrecision: Option.none<number>(),
      tolerantRecall: Option.none<number>(),
    };
  }
  const expandedTarget = yield* expandDisk(target, dpr);
  const expandedPrediction = yield* expandDisk(prediction, dpr);
  let intersection = 0, nearbyPrediction = 0, nearbyTarget = 0;
  for (let index = 0; index < prediction.data.length; index += 1) {
    if (prediction.data[index] === 1 && target.data[index] === 1) intersection += 1;
    if (prediction.data[index] === 1 && expandedTarget.data[index] === 1) nearbyPrediction += 1;
    if (target.data[index] === 1 && expandedPrediction.data[index] === 1) nearbyTarget += 1;
  }
  const precision = nearbyPrediction / predictionPixels, recall = nearbyTarget / targetPixels;
  return {
    status: "measured",
    predictionPixels,
    targetPixels,
    exactF1: Option.some(2 * intersection / (predictionPixels + targetPixels)),
    tolerantF1: Option.some(precision + recall === 0 ? 0 : 2 * precision * recall / (precision + recall)),
    exactPrecision: Option.some(intersection / predictionPixels),
    exactRecall: Option.some(intersection / targetPixels),
    tolerantPrecision: Option.some(precision),
    tolerantRecall: Option.some(recall),
  };
});

export const cylinderDensity = Effect.fnUntraced(
  function*(prediction: Raster, target: Raster, region: Raster, dpr: Dpr) {
    yield* validateMask(prediction);
    yield* validateMask(target);
    yield* validateMask(region);
    yield* sameDimensions(prediction, target);
    yield* sameDimensions(prediction, region);
    const expandedTarget = yield* expandDisk(target, dpr);
    const falseLines = prediction.data.map((value, index) =>
      value === 1 && region.data[index] === 1 && expandedTarget.data[index] === 0 ? 1 : 0
    );
    const area = count(region);
    const falseLinePixels = falseLines.reduce((total, value) => total + value, 0);
    if (area === 0) {
      return {
        status: "empty_roi",
        falseLinePixels,
        fractionOfRoi: Option.none<number>(),
        horizontalScanRows: 0,
        falseRunCrossings: 0,
        meanFalseCrossingsPer100CssPx: Option.none<number>(),
      };
    }
    const densities: Array<number> = [];
    let falseRunCrossings = 0;
    for (let y = 0; y < region.height; y += dpr) {
      let columns = 0, crossings = 0;
      for (let x = 0; x < region.width; x += 1) {
        const index = y * region.width + x;
        if (region.data[index] === 1) columns += 1;
        if (falseLines[index] === 1 && (x === 0 || falseLines[index - 1] !== 1)) crossings += 1;
      }
      if (columns === 0) continue;
      falseRunCrossings += crossings;
      densities.push(crossings * 100 / (columns / dpr));
    }
    return {
      status: "measured",
      falseLinePixels,
      fractionOfRoi: Option.some(falseLinePixels / area),
      horizontalScanRows: densities.length,
      falseRunCrossings,
      meanFalseCrossingsPer100CssPx: densities.length === 0
        ? Option.none<number>()
        : Option.some(densities.reduce((total, value) => total + value, 0) / densities.length),
    };
  },
);

// Python's round uses ties-to-even. Preserve its sample-row choice at half
// pixels instead of silently moving the profile when porting to JavaScript.
const roundEven = (value: number) => {
  const lower = Math.floor(value), fraction = value - lower;
  return fraction === 0.5 ? lower + lower % 2 : Math.round(value);
};
export const cylinderWidth = Effect.fnUntraced(
  function*(gray: Raster, sample: { readonly x: number; readonly y: number }, dpr: Dpr) {
    yield* validateRaster(gray, 1);
    if (!Number.isFinite(sample.x) || !Number.isFinite(sample.y)) {
      return yield* new MeasurementError({
        operation: "cylinderWidth",
        invariant: "Projected sample coordinates must be finite",
      });
    }
    const center = roundEven(sample.x), row = roundEven(sample.y);
    if (row < 0 || row >= gray.height || center < 0 || center >= gray.width) {
      return yield* new MeasurementError({
        operation: "cylinderWidth",
        invariant: "Projected silhouette sample lies outside the capture",
      });
    }
    const start = Math.max(0, center - 5 * dpr), end = Math.min(gray.width, center + 5 * dpr);
    let runStart = Option.none<number>(),
      nearest = Option.none<{ readonly distance: number; readonly width: number }>(),
      darkness = 0;
    for (let x = start; x <= end; x += 1) {
      const value = x === end ? 255 : gray.data[row * gray.width + x] ?? 255;
      if (x < end) darkness += (255 - value) / 255;
      if (value < 128 && Option.isNone(runStart)) runStart = Option.some(x);
      if (value >= 128 && Option.isSome(runStart)) {
        const candidate = {
          distance: Math.abs((runStart.value + x - 1) / 2 - sample.x),
          width: (x - runStart.value) / dpr,
        };
        if (Option.isNone(nearest) || candidate.distance < nearest.value.distance) nearest = Option.some(candidate);
        runStart = Option.none();
      }
    }
    // An absent or unrelated run cannot establish a zero-width stroke. Keep
    // that gap explicit while retaining the independently measured darkness.
    const width = Option.flatMap(nearest, (run) => run.distance <= 2 * dpr ? Option.some(run.width) : Option.none());
    return {
      sampleCssXy: [sample.x / dpr, sample.y / dpr],
      rasterRow: row,
      rasterWindowX: [start, end],
      thresholdWidthCssPx: width,
      nearestRunDistanceCssPx: Option.map(nearest, (run) => run.distance / dpr),
      integratedDarknessCssPx: darkness / dpr,
      withinOnePlusMinusQuarter: Option.map(width, (value) => value >= 0.75 && value <= 1.25),
    };
  },
);
