import { expect, test } from "bun:test";
import { Option, Result, Schema } from "effect";
import { budgetGroups, Manifest } from "../model";

const manifest = (input: typeof Manifest.Encoded) => Option.getOrThrow(Schema.decodeOption(Manifest)(input));

test("200/180 KiB budgets include shared CSS and exclude initial assets from deferred cost", () => {
  const graph = manifest({
    main: { file: "main.js", isEntry: true, imports: ["shared"] },
    shared: { file: "shared.js", imports: ["main"], css: ["main.css"] },
    renderer: { file: "renderer.js", isDynamicEntry: true, imports: ["shared"] },
  });
  const result = budgetGroups(graph);
  expect(Result.isSuccess(result)).toBe(true);
  if (Result.isFailure(result)) return;
  expect(result.success.map(group => ({ ...group, files: group.files.toSorted() }))).toEqual([
    { name: "main: initial", files: ["main.css", "main.js", "shared.js"], maximumBytes: 204800 },
    { name: "main: deferred", files: ["renderer.js"], maximumBytes: 184320 },
  ]);
});

test("missing imports, escaping emitted files and missing renderer fail", () => {
  for (
    const main of [
      { file: "main.js", isEntry: true, imports: ["missing"] },
      { file: "../outside.js", isEntry: true },
    ]
  ) {
    expect(Result.isFailure(budgetGroups(manifest({
      main,
      renderer: { file: "renderer.js", isDynamicEntry: true },
    })))).toBe(true);
  }
  expect(Result.isFailure(budgetGroups(manifest({ main: { file: "main.js", isEntry: true } })))).toBe(true);
});
