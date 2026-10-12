import { Array, Crypto, Effect, FileSystem, HashSet, Option, Path, Result, Schema } from "effect";
import * as Hex from "effect/encoding/Hex";
import { generatedModuleSha256 } from "./generated";
import { moduleImports } from "./imports";
import { BundleBudgetError, inspectSources, SourceMap, type Target } from "./model";

const inspectMap = Effect.fn("BundleModules.inspectMap")(function*(target: Target, file: string, code: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const mapFile = `${file}.map`;
  if (!(yield* fs.exists(mapFile))) {
    const crypto = yield* Crypto.Crypto;
    const digest = Hex.encode(yield* crypto.digest("SHA-256", new TextEncoder().encode(code)));
    if (!generatedModuleSha256.has(digest)) {
      return yield* new BundleBudgetError({ reason: "MissingSourceMap", detail: file });
    }
    return 0;
  }
  const map = yield* fs.readFileString(mapFile).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(SourceMap))),
  );
  if (map.sources.length === 0) return yield* new BundleBudgetError({ reason: "MissingSourceMap", detail: file });
  const sources = map.sources.map(source =>
    path.relative(path.resolve("."), path.resolve(path.dirname(mapFile), source))
  );
  const result = inspectSources(target, sources);
  if (Result.isFailure(result)) return yield* result.failure;
  return sources.length;
});

// oxlint-disable-next-line effecttsgo/api-stability-leak -- This host-only build utility deliberately requires platform services; it is never an application package export.
export const inspectModules = Effect.fn("BundleModules.inspect")(
  function*({ target, directory, entry, expectedFiles }: {
    readonly target: Target;
    readonly directory: string;
    readonly entry: readonly string[];
    readonly expectedFiles?: readonly string[];
  }) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = path.resolve(directory);
    let pending = entry.map(file => path.resolve(root, file));
    let visited = HashSet.empty<string>();
    let mappedSources = 0;
    while (Array.isArrayNonEmpty(pending)) {
      const [file, ...remaining] = pending;
      pending = remaining;
      if (HashSet.has(visited, file)) continue;
      visited = HashSet.add(visited, file);
      const relative = path.relative(root, file);
      if (relative === ".." || relative.startsWith("../") || path.isAbsolute(relative)) {
        return yield* new BundleBudgetError({ reason: "UnsafePath", detail: file });
      }
      if (Option.exists(Option.fromUndefinedOr(expectedFiles), files => !files.includes(relative))) {
        return yield* new BundleBudgetError({ reason: "MissingImport", detail: `Manifest omits ${relative}` });
      }
      if (!(yield* fs.exists(file))) return yield* new BundleBudgetError({ reason: "MissingEntry", detail: file });
      const code = yield* fs.readFileString(file);
      const imports = yield* Effect.fromResult(moduleImports(code, file));
      for (const dependency of imports) {
        if (dependency.startsWith(".")) pending.push(path.resolve(path.dirname(file), dependency));
        else if (!dependency.startsWith("node:") && dependency !== "cloudflare:workers") {
          return yield* new BundleBudgetError({
            reason: "InvalidModule",
            detail: `Unbundled dependency ${dependency}`,
          });
        }
      }
      mappedSources += yield* inspectMap(target, file, code);
    }
    return { modules: HashSet.size(visited), mappedSources };
  },
);
