import { BunServices } from "@effect/platform-bun";
import { expect, test } from "bun:test";
import { Effect, FileSystem, Path, Result, Schema } from "effect";
import { inspectModules } from "../graph";
import { BundleBudgetError, SourceMap, type Target } from "../model";
import { runTest } from "./_runtime";

const writeModule = Effect.fnUntraced(function*(directory: string, file: string, code: string, source: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fs.writeFileString(path.join(directory, file), code);
  const map = yield* Schema.encodeEffect(Schema.fromJsonString(SourceMap))({
    sources: [path.relative(directory, path.resolve(source))],
  });
  yield* fs.writeFileString(path.join(directory, `${file}.map`), map);
});

const targets: readonly Target[] = ["web", "floor", "signer"];
for (const target of targets) {
  test(`${target} emitted graph rejects oracle dependencies behind every supported edge`, () =>
    runTest(
      Effect.gen(function*() {
        const fs = yield* FileSystem.FileSystem;
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: "floor-oracle-graph-" });
        const edges = [
          "import './dependency.js';",
          "export * from './dependency.js';",
          "export { value } from './dependency.js';",
          "export const load = () => import('./dependency.js');",
          "export const load = () => import(`./dependency.js`);",
          "const value = require('./dependency.js');",
          "const value = require(`./dependency.js`);",
        ];
        for (const code of edges) {
          // Two hops prove the check follows transitive edges, rather than merely
          // checking the entry's map or trusting a permitted package's source.
          yield* writeModule(
            directory,
            "entry.js",
            "export * from './bridge.js';",
            "packages/wallets/src/privy/client.ts",
          );
          yield* writeModule(directory, "bridge.js", code, "packages/chains/src/solana/index.ts");
          for (
            const source of [
              "node_modules/@privy-io/node/index.mjs",
              "node_modules/svix/dist/index.js",
              "node_modules/@hpke/core/esm/mod.js",
              "node_modules/@hpke/chacha20poly1305/esm/mod.js",
            ]
          ) {
            yield* writeModule(directory, "dependency.js", "export const value = 1;", source);
            const result = yield* inspectModules({
              target,
              directory,
              entry: ["entry.js"],
              expectedFiles: ["entry.js", "bridge.js", "dependency.js"],
            }).pipe(Effect.result);
            expect(result).toEqual(
              Result.fail(new BundleBudgetError({ reason: "ForbiddenSource", detail: `${target}: ${source}` })),
            );
          }
          yield* writeModule(
            directory,
            "dependency.js",
            "export const value = 1;",
            "packages/wallets/src/privy/authorization.ts",
          );
          const clean = yield* inspectModules({
            target,
            directory,
            entry: ["entry.js"],
            expectedFiles: ["entry.js", "bridge.js", "dependency.js"],
          });
          expect(clean).toEqual({ modules: 3, mappedSources: 3 });
          for (const dependency of ["@privy-io/node", "svix", "@hpke/core", "@hpke/chacha20poly1305"]) {
            yield* writeModule(
              directory,
              "bridge.js",
              code.replaceAll("./dependency.js", dependency),
              "packages/chains/src/solana/index.ts",
            );
            const external = yield* inspectModules({ target, directory, entry: ["entry.js"] }).pipe(Effect.result);
            expect(external).toEqual(
              Result.fail(
                new BundleBudgetError({ reason: "InvalidModule", detail: `Unbundled dependency ${dependency}` }),
              ),
            );
          }
        }
      }).pipe(
        Effect.scoped,
        // oxlint-disable-next-line effecttsgo/strict-effect-provide -- This test owns the native filesystem and crypto services used to inspect emitted artifacts.
        Effect.provide(BunServices.layer),
      ),
    ));
}
