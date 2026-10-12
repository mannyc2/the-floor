import { expect, test } from "bun:test";
import { Option, Result, Schema } from "effect";
import { moduleImports } from "../imports";
import { SourceMap } from "../model";

test("emitted static, literal dynamic and CommonJS edges remain visible", () => {
  const result = moduleImports(
    `import './a.js'; export * from './b.js'; export { value } from './c.js';
    export const lazy = () => import('./d.js'); const nested = () => { require('./e.js'); };`,
    "entry.js",
  );
  expect(Result.isSuccess(result)).toBe(true);
  if (Result.isFailure(result)) return;
  expect(result.success).toEqual(["./a.js", "./b.js", "./c.js", "./d.js", "./e.js"]);
});

test("computed dependencies and invalid emitted JavaScript fail closed", () => {
  for (
    const source of [
      "const file = './lazy.js'; export const load = () => import(file)",
      "const file = './lazy.js'; export const load = () => require(file)",
      "export const load = name => import(`./${name}.js`)",
      "const value = require()",
      "export const = invalid",
    ]
  ) expect(Result.isFailure(moduleImports(source, "entry.js"))).toBe(true);
  expect(Result.isSuccess(moduleImports("const note = 'import(file)'; // require(file)", "entry.js"))).toBe(true);
});

test("source map authority cannot hide behind a prefix or an empty source list", () => {
  const decode = Schema.decodeUnknownOption(SourceMap);
  expect(Option.isSome(decode({ sources: ["entry.ts"] }))).toBe(true);
  expect(Option.isSome(decode({ sourceRoot: "", sources: ["entry.ts"] }))).toBe(true);
  expect(Option.isNone(decode({ sourceRoot: "../../../../apps/floor/src", sources: ["worker.ts"] }))).toBe(true);
  expect(Option.isNone(decode({ sources: [] }))).toBe(true);
});

test("expression-free template imports are literal dependency edges", () => {
  const result = moduleImports(
    "export const load = () => import(`./literal.js`); const helper = require(`node:fs`)",
    "entry.js",
  );
  expect(Result.isSuccess(result)).toBe(true);
  if (Result.isFailure(result)) return;
  expect(result.success).toEqual(["./literal.js", "node:fs"]);
});
