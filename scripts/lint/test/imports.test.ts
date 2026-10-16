import { BunServices } from "@effect/platform-bun";
import { expect, test } from "bun:test";
import { Effect, FileSystem, Option, Path, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import configuration from "../../../.oxlintrc.json";
import { runTest } from "./_runtime";

const execute = Effect.fnUntraced(function*(command: ChildProcess.Command) {
  const child = yield* (yield* ChildProcessSpawner.ChildProcessSpawner).spawn(command);
  return yield* Effect.all({
    output: child.stdout.pipe(Stream.decodeText(), Stream.mkString),
    error: child.stderr.pipe(Stream.decodeText(), Stream.mkString),
    code: child.exitCode,
  }, { concurrency: "unbounded" });
});
const Output = Schema.Struct({ diagnostics: Schema.Array(Schema.Struct({ filename: Schema.String })) });
const forms = (source: string) => [
  `import '${source}';`,
  `import type { Value } from '${source}';`,
  `export * from '${source}';`,
  `export { value } from '${source}';`,
  `const load = () => import('${source}');`,
  `import value = require('${source}');`,
];
const cases = [
  {
    owner: "packages/contract/src",
    blocked: ["viem", "@floor/chains", "../../chains/src/index"],
    allowed: ["effect", "effect/Schema", "./identifiers", "@floor/contract"],
  },
  {
    owner: "apps/signer/src",
    blocked: [
      "openai",
      "@anthropic-ai/sdk",
      "@yielded/agent",
      "@effect/ai-openai",
      "effect/ai/LanguageModel",
      "@floor/app-floor",
    ],
    allowed: ["@floor/wallets", "effect", "@solana/kit"],
  },
  {
    owner: "packages/world/src",
    blocked: ["three", "three/webgpu", "three-mesh-bvh", "three-edge-projection"],
    allowed: ["effect", "@floor/contract"],
  },
  {
    owner: "apps/web/src",
    blocked: [
      "@floor/chains/testing",
      "../../workbench/entry",
      "./action.test",
      "./fixtures/input",
      "@yielded/agent-testing",
    ],
    allowed: ["three", "three/webgpu", "@floor/atlas"],
  },
  {
    owner: "packages/wallets/src",
    blocked: [
      "@privy-io/node",
      "@privy-io/node/authorization",
      "svix",
      "@hpke/core",
      "../../node_modules/@privy-io/node/index.mjs",
      "effect-cf",
      "@solana/web3.js",
      "@coral-xyz/anchor",
      "bn.js",
      "@meteora-ag/dynamic-bonding-curve-sdk",
      "@whetstone-research/doppler-sdk",
    ],
    allowed: ["effect/http/HttpClient", "@privy-io/node-other", "svix-other"],
  },
  {
    owner: "packages/wallets/test",
    blocked: ["@privy-io/node/solana-kit", "@privy-io/node/lib/solana-kit.mjs"],
    allowed: ["@privy-io/node", "svix", "@hpke/core"],
  },
  {
    owner: "apps/floor/src/testing",
    blocked: ["@privy-io/node/solana-kit", "three", "@yielded/agent-testing", "./fixtures/input"],
    allowed: [],
  },
  {
    owner: "apps/web/src/testing",
    blocked: ["@privy-io/node/solana-kit"],
    allowed: ["three", "./fixtures/input"],
  },
  {
    owner: "packages/contract/src/testing",
    blocked: ["@privy-io/node/solana-kit", "three", "bun:test"],
    allowed: ["@floor/contract", "./fixtures/input"],
  },
  { owner: "apps/web/workbench", blocked: ["@privy-io/node/solana-kit"], allowed: ["three", "three-edge-projection"] },
];
const fixtures = [
  ...cases.flatMap(({ owner, blocked, allowed }) =>
    [...blocked.map(source => ({ source, forbidden: true })), ...allowed.map(source => ({ source, forbidden: false }))]
      .flatMap(({ source, forbidden }, index) =>
        forms(source).map((text, form) => ({
          file: `${owner}/fixture-${index}-${form}.ts`,
          text,
          forbidden,
        }))
      )
  ),
  ...["apps/floor/src", "packages/wallets/test"].flatMap(owner =>
    [
      "type Oracle = import('@privy-io/node').PrivyClient;",
      "const oracle = require('@privy-io/node');",
      "const load = () => import(`@privy-io/node`);",
      "const target = '@privy-io/node'; const load = () => import(target);",
    ].map((text, index) => ({ file: `${owner}/opaque-${index}.ts`, text, forbidden: true }))
  ),
  ...["tsx", "js", "jsx", "mts", "cts", "mjs", "cjs"].map(extension => ({
    file: `packages/wallets/src/extension.${extension}`,
    text: "import '@privy-io/node';",
    forbidden: true,
  })),
];

test("configured import boundaries cover native forms, opaque forms and source extensions", () =>
  runTest(
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const workspace = yield* path.fromFileUrl(new URL("../../../", import.meta.url));
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "floor-imports-" });
      yield* fs.symlink(path.join(workspace, "node_modules"), path.join(directory, "node_modules"));
      const compiled = yield* execute(ChildProcess.make("bun", [
        "build",
        path.join(workspace, "scripts/lint/plugin.ts"),
        "--target=node",
        "--external",
        "effect",
        "--external",
        "effect-oxlint",
        "--outfile",
        path.join(directory, "plugin.mjs"),
      ], { cwd: workspace, forceKillAfter: "5 seconds" }));
      expect(compiled.code).toBe(ChildProcessSpawner.ExitCode(0));
      const config = {
        categories: { correctness: "off" },
        jsPlugins: [{ name: "floor", specifier: "./plugin.mjs" }],
        rules: {
          "no-restricted-imports": configuration.rules["no-restricted-imports"],
          "floor/app-isolation": "error",
          "floor/feature-isolation": "error",
        },
        overrides: configuration.overrides.flatMap(override =>
          Option.toArray(Option.map(
            Option.fromUndefinedOr(override.rules["no-restricted-imports"]),
            rule => ({ files: override.files, rules: { "no-restricted-imports": rule } }),
          ))
        ),
      };
      yield* fs.writeFileString(
        path.join(directory, "oxlint.json"),
        yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Json))(config),
      );
      for (const fixture of fixtures) {
        const file = path.join(directory, fixture.file);
        yield* fs.makeDirectory(path.dirname(file), { recursive: true });
        yield* fs.writeFileString(file, fixture.text);
      }
      const result = yield* execute(ChildProcess.make(path.join(workspace, "node_modules/.bin/oxlint"), [
        "--config",
        "oxlint.json",
        "--no-ignore",
        "--format",
        "json",
        "apps",
        "packages",
      ], { cwd: directory, forceKillAfter: "5 seconds" }));
      expect(result.error).toBe("");
      expect(result.code).toBe(ChildProcessSpawner.ExitCode(1));
      const output = yield* Schema.decodeEffect(Schema.fromJsonString(Output))(result.output);
      expect(fixtures.map(({ file }) => output.diagnostics.some(diagnostic => diagnostic.filename === file)))
        .toEqual(fixtures.map(({ forbidden }) => forbidden));
    }),
    BunServices.layer,
  ), 15000);
