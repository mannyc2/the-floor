import { BunServices } from "@effect/platform-bun";
import { Effect, FileSystem, Path } from "effect";
import { bakeTraderKit } from "../kit/traders/bake";
import { GltfError } from "../kit/traders/gltf";

// The trader kit, baked from its sources for the tests that pose it.
export const bakeKit = Effect.gen(function*() {
  const files = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const sources = yield* path.fromFileUrl(new URL("../../../assets/traders/source/", import.meta.url)).pipe(
    Effect.mapError(cause => new GltfError({ reason: "locate sources", cause })),
  );
  return yield* bakeTraderKit(name =>
    files.readFile(path.join(sources, name)).pipe(
      Effect.mapError(cause => new GltfError({ reason: `read ${name}`, cause })),
    )
  );
}).pipe(Effect.provide(BunServices.layer));
