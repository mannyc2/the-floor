import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Effect, FileSystem, Path, Schema } from "effect";

class SuppressionReasonError extends Schema.TaggedError<SuppressionReasonError>()("SuppressionReasonError", {
  file: Schema.String,
  line: Schema.Int,
  detail: Schema.String,
}) {}

const check = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const files = ["alchemy.run.ts"];
  for (const root of ["apps", "packages", "scripts", "stacks", "testing"]) {
    files.push(
      ...(yield* fs.readDirectory(root, { recursive: true }))
        .map(file => path.join(root, file))
        .filter(file =>
          /\.[cm]?[jt]sx?$/.test(file)
          && !file.split("/").some(part => ["node_modules", "dist", "work", ".alchemy"].includes(part))
        ),
    );
  }
  for (const file of files) {
    const lines = (yield* fs.readFileString(file)).split("\n");
    for (const [index, line] of lines.entries()) {
      if (
        !/(?:\/\/|\/\*)\s*(?:(?:eslint|oxlint)-disable(?:-next-line|-line)?\b|@effect-diagnostics(?:-next-line|-line)?\s+[^\n]*:off\b)/
          .test(line)
      ) continue;
      const alias = /(?:\/\/|\/\*)\s*eslint-disable/.test(line);
      if (alias || !/ -- \S.{10,}/.test(line)) {
        return yield* new SuppressionReasonError({
          file,
          line: index + 1,
          detail: alias ? "Use an oxlint directive; ESLint aliases are ignored." : "Give a concrete reason after --.",
        });
      }
    }
  }
  return void 0;
});

if (import.meta.main) check.pipe(Effect.provide(BunServices.layer), BunRuntime.runMain);
