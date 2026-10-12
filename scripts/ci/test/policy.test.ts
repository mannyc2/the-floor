import { expect, test } from "bun:test";
import { Option, Schema } from "effect";
import { PreviewStage, ProjectStage, TemporaryStage } from "../../../stacks/_lib/policy";

test("preview cleanup can address only a positive PR number", () => {
  const decode = Schema.decodeOption(PreviewStage);
  for (const name of ["pr-1", "pr-9324"]) expect(Option.isSome(decode(name))).toBe(true);
  for (
    const name of [
      "prod",
      "production",
      "dev",
      "admin",
      "stage0-proof",
      "pr-0",
      "pr--1",
      "pr-1/../../prod",
      "pr-1; echo x",
      "pr-1\n",
      "pr-9999999999",
    ]
  ) {
    expect(Option.isNone(decode(name))).toBe(true);
  }
});

test("the root stack accepts explicit development or temporary stages only", () => {
  for (const name of ["dev", "pr-2", "stage0-proof"]) {
    expect(Option.isSome(Schema.decodeOption(ProjectStage)(name))).toBe(true);
  }
  for (const name of ["prod", "main", "default", "admin", "stage0-", "stage0-proof/x"]) {
    expect(Option.isNone(Schema.decodeOption(ProjectStage)(name))).toBe(true);
  }
  expect(Option.isNone(Schema.decodeOption(TemporaryStage)("pr-2"))).toBe(true);
});
