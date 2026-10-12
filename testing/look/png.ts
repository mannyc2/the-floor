import { Effect, Schema } from "effect";
import { PNG } from "pngjs";
import { validateRaster } from "./pixels";
import type { Raster } from "./pixels";

export class PngError
  extends Schema.TaggedError<PngError>()("PngError", { operation: Schema.String, cause: Schema.Defect() })
{
  override get message() {
    return `${this.operation}: ${this.cause instanceof Error ? this.cause.message : String(this.cause)}`;
  }
}
export const decodePng = (bytes: Uint8Array) =>
  Effect.try({
    try: (): Raster => {
      const image = PNG.sync.read(Buffer.from(bytes));
      return { width: image.width, height: image.height, data: new Uint8Array(image.data) };
    },
    catch: (cause) => new PngError({ operation: "decodePng", cause }),
  });
export const encodeGrayscalePng = Effect.fnUntraced(function*(gray: Raster) {
  yield* validateRaster(gray, 1);
  return yield* Effect.try({
    try: () => {
      const output = new PNG({ width: gray.width, height: gray.height });
      for (let index = 0; index < gray.data.length; index += 1) {
        const value = gray.data[index] ?? 255, offset = index * 4;
        output.data[offset] = value;
        output.data[offset + 1] = value;
        output.data[offset + 2] = value;
        output.data[offset + 3] = 255;
      }
      return new Uint8Array(PNG.sync.write(output));
    },
    catch: (cause) => new PngError({ operation: "encodeGrayscalePng", cause }),
  });
});
