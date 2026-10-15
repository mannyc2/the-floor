import { Array, Effect, HashSet, Option, Record, Result, Schema } from "effect";

const Chunk = Schema.Struct({
  file: Schema.String,
  isEntry: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(false))),
  isDynamicEntry: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(false))),
  imports: Schema.Array(Schema.String).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
  css: Schema.Array(Schema.String).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
});
export const Manifest = Schema.Record(Schema.String, Chunk);
export type Manifest = typeof Manifest.Type;
export const SourceMap = Schema.Struct({
  sourceRoot: Schema.String.pipe(Schema.withDecodingDefaultKey(Effect.succeed(""))),
  sources: Schema.NonEmptyArray(Schema.String),
});

export class BundleBudgetError extends Schema.TaggedError<BundleBudgetError>()("BundleBudgetError", {
  reason: Schema.Literals([
    "MissingEntry",
    "MissingImport",
    "UnsafePath",
    "ExceededBudget",
    "ForbiddenSource",
    "MissingSourceMap",
  ]),
  detail: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message() {
    return `${this.reason}: ${this.detail}`;
  }
}

export const budgets = { initial: 200 * 1024, deferred: 180 * 1024 };
const safeAsset = (file: string) =>
  !file.startsWith("/") && !file.includes("\\") && !file.split("/").includes("..") && !file.includes(":");

export const assets = (
  manifest: Manifest,
  roots: readonly string[],
): Result.Result<readonly string[], BundleBudgetError> => {
  let pending = [...roots];
  let visited = HashSet.empty<string>();
  let files = HashSet.empty<string>();
  while (Array.isArrayNonEmpty(pending)) {
    const [key, ...remaining] = pending;
    pending = remaining;
    if (HashSet.has(visited, key)) continue;
    const chunk = Record.get(manifest, key);
    if (Option.isNone(chunk)) return Result.fail(new BundleBudgetError({ reason: "MissingImport", detail: key }));
    const emitted = [chunk.value.file, ...chunk.value.css];
    if (!emitted.every(safeAsset)) return Result.fail(new BundleBudgetError({ reason: "UnsafePath", detail: key }));
    visited = HashSet.add(visited, key);
    files = HashSet.union(files, HashSet.fromIterable(emitted));
    pending.push(...chunk.value.imports);
  }
  return Result.succeed([...files]);
};

export const budgetGroups = (manifest: Manifest) => {
  const initialRoots = Record.keys(Record.filter(manifest, chunk => chunk.isEntry));
  const deferredRoots = Record.keys(Record.filter(manifest, chunk => chunk.isDynamicEntry));
  if (initialRoots.length === 0 || deferredRoots.length === 0) {
    return Result.fail(
      new BundleBudgetError({
        reason: "MissingEntry",
        detail: "The initial entry and deferred renderer are required.",
      }),
    );
  }
  const deferred = assets(manifest, deferredRoots);
  if (Result.isFailure(deferred)) return Result.fail(deferred.failure);
  const groups: { readonly name: string; readonly files: readonly string[]; readonly maximumBytes: number }[] = [];
  for (const root of initialRoots) {
    const initial = assets(manifest, [root]);
    if (Result.isFailure(initial)) return Result.fail(initial.failure);
    groups.push({ name: `${root}: initial`, files: initial.success, maximumBytes: budgets.initial });
    groups.push({
      name: `${root}: deferred`,
      files: deferred.success.filter(file => !initial.success.includes(file)),
      maximumBytes: budgets.deferred,
    });
  }
  return Result.succeed(groups);
};
