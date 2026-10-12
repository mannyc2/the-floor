import { BunServices } from "@effect/platform-bun";
import { expect, test } from "@playwright/test";
import { Config, Effect, FileSystem, Path, Schema, Stream } from "effect";
import { ChildProcess } from "effect/process";
import { Sha256 } from "../../look/protocol";

class LookCheckFailure extends Schema.TaggedError<LookCheckFailure>()("LookCheckFailure", {
  command: Schema.String,
  exitCode: Schema.Int,
  output: Schema.String,
}) {}

const runCommand = Effect.fn("LookFlow.runCommand")(function*(arguments_: ReadonlyArray<string>, output: string) {
  const fs = yield* FileSystem.FileSystem, path = yield* Path.Path;
  const cwd = yield* path.fromFileUrl(new URL("../../../", import.meta.url));
  const child = yield* ChildProcess.make("bun", arguments_, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    forceKillAfter: "10 seconds",
  });
  const text = yield* child.all.pipe(Stream.decodeText(), Stream.mkString);
  const exitCode = yield* child.exitCode;
  yield* fs.writeFileString(output, text);
  if (exitCode !== 0) {
    return yield* new LookCheckFailure({ command: arguments_.join(" "), exitCode, output: text });
  }
  return text;
}, Effect.scoped);

const PositiveCount = Schema.Int.check(Schema.isGreaterThan(0));
const StrokeEvidence = Schema.Struct({
  thresholdWidthCssPx: Schema.Finite,
  nearestRunDistanceCssPx: Schema.Finite,
  integratedDarknessCssPx: Schema.Finite,
  withinOnePlusMinusQuarter: Schema.Boolean,
});
const Metrics = Schema.Struct({
  sourceSceneSha256: Sha256,
  approval: Schema.TaggedStruct("SyntheticUnapproved", {}),
  primitiveValidation: Schema.Struct({ cases: Schema.Literal(9), failures: Schema.Literal(0) }),
  // A completed capture can still lack a usable target or cylinder region.
  // Require measured evidence in every cell without inventing art cutoffs.
  cells: Schema.Array(Schema.Struct({
    id: Schema.NonEmptyString,
    status: Schema.Literal("measured"),
    repeatable: Schema.Literal(true),
    againstTarget: Schema.Struct({
      status: Schema.Literal("measured"),
      predictionPixels: PositiveCount,
      targetPixels: PositiveCount,
      exactF1: Schema.Finite,
      tolerantF1: Schema.Finite,
      exactPrecision: Schema.Finite,
      exactRecall: Schema.Finite,
      tolerantPrecision: Schema.Finite,
      tolerantRecall: Schema.Finite,
    }),
    cylinderWidth: StrokeEvidence,
    targetCylinderWidth: StrokeEvidence,
    cylinderInterior: Schema.Struct({
      status: Schema.Literal("measured"),
      fractionOfRoi: Schema.Finite,
      horizontalScanRows: PositiveCount,
      meanFalseCrossingsPer100CssPx: Schema.Finite,
    }),
  })),
  summary: Schema.Struct({
    measuredCells: Schema.Literal(18),
    unmeasuredCells: Schema.Literal(0),
    localStrokeWidthFailures: Schema.Literal(0),
  }),
});
const Phone = Schema.Array(Schema.Struct({
  status: Schema.Literal("measured"),
  samples: Schema.Struct({
    frames: Schema.Literal(120),
    warmupFrames: Schema.Literal(10),
    cpuMs: Schema.Array(Schema.Finite),
    completedFrameMs: Schema.Array(Schema.Finite),
  }),
  cpu: Schema.Struct({ count: Schema.Literal(120), p95: Schema.Finite, cpuBudget16_7ms: Schema.Literal(true) }),
  completedFrame: Schema.Struct({ count: Schema.Literal(120), p95: Schema.Finite }),
  gpu: Schema.Struct({ _tag: Schema.Literals(["Unavailable", "Measured"]) }),
}));

test(
  "real renderer captures match verified synthetic targets and preserve missing art approval",
  ({ baseURL }, info) => {
    test.setTimeout(600_000);
    const output = info.outputPath("look");
    const url = new URL("/look/", baseURL).href;
    return Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem;
      yield* fs.makeDirectory(output, { recursive: true });
      yield* runCommand([
        "apps/web/workbench/generate-targets.ts",
        "--url",
        url,
        "--out",
        `${output}/targets`,
      ], `${output}/targets.log`);
      yield* runCommand([
        "testing/look/run.ts",
        "--mode",
        "matrix",
        "--url",
        url,
        "--renderer",
        "swiftshader",
        "--repetitions",
        "20",
        "--out",
        `${output}/matrix`,
      ], `${output}/matrix.log`);
      yield* runCommand([
        "testing/look/measure.ts",
        "--captures",
        `${output}/matrix`,
        "--targets",
        `${output}/targets`,
        "--primitive-report",
        `${output}/targets/primitives.json`,
        "--out",
        `${output}/metrics`,
      ], `${output}/metrics.log`);
      yield* runCommand([
        "testing/look/run.ts",
        "--mode",
        "impostor",
        "--url",
        url,
        "--renderer",
        "swiftshader",
        "--out",
        `${output}/impostor`,
      ], `${output}/impostor.log`);
      const metrics = yield* fs.readFileString(`${output}/metrics/metrics.json`).pipe(
        Effect.flatMap(Schema.decodeEffect(Schema.fromJsonString(Metrics))),
      );
      expect(metrics.summary.measuredCells).toBe(18);
      expect(metrics.cells).toHaveLength(18);
      expect(new Set(metrics.cells.map((cell) => cell.id)).size).toBe(18);
      expect(metrics.primitiveValidation.cases).toBe(9);
    }).pipe(
      // oxlint-disable-next-line effecttsgo/strict-effect-provide -- This Playwright boundary owns local process and evidence-file services for the real look pipeline.
      Effect.provide(BunServices.layer),
      // oxlint-disable-next-line effect/noEffectRunInTests -- Playwright owns the native Promise boundary for this Effect-driven browser pipeline.
      Effect.runPromise,
    );
  },
);

test("configured phone profile retains actual CPU and completed-frame samples", ({ baseURL }, info) => {
  test.setTimeout(180_000);
  const output = info.outputPath("phone");
  const url = new URL("/look/", baseURL).href;
  return Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem;
    const renderer = yield* Config.Literals(["apple", "swiftshader"], "FLOOR_PHONE_RENDERER").pipe(
      Config.withDefault("swiftshader"),
    );
    yield* runCommand([
      "testing/look/run.ts",
      "--mode",
      "phone",
      "--url",
      url,
      "--renderer",
      renderer,
      "--out",
      output,
    ], info.outputPath("phone.log"));
    const measurements = yield* fs.readFileString(`${output}/results.json`).pipe(
      Effect.flatMap(Schema.decodeEffect(Schema.fromJsonString(Phone))),
    );
    expect(measurements).toHaveLength(2);
    for (const measurement of measurements) {
      expect(measurement.samples.cpuMs).toHaveLength(120);
      expect(measurement.samples.completedFrameMs).toHaveLength(120);
    }
  }).pipe(
    // oxlint-disable-next-line effecttsgo/strict-effect-provide -- This Playwright boundary owns the local browser process and retained phone-profile evidence.
    Effect.provide(BunServices.layer),
    // oxlint-disable-next-line effect/noEffectRunInTests -- Playwright owns the native Promise boundary for the measured hardware profile.
    Effect.runPromise,
  );
});
