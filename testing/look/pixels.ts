import { Effect, Schema } from "effect";

export interface Raster {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}
export type Dpr = 1 | 2 | 3;
export class MeasurementError extends Schema.TaggedError<MeasurementError>()("MeasurementError", {
  operation: Schema.String,
  invariant: Schema.String,
}) {
  override get message() {
    return `${this.operation}: ${this.invariant}`;
  }
}

export const validateRaster = Effect.fnUntraced(function*(image: Raster, channels: 1 | 4) {
  if (
    !Number.isSafeInteger(image.width) || !Number.isSafeInteger(image.height) || image.width <= 0 || image.height <= 0
    || image.data.length !== image.width * image.height * channels
  ) {
    return yield* new MeasurementError({
      operation: "validateRaster",
      invariant: "Positive integer dimensions must match the exact pixel buffer length",
    });
  }
  return image;
});
export const validateMask = Effect.fnUntraced(function*(image: Raster) {
  yield* validateRaster(image, 1);
  if (image.data.some((value) => value > 1)) {
    return yield* new MeasurementError({
      operation: "validateMask",
      invariant: "Binary masks contain only zero and one",
    });
  }
  return image;
});
export const sameDimensions = Effect.fnUntraced(function*(left: Raster, right: Raster) {
  if (left.width !== right.width || left.height !== right.height) {
    return yield* new MeasurementError({
      operation: "sameDimensions",
      invariant: "Compared images must have identical dimensions",
    });
  }
  return true;
});

export const grayscaleOnWhite = Effect.fnUntraced(function*(rgba: Raster) {
  yield* validateRaster(rgba, 4);
  const data = new Uint8Array(rgba.width * rgba.height);
  for (let pixel = 0; pixel < data.length; pixel += 1) {
    const at = pixel * 4;
    const alpha = rgba.data[at + 3] ?? 0;
    const composite = (channel: number) =>
      Math.floor(((rgba.data[at + channel] ?? 0) * alpha + 255 * (255 - alpha) + 127) / 255);
    data[pixel] = Math.round(composite(0) * 0.299 + composite(1) * 0.587 + composite(2) * 0.114);
  }
  return { width: rgba.width, height: rgba.height, data };
});

export const thresholdMask = Effect.fnUntraced(function*(gray: Raster) {
  yield* validateRaster(gray, 1);
  return { width: gray.width, height: gray.height, data: gray.data.map((value) => value < 128 ? 1 : 0) };
});

export const expandDisk = Effect.fnUntraced(function*(mask: Raster, radius: number) {
  yield* validateMask(mask);
  if (!Number.isSafeInteger(radius) || radius < 0) {
    return yield* new MeasurementError({
      operation: "expandDisk",
      invariant: "Disk radius is a nonnegative integer in raster pixels",
    });
  }
  const data = new Uint8Array(mask.data.length);
  // Integer Euclidean shifts preserve the one-CSS-pixel tolerance;
  // square dilation would incorrectly accept diagonal pixels outside the disk.
  for (let y = 0; y < mask.height; y += 1) {
    for (let x = 0; x < mask.width; x += 1) {
      if (mask.data[y * mask.width + x] !== 1) continue;
      for (let dy = -radius; dy <= radius; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          const nextX = x + dx, nextY = y + dy;
          if (
            dx * dx + dy * dy <= radius * radius && nextX >= 0 && nextX < mask.width && nextY >= 0
            && nextY < mask.height
          ) {
            data[nextY * mask.width + nextX] = 1;
          }
        }
      }
    }
  }
  return { width: mask.width, height: mask.height, data };
});

export const erodeRegion = Effect.fnUntraced(function*(region: Raster, dpr: Dpr) {
  yield* validateMask(region);
  const outside = { ...region, data: region.data.map((value) => 1 - value) };
  const expanded = yield* expandDisk(outside, 2 * dpr);
  return { ...region, data: region.data.map((value, index) => value === 1 && expanded.data[index] === 0 ? 1 : 0) };
});

export const compareRgba = Effect.fnUntraced(function*(first: Raster, second: Raster) {
  yield* validateRaster(first, 4);
  yield* validateRaster(second, 4);
  yield* sameDimensions(first, second);
  let changedPixels = 0, maxChannelDelta = 0;
  for (let pixel = 0; pixel < first.data.length; pixel += 4) {
    let delta = 0;
    for (let channel = 0; channel < 4; channel += 1) {
      delta = Math.max(delta, Math.abs((first.data[pixel + channel] ?? 0) - (second.data[pixel + channel] ?? 0)));
    }
    if (delta > 0) changedPixels += 1;
    maxChannelDelta = Math.max(maxChannelDelta, delta);
  }
  return { changedPixelFraction: changedPixels / (first.width * first.height), maxChannelDelta };
});
