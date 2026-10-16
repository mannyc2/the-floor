import { BunRuntime } from "@effect/platform-bun";
import { Console, Effect, Schema } from "effect";
import { inspectGeneratedAssets } from "./_lib/asset-corners";
import { AssetRuleReport } from "./_lib/asset-rules";

class AssetPreflightFailure extends Schema.TaggedError<AssetPreflightFailure>()("AssetPreflightFailure", {
  failures: Schema.Array(Schema.Struct({ asset: Schema.String, quarterTurn: Schema.Int, rule: Schema.String })),
}) {}

const Report = Schema.Array(Schema.Struct({ asset: Schema.String, quarterTurn: Schema.Int, report: AssetRuleReport }));

const program = Effect.gen(function*() {
  const reports = yield* inspectGeneratedAssets;
  yield* Console.log(yield* Schema.encodeEffect(Schema.fromJsonString(Report))(reports));
  const failures = reports.flatMap(({ asset, quarterTurn, report }) =>
    report.checks.flatMap(check => check.status === "Failed" ? [{ asset, quarterTurn, rule: check.rule }] : [])
  );
  if (failures.length > 0) return yield* new AssetPreflightFailure({ failures });
  return yield* Console.log(`${reports.length} model/theme/corner reports passed every measured rule.`);
});

BunRuntime.runMain(program.pipe(Effect.tapError(Console.error)), { disableErrorReporting: true });
