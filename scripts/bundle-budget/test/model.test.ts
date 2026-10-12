import { expect, test } from "bun:test";
import { Option, Result, Schema } from "effect";
import { assets, budgetGroups, inspectSources, Manifest } from "../model";

const decode = Schema.decodeUnknownOption(Manifest);
const manifest = (input: typeof Manifest.Encoded) => Option.getOrThrow(decode(input));

test("static graph handles shared CSS, cycles and per-entry deferred cost", () => {
  const graph = manifest({
    main: { file: "main.js", isEntry: true, imports: ["shared"] },
    shared: { file: "shared.js", imports: ["main"], css: ["main.css"] },
    renderer: { file: "renderer.js", isDynamicEntry: true, imports: ["shared"] },
  });
  const result = budgetGroups(graph, "complete");
  expect(Result.isSuccess(result)).toBe(true);
  if (Result.isFailure(result)) return;
  expect(result.success.map(group => ({ ...group, files: group.files.toSorted() }))).toEqual([
    { name: "main: initial", files: ["main.css", "main.js", "shared.js"], maximumBytes: 204800 },
    { name: "main: deferred", files: ["renderer.js"], maximumBytes: 184320 },
  ]);
});

test("missing imports, escaping emitted files and missing renderer fail closed", () => {
  for (
    const value of [{ main: { file: "main.js", isEntry: true, imports: ["missing"] } }, {
      main: { file: "../outside.js", isEntry: true },
    }]
  ) {
    expect(Result.isFailure(budgetGroups(manifest(value), "shell"))).toBe(true);
  }
  const shell = manifest({ main: { file: "main.js", isEntry: true } });
  expect(Result.isSuccess(budgetGroups(shell, "shell"))).toBe(true);
  expect(Result.isFailure(budgetGroups(shell, "complete"))).toBe(true);
});

test("transitive dynamic modules are included in authority inspection", () => {
  const graph = manifest({
    main: { file: "main.js", isEntry: true, dynamicImports: ["renderer"] },
    renderer: { file: "renderer.js", dynamicImports: ["lazy"] },
    lazy: { file: "lazy.js" },
  });
  const result = assets(graph, ["main"], true);
  expect(Result.isSuccess(result)).toBe(true);
  if (Result.isFailure(result)) return;
  expect(result.success.toSorted()).toEqual(["lazy.js", "main.js", "renderer.js"]);
  for (
    const source of [
      "node_modules/@yielded/agent/dist/index.mjs",
      "node_modules/@effect/ai-anthropic/dist/index.js",
      "node_modules/openai/index.mjs",
      "apps/floor/src/worker.ts",
    ]
  ) {
    expect(Result.isFailure(inspectSources("signer", ["packages/chains/src/evm.ts", source]))).toBe(true);
  }
  expect(Result.isFailure(inspectSources("floor", ["node_modules/three/src/Three.js"]))).toBe(true);
  expect(Result.isSuccess(inspectSources("web", ["node_modules/three/src/Three.js"]))).toBe(true);
  for (
    const source of [
      "packages/chains/src/testing/index.ts",
      "apps/web/workbench/entry.ts",
      "testing/recordings/model.json",
      "packages/chains/src/input.test",
      "packages/chains/src/input.spec.ts",
    ]
  ) {
    expect(Result.isFailure(inspectSources("web", [source]))).toBe(true);
  }
});
