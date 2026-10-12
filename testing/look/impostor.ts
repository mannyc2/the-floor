import { Effect, Option } from "effect";
import { MeasurementError, validateRaster } from "./pixels";
import type { Raster } from "./pixels";

const averageBlock = (high: Raster, x: number, y: number, factor: number) => {
  let total = 0, edges = 0;
  for (let dy = 0; dy < factor; dy += 1) {
    for (let dx = 0; dx < factor; dx += 1) {
      const gray = high.data[(y * factor + dy) * high.width + x * factor + dx] ?? 255;
      total += gray;
      if (gray < 128) edges += 1;
    }
  }
  return { value: Math.round(total / (factor * factor)), edges };
};

export const areaAverageImpostor = Effect.fnUntraced(function*(high: Raster, direct: Raster, factor: number) {
  yield* validateRaster(high, 1);
  yield* validateRaster(direct, 1);
  if (
    !Number.isSafeInteger(factor) || factor < 1 || high.width !== direct.width * factor
    || high.height !== direct.height * factor
  ) {
    return yield* new MeasurementError({
      operation: "areaAverageImpostor",
      invariant: "The source must be an exact integer multiple of the direct-rendered mask",
    });
  }
  const data = new Uint8Array(direct.data.length);
  let highResolutionEdgePixels = 0, retainedEdgePixels = 0, bakedHalfDarkPixels = 0, directHalfDarkPixels = 0;
  for (let y = 0; y < direct.height; y += 1) {
    for (let x = 0; x < direct.width; x += 1) {
      const { value, edges } = averageBlock(high, x, y, factor);
      data[y * direct.width + x] = value;
      highResolutionEdgePixels += edges;
      if (value < 128) {
        retainedEdgePixels += edges;
        bakedHalfDarkPixels += 1;
      }
      if ((direct.data[y * direct.width + x] ?? 255) < 128) directHalfDarkPixels += 1;
    }
  }
  return {
    image: { width: direct.width, height: direct.height, data },
    highResolutionEdgePixels,
    retainedEdgePixels,
    edgeSurvivalFraction: highResolutionEdgePixels === 0
      ? Option.none<number>()
      : Option.some(retainedEdgePixels / highResolutionEdgePixels),
    bakedHalfDarkPixels,
    directHalfDarkPixels,
    directToBakedCoverage: directHalfDarkPixels === 0
      ? Option.none<number>()
      : Option.some(bakedHalfDarkPixels / directHalfDarkPixels),
  };
});
