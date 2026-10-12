import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Effect, FileSystem, Path, Record, Result, Schema } from "effect";

const Counts = Schema.Struct({ oxlint: Schema.Int, effect: Schema.Int });
const Budget = Schema.Record(Schema.String, Counts);
class SuppressionBudgetError extends Schema.TaggedError<SuppressionBudgetError>()("SuppressionBudgetError", {
  file: Schema.String,
  detail: Schema.String,
}) {
  override get message() {
    return `${this.file}: ${this.detail}`;
  }
}
const excluded = (file: string) =>
  file.split("/").some(part => ["node_modules", "spikes", "dist", "work", ".alchemy"].includes(part));

export const countSuppressions = (
  file: string,
  source: string,
): Result.Result<typeof Counts.Type, SuppressionBudgetError> => {
  let oxlint = 0;
  let effect = 0;
  for (const line of source.split("\n")) {
    // Oxlint ignores these aliases by configuration; reject them so intended exceptions cannot evade review.
    if (/(?:\/\/|\/\*)\s*eslint-disable(?:-next-line|-line)?\b/.test(line)) {
      return Result.fail(
        new SuppressionBudgetError({
          file,
          detail: "ESLint suppression aliases are disabled; use a reasoned, budgeted oxlint directive.",
        }),
      );
    }
    const lint = /(?:\/\/|\/\*)\s*oxlint-disable(?:-next-line|-line)?\b/.test(line);
    const diagnostic = /\/\/\s*@effect-diagnostics(?:-next-line|-line)?\s+[^\n]*:off\b/.test(line);
    if (!lint && !diagnostic) continue;
    if (!/ -- \S.{10,}/.test(line)) {
      return Result.fail(
        new SuppressionBudgetError({
          file,
          detail: "A disabled rule requires a concrete reason on the same line.",
        }),
      );
    }
    oxlint += Number(lint);
    effect += Number(diagnostic);
  }
  return Result.succeed({ oxlint, effect });
};

const check = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const budget = yield* fs.readFileString("scripts/lint/suppression-budget.json").pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Budget))),
  );
  const files: string[] = ["alchemy.run.ts"];
  for (const root of ["apps", "packages", "scripts", "stacks", "testing"]) {
    files.push(
      ...(yield* fs.readDirectory(root, { recursive: true })).map(file => path.join(root, file))
        .filter(file => file.endsWith(".ts") && !excluded(file)),
    );
  }
  const observed: Record<string, typeof Counts.Type> = {};
  for (const file of files) {
    const source = yield* fs.readFileString(file);
    const counts = countSuppressions(file, source);
    if (Result.isFailure(counts)) return yield* counts.failure;
    if (counts.success.oxlint + counts.success.effect > 0) observed[file] = counts.success;
  }
  for (const file of new Set([...Record.keys(observed), ...Record.keys(budget)])) {
    const actual = observed[file];
    const expected = budget[file];
    if (actual?.oxlint !== expected?.oxlint || actual?.effect !== expected?.effect) {
      return yield* new SuppressionBudgetError({
        file,
        detail: "Suppression counts changed; review the reason and update the explicit budget.",
      });
    }
  }
  yield* Effect.logInfo(
    `Suppression budget: ${
      Record.values(observed).reduce((sum, count) => sum + count.oxlint + count.effect, 0)
    } reasoned directives`,
  );
  return void 0;
});

if (import.meta.main) {
  check.pipe(
    // oxlint-disable-next-line effecttsgo/strict-effect-provide -- This lint executable owns the filesystem scan and platform lifetime.
    Effect.provide(BunServices.layer),
    BunRuntime.runMain,
  );
}
