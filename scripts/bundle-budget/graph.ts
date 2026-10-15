import { Effect, FileSystem, Path, Schema } from "effect";
import { BundleBudgetError, SourceMap } from "./model";

// Inspect every artifact, including lazy chunks. Maps identify bundled code;
// emitted text also catches SDK imports deliberately left external by a bundler.
const forbidden = /(?:^|[/\\'"`])(?:workbench|@privy-io\/node|svix|@hpke\/[^/@'"`\s]+)(?:@[^/'"`\s]+)?(?:[/\\'"`]|$)/;

export const inspectModules = Effect.fn("BundleModules.inspect")(function*(directory: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const files = yield* fs.readDirectory(directory, { recursive: true });
  const maps = files.filter(file => /\.[cm]?js\.map$/.test(file));
  if (maps.length === 0) return yield* new BundleBudgetError({ reason: "MissingSourceMap", detail: directory });
  for (const file of files.filter(name => /\.[cm]?js$/.test(name))) {
    const code = yield* fs.readFileString(path.join(directory, file));
    if (forbidden.test(code)) return yield* new BundleBudgetError({ reason: "ForbiddenSource", detail: file });
  }
  for (const file of maps) {
    const map = yield* fs.readFileString(path.join(directory, file)).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(SourceMap))),
    );
    for (const source of map.sources) {
      if (forbidden.test(`${map.sourceRoot}/${source}`.replaceAll("\\", "/"))) {
        return yield* new BundleBudgetError({ reason: "ForbiddenSource", detail: `${file}: ${source}` });
      }
    }
  }
  yield* Effect.logInfo(`${directory}: ${maps.length} source maps inspected`);
  return void 0;
});
