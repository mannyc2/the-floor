import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Effect, FileSystem, Path, Schema } from "effect";
import { hasStyleViolation } from "./visual-values";

class AtlasStyleError extends Schema.TaggedError<AtlasStyleError>()("AtlasStyleError", { file: Schema.String }) {}

const check = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  // Generated Atlas CSS will need an exact source/output manifest after the art
  // picks. Until that generator exists, a filename or banner cannot grant an exemption.
  for (const root of ["apps/web/src", "packages/atlas/src"]) {
    if (!(yield* fs.exists(root))) continue;
    for (const relative of yield* fs.readDirectory(root, { recursive: true })) {
      if (!relative.endsWith(".css") && !relative.endsWith(".html")) continue;
      const file = path.join(root, relative);
      if (hasStyleViolation(file, yield* fs.readFileString(file))) return yield* new AtlasStyleError({ file });
    }
  }
  const entry = "apps/web/index.html";
  if (hasStyleViolation(entry, yield* fs.readFileString(entry))) return yield* new AtlasStyleError({ file: entry });
  return void 0;
});

check.pipe(
  // oxlint-disable-next-line effecttsgo/strict-effect-provide -- The lint entry owns the filesystem adapter.
  Effect.provide(BunServices.layer),
  BunRuntime.runMain,
);
