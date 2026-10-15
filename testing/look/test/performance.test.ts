import { expect, test } from "bun:test";
import { Effect, Option, Schema } from "effect";
import { summarizeTimes } from "../performance";
import { BenchResult, CaptureConfiguration, fixedSeed, fixedTimeEpochMs } from "../protocol";
import { runTest } from "./_runtime";

test("phone summaries preserve missing samples and floor-index percentile convention", () =>
  runTest(Effect.gen(function*() {
    const result = yield* summarizeTimes([30, 10, 20, 40]);
    expect(Option.getOrElse(result.p50, () => -1)).toBe(20);
    expect(Option.getOrElse(result.p95, () => -1)).toBe(30);
    expect(Option.isNone((yield* summarizeTimes([])).p95)).toBe(true);
  })));

test("the capture contract rejects unsupported renderer choices and malformed measurements", () =>
  runTest(Effect.gen(function*() {
    const config: CaptureConfiguration = {
      technique: "B",
      backend: "webgl",
      theme: "day",
      rung: "building",
      dpr: 3,
      width: 390,
      height: 844,
      desks: 12,
      asset: "scene",
      seed: fixedSeed,
      fixedTimeEpochMs,
    };
    expect(yield* Schema.decodeEffect(CaptureConfiguration)(config)).toEqual(config);
    for (const change of [{ technique: "A" }, { backend: "webgpu" }, { dpr: 4 }, { width: 0 }]) {
      expect(
        yield* Schema.decodeUnknownEffect(CaptureConfiguration)({ ...config, ...change }).pipe(
          Effect.match({ onFailure: () => true, onSuccess: () => false }),
        ),
      ).toBe(true);
    }
    const valid: BenchResult = {
      frames: 120,
      warmupFrames: 10,
      cpuMs: [1],
      completedFrameMs: [2],
      gpu: BenchResult.fields.gpu.members[1].make({ reason: "No timer extension" }),
      drawCalls: 1,
      triangles: 1,
      targetBytes: 4,
      lineBufferBytes: 4,
    };
    expect(yield* Schema.decodeEffect(BenchResult)(valid)).toEqual(valid);
    for (
      const change of [{ cpuMs: [-1] }, { completedFrameMs: [Number.NaN] }, {
        gpu: { ...BenchResult.fields.gpu.members[0].make({ method: "timer-query", samplesMs: [1] }), samplesMs: [] },
      }]
    ) {
      expect(
        yield* Schema.decodeUnknownEffect(BenchResult)({ ...valid, ...change }).pipe(Effect.match({
          onFailure: () => true,
          onSuccess: () => false,
        })),
      ).toBe(true);
    }
  })));
