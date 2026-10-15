import { BunServices } from "@effect/platform-bun";
import { expect, test } from "@playwright/test";
import { Config, Effect, FileSystem, Path, Schema, Stream } from "effect";
import { ChildProcess } from "effect/process";

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
    Effect.provide(BunServices.layer),
    Effect.runPromise,
  );
});
