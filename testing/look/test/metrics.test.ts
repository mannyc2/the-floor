import { expect, test } from "bun:test";
import { Effect, Option, Schema } from "effect";
import { areaAverageImpostor } from "../impostor";
import { cylinderDensity, cylinderWidth, scores } from "../metrics";
import { summarizeTimes } from "../performance";
import { compareRgba, erodeRegion, expandDisk, grayscaleOnWhite, thresholdMask } from "../pixels";
import { decodePng, encodeGrayscalePng } from "../png";
import { BenchResult, CaptureConfiguration, matrixConfigurations } from "../protocol";
import { validateConvexSilhouette } from "../silhouettes";
import { runTest } from "./_runtime";

const repeated = (length: number, value: number) => Array.from({ length }, () => value);
const raster = (width: number, height: number, values: ReadonlyArray<number>) => ({
  width,
  height,
  data: new Uint8Array(values),
});

test("alpha compositing precedes the half-dark mask threshold", () =>
  runTest(Effect.gen(function*() {
    const gray = yield* grayscaleOnWhite(raster(4, 1, [0, 0, 0, 0, 0, 0, 0, 128, 255, 0, 0, 255, 0, 255, 0, 255]));
    expect([...gray.data]).toEqual([255, 127, 76, 150]);
    expect([...(yield* thresholdMask(gray)).data]).toEqual([0, 1, 1, 0]);
  })));

test("tolerance is an integer Euclidean disk and scales by DPR", () =>
  runTest(Effect.gen(function*() {
    const center = raster(5, 5, repeated(25, 0));
    center.data[12] = 1;
    const one = yield* expandDisk(center, 1), two = yield* expandDisk(center, 2);
    expect(one.data.reduce((sum, value) => sum + value, 0)).toBe(5);
    expect(one.data[6]).toBe(0);
    expect(two.data.reduce((sum, value) => sum + value, 0)).toBe(13);
    const shifted = raster(5, 5, repeated(25, 0));
    shifted.data[14] = 1;
    const near = yield* scores(shifted, center, 2), far = yield* scores(shifted, center, 1);
    expect(Option.getOrElse(near.exactF1, () => -1)).toBe(0);
    expect(Option.getOrElse(near.tolerantF1, () => -1)).toBe(1);
    expect(Option.getOrElse(far.tolerantF1, () => -1)).toBe(0);
  })));

test("empty masks never produce a vacuous perfect score", () =>
  runTest(Effect.gen(function*() {
    const empty = raster(2, 1, [0, 0]), one = raster(2, 1, [1, 0]);
    expect(Option.isNone((yield* scores(empty, empty, 1)).exactF1)).toBe(true);
    expect(Option.getOrElse((yield* scores(empty, one, 1)).exactF1, () => -1)).toBe(0);
    expect(Option.isNone((yield* scores(one, empty, 1)).tolerantF1)).toBe(true);
  })));

test("mismatched and malformed rasters fail before index arithmetic", () =>
  runTest(Effect.gen(function*() {
    for (
      const operation of [
        scores(raster(2, 1, [0, 0]), raster(1, 2, [0, 0]), 1),
        scores(raster(2, 1, [0]), raster(2, 1, [0, 0]), 1),
        scores(raster(2, 1, [0, 2]), raster(2, 1, [0, 0]), 1),
      ]
    ) {
      expect(yield* operation.pipe(Effect.match({ onFailure: (error) => error._tag, onSuccess: () => "unexpected" })))
        .toBe("MeasurementError");
    }
  })));

test("cylinder density counts contiguous false runs, excludes nearby target lines, and preserves missing ROI", () =>
  runTest(Effect.gen(function*() {
    const prediction = raster(8, 1, [1, 1, 0, 1, 0, 0, 1, 0]), target = raster(8, 1, [0, 0, 0, 1, 0, 0, 0, 0]);
    const region = raster(8, 1, [1, 1, 1, 1, 1, 1, 1, 1]);
    const measured = yield* cylinderDensity(prediction, target, region, 1);
    expect(measured.falseLinePixels).toBe(3);
    expect(measured.falseRunCrossings).toBe(2);
    expect(Option.getOrElse(measured.meanFalseCrossingsPer100CssPx, () => -1)).toBe(25);
    const missing = yield* cylinderDensity(prediction, target, raster(8, 1, repeated(8, 0)), 1);
    expect(missing.status).toBe("empty_roi");
    expect(Option.isNone(missing.meanFalseCrossingsPer100CssPx)).toBe(true);
  })));

test("ROI erosion removes the two-CSS-pixel boundary before measurement", () =>
  runTest(Effect.gen(function*() {
    const data = new Uint8Array(49);
    for (let y = 1; y <= 5; y += 1) for (let x = 1; x <= 5; x += 1) data[y * 7 + x] = 1;
    const eroded = yield* erodeRegion({ width: 7, height: 7, data }, 1);
    expect(eroded.data.reduce((sum, value) => sum + value, 0)).toBe(1);
    expect(eroded.data[24]).toBe(1);
  })));

