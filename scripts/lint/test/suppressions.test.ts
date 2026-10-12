import { expect, test } from "bun:test";
import { Result } from "effect";
import { countSuppressions } from "../suppressions";

const lineComment = (content: string) => ["//", content].join(" ");
const blockComment = (content: string) => ["/*", content, "*/"].join(" ");
const effectDirective = ["@effect", "diagnostics"].join("-");
const file = "apps/web/src/example.ts";

test("ESLint suppression aliases cannot bypass the explicit budget", () => {
  for (const name of ["eslint-disable", "eslint-disable-line", "eslint-disable-next-line"]) {
    for (const comment of [lineComment, blockComment]) {
      for (const reason of ["", " -- A reviewed native callback owns this boundary."]) {
        const result = countSuppressions(file, comment(`${name} no-debugger${reason}`));
        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) {
          expect(result.failure.message).toContain("ESLint suppression aliases are disabled");
        }
      }
    }
  }
});

test("native lint and Effect exceptions remain reasoned and counted", () => {
  const result = countSuppressions(
    file,
    [
      lineComment("oxlint-disable-next-line no-debugger -- A reviewed native callback owns this boundary."),
      lineComment(`${effectDirective}-next-line asyncFunction:off -- The test host requires a native callback.`),
    ].join("\n"),
  );
  expect(Result.isSuccess(result)).toBe(true);
  if (Result.isSuccess(result)) expect(result.success).toEqual({ oxlint: 1, effect: 1 });
  for (const directive of ["oxlint-disable-next-line no-debugger", `${effectDirective} asyncFunction:off`]) {
    expect(Result.isFailure(countSuppressions(file, lineComment(directive)))).toBe(true);
  }
  const plain = countSuppressions(file, "export const value = 1;");
  expect(Result.isSuccess(plain)).toBe(true);
  if (Result.isSuccess(plain)) expect(plain.success).toEqual({ oxlint: 0, effect: 0 });
});
