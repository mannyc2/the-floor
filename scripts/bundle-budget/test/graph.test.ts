import { BunServices } from "@effect/platform-bun";
import { expect, test } from "bun:test";
import { Effect, FileSystem, Path, Result, Schema } from "effect";
import { inspectModules } from "../graph";
import { SourceMap } from "../model";
import { runTest } from "./_runtime";

test("all artifact maps and emitted imports exclude workbench, the development world, the layout proposal and the wallet SDK", () =>
  runTest(
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "floor-artifacts-" });
      const writeMap = (source: string, sourceRoot = "") =>
        Schema.encodeEffect(Schema.fromJsonString(SourceMap))({ sources: [source], sourceRoot }).pipe(
          Effect.flatMap(text => fs.writeFileString(path.join(directory, "lazy.js.map"), text)),
        );
      expect(Result.isFailure(yield* inspectModules(directory).pipe(Effect.result))).toBe(true);
      yield* writeMap("packages/wallets/src/privy/client.ts");
      yield* fs.writeFileString(path.join(directory, "entry.js"), "export const value = 1;");
      yield* inspectModules(directory);
      for (
        const source of [
          "apps/web/workbench/entry.ts",
          "apps/web/dev-world/layout.ts",
          "../../../../apps/web/dev-world/banner.ts",
          "packages/world/src/proposal.ts",
          "../../../../packages/world/src/proposal.ts",
          "node_modules/@privy-io/node/index.mjs",
          "node_modules/@privy-io/node@0.35.0/index.mjs",
          "node_modules/svix/dist/index.js",
          "node_modules\\@hpke\\core\\esm\\mod.js",
        ]
      ) {
        yield* writeMap(source);
        expect(Result.isFailure(yield* inspectModules(directory).pipe(Effect.result))).toBe(true);
      }
      yield* writeMap("entry.ts", "../../apps/web/workbench");
      expect(Result.isFailure(yield* inspectModules(directory).pipe(Effect.result))).toBe(true);
      yield* writeMap("proposal.ts", "../../packages/world/src");
      expect(Result.isFailure(yield* inspectModules(directory).pipe(Effect.result))).toBe(true);
      // The adopted layout seam and other world modules remain allowed.
      for (const source of ["packages/world/src/layout.ts", "packages/world/src/proposals-index.ts"]) {
        yield* writeMap(source);
        yield* inspectModules(directory);
      }
      for (
        const source of [
          "packages/api/src/mcp.ts",
          "node_modules/effect/src/ai/McpServer.ts",
          "node_modules/effect/dist/cjs/ai/internal/mcpProtocol/v2026_07_28.js",
        ]
      ) {
        yield* writeMap(source);
        expect(Result.isFailure(yield* inspectModules(directory, "web").pipe(Effect.result))).toBe(true);
        yield* inspectModules(directory, "worker");
      }
      yield* writeMap("packages/wallets/src/privy/client.ts");
      for (
        const dependency of ["./workbench/entry.js", "./dev-world/banner.js", "@privy-io/node", "svix", "@hpke/core"]
      ) {
        for (
          const code of [
            `import '${dependency}';`,
            `export * from '${dependency}';`,
            `export { value } from '${dependency}';`,
            `export const load = () => import('${dependency}');`,
            `export const load = () => import(\`${dependency}\`);`,
            `const value = require('${dependency}');`,
            `const value = require(\`${dependency}\`);`,
          ]
        ) {
          yield* fs.writeFileString(path.join(directory, "entry.js"), code);
          expect(Result.isFailure(yield* inspectModules(directory).pipe(Effect.result))).toBe(true);
        }
      }
      yield* fs.writeFileString(
        path.join(directory, "entry.js"),
        "import '@privy-io/node-other'; import 'svix-other';",
      );
      yield* inspectModules(directory);
    }).pipe(
      Effect.scoped,
      Effect.provide(BunServices.layer),
    ),
  ));
