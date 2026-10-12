import { Array, Effect, HashSet, Option, Record, Result, Schema } from "effect";
import { isTestingPath } from "../lint/paths";

const Chunk = Schema.Struct({
  file: Schema.String,
  isEntry: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(false))),
  isDynamicEntry: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(false))),
  imports: Schema.Array(Schema.String).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
  dynamicImports: Schema.Array(Schema.String).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
  css: Schema.Array(Schema.String).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
});
export const Manifest = Schema.Record(Schema.String, Chunk);
export type Manifest = typeof Manifest.Type;
// Generated maps currently omit sourceRoot or use an empty prefix. Reject other
// prefixes until they are explicitly resolved; ignoring one changes source authority.
export const SourceMap = Schema.Struct({
  sourceRoot: Schema.optional(Schema.Literal("")),
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
    "InvalidModule",
  ]),
  detail: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message() {
    return `${this.reason}: ${this.detail}`;
  }
}

export const budgets = { initial: 200 * 1024, deferred: 180 * 1024 };
export type Profile = "shell" | "complete";
export type Target = "web" | "floor" | "signer";
const safeAsset = (file: string) =>
  !file.startsWith("/") && !file.includes("\\") && !file.split("/").includes("..") && !file.includes(":");

export const assets = (
  manifest: Manifest,
  roots: readonly string[],
  dynamic: boolean,
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
    pending.push(...chunk.value.imports, ...(dynamic ? chunk.value.dynamicImports : []));
  }
  return Result.succeed([...files]);
};

export const budgetGroups = (manifest: Manifest, profile: Profile) => {
  const initialRoots = Record.keys(Record.filter(manifest, chunk => chunk.isEntry));
  const deferredRoots = Record.keys(Record.filter(manifest, chunk => chunk.isDynamicEntry));
  if (initialRoots.length === 0 || (profile === "complete" && deferredRoots.length === 0)) {
    return Result.fail(
      new BundleBudgetError({
        reason: "MissingEntry",
        detail: "Initial entry required; complete profile also requires the deferred renderer.",
      }),
    );
  }
  const deferred = assets(manifest, deferredRoots, false);
  if (Result.isFailure(deferred)) return Result.fail(deferred.failure);
  const groups: { readonly name: string; readonly files: readonly string[]; readonly maximumBytes: number }[] = [];
  for (const root of initialRoots) {
    const initial = assets(manifest, [root], false);
    if (Result.isFailure(initial)) return Result.fail(initial.failure);
    groups.push({ name: `${root}: initial`, files: initial.success, maximumBytes: budgets.initial });
    if (deferredRoots.length > 0) {
      groups.push({
        name: `${root}: deferred`,
        files: deferred.success.filter(file => !initial.success.includes(file)),
        maximumBytes: budgets.deferred,
      });
    }
  }
  return Result.succeed(groups);
};

// Source-map paths are normalized by the caller against the repository root.
// Inspect every reachable module, including modules hidden behind a permitted package export.
export const inspectSources = (
  target: Target,
  sources: readonly string[],
): Result.Result<boolean, BundleBudgetError> => {
  for (const source of sources) {
    const path = source.replaceAll("\\", "/");
    const parts = path.split("/");
    const fixture = isTestingPath(path) || parts.includes("workbench");
    const legacy =
      /(?:^|\/)(?:effect-cf|@solana\/web3\.js|@coral-xyz\/anchor|bn\.js|@meteora-ag\/dynamic-bonding-curve-sdk)(?:@[^/]+)?\//
        .test(path);
    const three = /(?:^|\/)(?:three|three-mesh-bvh|three-edge-projection)(?:@[^/]+)?\//.test(path);
    const inference = /(?:^|\/)(?:@yielded\/|@effect\/ai-|@anthropic-ai\/|openai\/|effect\/[^/]*\/ai\/|apps\/floor\/)/
      .test(path);
    if (fixture || legacy || (target !== "web" && three) || (target === "signer" && inference)) {
      return Result.fail(new BundleBudgetError({ reason: "ForbiddenSource", detail: `${target}: ${source}` }));
    }
  }
  return Result.succeed(true);
};
