import { Array, Effect, HashSet, Option, Record, Result, Schema } from "effect";

const ManifestChunk = Schema.Struct({
  file: Schema.String,
  isEntry: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(false))),
  isDynamicEntry: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(false))),
  imports: Schema.Array(Schema.String).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
  css: Schema.Array(Schema.String).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
});
export const Manifest = Schema.Record(Schema.String, ManifestChunk);
export type Manifest = typeof Manifest.Type;

export class BundleBudgetError extends Schema.TaggedError<BundleBudgetError>()("BundleBudgetError", {
  message: Schema.String,
}) {}

const staticAssets = (
  manifest: Manifest,
  roots: readonly string[],
): Result.Result<HashSet.HashSet<string>, BundleBudgetError> => {
  let pending = [...roots];
  let visited = HashSet.empty<string>();
  let files = HashSet.empty<string>();
  while (Array.isArrayNonEmpty(pending)) {
    const [key, ...remaining] = pending;
    pending = remaining;
    if (HashSet.has(visited, key)) continue;
    const chunk = Record.get(manifest, key);
    if (Option.isNone(chunk)) return Result.fail(new BundleBudgetError({ message: `Missing manifest import: ${key}` }));
    visited = HashSet.add(visited, key);
    files = HashSet.union(files, HashSet.fromIterable([chunk.value.file, ...chunk.value.css]));
    pending.push(...chunk.value.imports);
  }
  return Result.succeed(files);
};

interface BudgetGroup {
  readonly name: string;
  readonly files: readonly string[];
  readonly maximumBytes: number;
}

export const budgetGroups = (manifest: Manifest): Result.Result<readonly BudgetGroup[], BundleBudgetError> => {
  const initialRoots = Record.keys(Record.filter(manifest, (chunk) => chunk.isEntry));
  const deferredRoots = Record.keys(Record.filter(manifest, (chunk) => chunk.isDynamicEntry));
  if (initialRoots.length === 0 || deferredRoots.length === 0) {
    return Result.fail(
      new BundleBudgetError({ message: "The build must contain its initial entry and deferred renderer entry." }),
    );
  }
  const deferred = staticAssets(manifest, deferredRoots);
  if (Result.isFailure(deferred)) return Result.fail(deferred.failure);
  const groups: BudgetGroup[] = [];
  for (const root of initialRoots) {
    const initial = staticAssets(manifest, [root]);
    if (Result.isFailure(initial)) return Result.fail(initial.failure);
    const prefix = initialRoots.length > 1 ? `${root}: ` : "";
    // A gate renderer has its own entry; its eager imports cannot erase the main page's deferred download cost.
    groups.push(
      { name: `${prefix}Initial JavaScript + CSS`, files: [...initial.success], maximumBytes: 200 * 1024 },
      {
        name: `${prefix}Deferred JavaScript + CSS`,
        files: [...HashSet.difference(deferred.success, initial.success)],
        maximumBytes: 180 * 1024,
      },
    );
  }
  return Result.succeed(groups);
};