test("stroke width is measured in CSS pixels and preserves Python ties-to-even sampling", () =>
  runTest(Effect.gen(function*() {
    const gray = raster(12, 3, repeated(36, 255));
    gray.data[4] = 0;
    gray.data[5] = 0;
    const result = yield* cylinderWidth(gray, { x: 4.5, y: 0.5 }, 2);
    expect(result.rasterRow).toBe(0);
    expect(result.thresholdWidthCssPx).toBe(1);
    expect(result.integratedDarknessCssPx).toBe(1);
    expect(result.withinOnePlusMinusQuarter).toBe(true);
    const missing = yield* cylinderWidth(raster(12, 1, repeated(12, 255)), { x: 5, y: 0 }, 1);
    expect(missing.thresholdWidthCssPx).toBe(0);
    expect(Option.isNone(missing.nearestRunDistanceCssPx)).toBe(true);
  })));

test("repeatability examines every RGBA channel and pixel", () =>
  runTest(Effect.gen(function*() {
    const first = raster(2, 1, [0, 0, 0, 255, 255, 255, 255, 255]),
      second = raster(2, 1, [0, 0, 0, 255, 255, 253, 255, 254]);
    expect(yield* compareRgba(first, second)).toEqual({ changedPixelFraction: 0.5, maxChannelDelta: 2 });
  })));

test("area averaging exposes thin-line loss and never invents survival for empty masks", () =>
  runTest(Effect.gen(function*() {
    const high = raster(4, 4, [0, 255, 255, 255, 0, 255, 255, 255, 0, 255, 255, 255, 0, 255, 255, 255]);
    const result = yield* areaAverageImpostor(high, raster(1, 1, [0]), 4);
    expect([...result.image.data]).toEqual([191]);
    expect(result.highResolutionEdgePixels).toBe(4);
    expect(Option.getOrElse(result.edgeSurvivalFraction, () => -1)).toBe(0);
    const empty = yield* areaAverageImpostor(raster(4, 4, repeated(16, 255)), raster(1, 1, [255]), 4);
    expect(Option.isNone(empty.edgeSurvivalFraction)).toBe(true);
    expect(Option.isNone(empty.directToBakedCoverage)).toBe(true);
  })));

test("phone summaries preserve missing samples and floor-index percentile convention", () =>
  runTest(Effect.gen(function*() {
    const result = yield* summarizeTimes([30, 10, 20, 40]);
    expect(Option.getOrElse(result.p50, () => -1)).toBe(20);
    expect(Option.getOrElse(result.p95, () => -1)).toBe(30);
    expect(Option.isNone((yield* summarizeTimes([])).p95)).toBe(true);
  })));

test("independent convex silhouette checks detect missing and outside edges", () =>
  runTest(Effect.gen(function*() {
    const a = { x: 0, y: 0 }, b = { x: 2, y: 0 }, c = { x: 2, y: 2 }, d = { x: 0, y: 2 };
    const edges = [{ a, b }, { a: b, b: c }, { a: c, b: d }, { a: d, b: a }];
    expect((yield* validateConvexSilhouette([a, b, c, d], edges)).pass).toBe(true);
    expect((yield* validateConvexSilhouette([a, b, c, d], edges.slice(1))).pass).toBe(false);
    expect((yield* validateConvexSilhouette([a, b, c, d], [...edges, { a: { x: -1, y: 0 }, b: a }])).pass).toBe(false);
  })));

test("the capture contract rejects unsupported renderer choices and malformed measurements", () =>
  runTest(Effect.gen(function*() {
    const configurations = matrixConfigurations();
    expect(configurations.length).toBe(18);
    expect(new Set(configurations.map((config) => `${config.theme}-${config.rung}-${config.dpr}`)).size).toBe(18);
    for (const config of configurations) {
      expect(yield* Schema.decodeEffect(CaptureConfiguration)(config)).toEqual(config);
    }
    for (const change of [{ technique: "A" }, { backend: "webgpu" }, { dpr: 4 }, { width: 0 }]) {
      expect(
        yield* Schema.decodeUnknownEffect(CaptureConfiguration)({ ...configurations[0], ...change }).pipe(
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

test("PNG encoding retains every grayscale byte used by metrics", () =>
  runTest(Effect.gen(function*() {
    const input = raster(6, 1, [0, 1, 127, 128, 254, 255]);
    const bytes = yield* encodeGrayscalePng(input);
    expect(yield* grayscaleOnWhite(yield* decodePng(bytes))).toEqual(input);
    expect(
      yield* decodePng(new Uint8Array([0, 1, 2])).pipe(Effect.match({
        onFailure: (error) => error._tag,
        onSuccess: () => "unexpected",
      })),
    ).toBe("PngError");
  })));
