import type { DriverExpression } from "@floor/contract";
import { Result, Schema } from "effect";

export class DriverError extends Schema.TaggedError<DriverError>()("DriverError", { message: Schema.String }) {}

export function driverProblems(
  expression: DriverExpression,
  allowed: readonly string[],
  depth = 0,
  budget = { remaining: 256 },
): readonly string[] {
  if (depth > 16 || --budget.remaining < 0) return ["Driver exceeds expression budget"];
  if (expression.op === "reading") {
    return allowed.includes(expression.name)
      ? []
      : [`Driver reads undeclared value: ${expression.name}`];
  }
  if (expression.op === "time" || expression.op === "constant") return [];
  const expected = expression.op === "sin" || expression.op === "ease" ? 1 : expression.op === "clamp" ? 3 : 2;
  if (expression.args.length !== expected) return [`${expression.op} expects ${expected} operands`];
  return expression.args.flatMap((argument) => driverProblems(argument, allowed, depth + 1, budget));
}
const operations = {
  add: (a: number, b: number, _c: number) => a + b,
  multiply: (a: number, b: number, _c: number) => a * b,
  min: (a: number, b: number, _c: number) => Math.min(a, b),
  max: (a: number, b: number, _c: number) => Math.max(a, b),
  clamp: (a: number, b: number, c: number) => Math.min(c, Math.max(b, a)),
  sin: (a: number, _b: number, _c: number) => Math.sin(a),
  step: (a: number, b: number, _c: number) => b < a ? 0 : 1,
  ease: (a: number, _b: number, _c: number) => {
    const bounded = Math.max(0, Math.min(1, a));
    return bounded * bounded * (3 - 2 * bounded);
  },
};
export function evaluateDriver(
  expression: DriverExpression,
  values: Readonly<Record<string, number>>,
  seconds: number,
): Result.Result<number, DriverError> {
  const problems = driverProblems(expression, Object.keys(values));
  if (problems.length > 0) return Result.fail(new DriverError({ message: problems.join("; ") }));
  const evaluate = (node: DriverExpression): number => {
    if (node.op === "constant") return node.value;
    if (node.op === "time") return seconds;
    if (node.op === "reading") return values[node.name] ?? 0;
    const args = node.args.map(evaluate);
    return operations[node.op](args[0] ?? 0, args[1] ?? 0, args[2] ?? 0);
  };
  const result = evaluate(expression);
  return Number.isFinite(result)
    ? Result.succeed(result)
    : Result.fail(new DriverError({ message: "Driver produced a non-finite reading" }));
}
