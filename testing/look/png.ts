import { Effect, Schema } from "effect";
import { PNG } from "pngjs";

export class PngError
  extends Schema.TaggedError<PngError>()("PngError", { operation: Schema.String, cause: Schema.Defect() })
{
  override get message() {
    return `${this.operation}: ${this.cause instanceof Error ? this.cause.message : String(this.cause)}`;
  }
}
export const decodePng = (bytes: Uint8Array) =>
  Effect.try({
    try: () => {
      const image = PNG.sync.read(Buffer.from(bytes));
      return { width: image.width, height: image.height, data: new Uint8Array(image.data) };
    },
    catch: (cause) => new PngError({ operation: "decodePng", cause }),
  });
