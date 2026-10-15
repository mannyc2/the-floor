import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Effect, FileSystem, Path, Schema } from "effect";
import { verifyGeneratedAtlas } from "../atlas/manifest";
import { hasStyleViolation } from "./visual-values";

class AtlasStyleError extends Schema.TaggedError<AtlasStyleError>()("AtlasStyleError", { file: Schema.String }) {}

const checkStyles = Effect.fn("Atlas.checkStyles")(function*(root: string = ".") {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const generated = yield* verifyGeneratedAtlas(root);
  for (const directory of ["apps/web/src", "packages/atlas/src", "packages/atlas/generated"]) {
    const absolute = path.join(root, directory);
    if (!(yield* fs.exists(absolute))) continue;
    for (const relative of yield* fs.readDirectory(absolute, { recursive: true })) {
      if (!relative.endsWith(".css") && !relative.endsWith(".html")) continue;
      const file = path.join(directory, relative);
      if (generated.has(file)) continue;
      if (hasStyleViolation(file, yield* fs.readFileString(path.join(root, file)))) {
        return yield* new AtlasStyleError({ file });
      }
    }
  }
  const entry = "apps/web/index.html";
  if (hasStyleViolation(entry, yield* fs.readFileString(path.join(root, entry)))) {
    return yield* new AtlasStyleError({ file: entry });
  }
  return void 0;
});

if (import.meta.main) {
  checkStyles().pipe(
    Effect.provide(BunServices.layer),
    BunRuntime.runMain,
  );
}
