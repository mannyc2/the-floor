import { Schema } from "effect";

export const thresholds = {
  frameBudgetMs: 16.7,
  p95Ms: 18.5,
  p99Ms: 33.4,
  firstMeaningfulPaintMs: 2_000,
  readToPresentationP95Ms: 250,
  regressionRatio: 1.2,
  minimumDurationMs: 60_000,
} as const;
const distribution = Schema.Struct({
  medianMs: Schema.Finite,
  p95Ms: Schema.Finite,
  p99Ms: Schema.Finite,
  worstMs: Schema.Finite,
});
export const ReadingLatency = Schema.Struct({
  revision: Schema.Int,
  receivedAtMs: Schema.Finite,
  submittedAtMs: Schema.Finite,
  presentationAtMs: Schema.Finite,
});
export type ReadingLatency = typeof ReadingLatency.Type;
export const TierCounts = Schema.Struct({ stall: Schema.Int, works: Schema.Int, tower: Schema.Int });
export const BenchResult = Schema.Struct({
  scenario: Schema.String,
  synthetic: Schema.Literal(true),
  markets: Schema.Int,
  agents: Schema.Int,
  viewport: Schema.Struct({ width: Schema.Finite, height: Schema.Finite, pixelRatio: Schema.Finite }),
  cameraLevels: Schema.Array(Schema.Literals(["archipelago", "island", "district", "works", "machine"])),
  userAgent: Schema.String,
  scene: Schema.Struct({
    expectedTiers: TierCounts,
    maximumObservedTiers: TierCounts,
    maximumInstrumentTiers: TierCounts,
  }),
  workload: Schema.Struct({
    inputReadings: Schema.Int,
    emittedReadings: Schema.Int,
    appliedBatches: Schema.Int,
    expectedBatches: Schema.Int,
    launches: Schema.Int,
    expectedLaunches: Schema.Int,
    recordedSource: Schema.String,
    verifiedLiquidationReplay: Schema.Literal(false),
  }),
  scenePreparationMs: Schema.Finite,
  firstMeaningfulPaintMs: Schema.Finite,
  sampleCount: Schema.Int,
  elapsedMs: Schema.Finite,
  frameCadence: Schema.Struct({
    ...distribution.fields,
    estimatedFps: Schema.Finite,
    overBudget: Schema.Array(Schema.Struct({ atMs: Schema.Finite, durationMs: Schema.Finite })),
  }),
  rendering: Schema.Struct({ frameCount: Schema.Int, cpuSubmission: distribution }),
  readToPixel: Schema.Struct({
    measurement: Schema.Literal("submission-to-next-presentation-opportunity"),
    physicalPixelsVerified: Schema.Literal(false),
    samples: Schema.Int,
    supersededBatches: Schema.Int,
    unacknowledgedBatches: Schema.Int,
    revisions: Schema.Array(ReadingLatency),
    receiptToSubmission: distribution,
    receiptToPresentationOpportunity: distribution,
  }),
  renderer: Schema.Struct({
    framesPerSecond: Schema.Finite,
    frameTimeMs: Schema.Finite,
    drawCalls: Schema.Finite,
    triangles: Schema.Finite,
    parts: Schema.Finite,
    markets: Schema.Finite,
    detail: Schema.Finite,
    orangeParts: Schema.Finite,
    activeMarketId: Schema.NullOr(Schema.String),
    tierCounts: TierCounts,
    instrumentTierCounts: TierCounts,
  }),
  memory: Schema.Struct({
    jsHeapBytes: Schema.OptionFromNullOr(Schema.Finite),
    gpuBytes: Schema.OptionFromNullOr(Schema.Finite),
    gpuMeasurement: Schema.Literal("WebGL exposes allocation counts; byte size is unavailable"),
    geometries: Schema.Int,
    textures: Schema.Int,
  }),
  maxDrawCalls: Schema.Int,
  maxTriangles: Schema.Int,
  webglErrors: Schema.Array(Schema.String),
  target: Schema.Struct({
    fps: Schema.Literal(60),
    passesInThisBrowser: Schema.Boolean,
    phoneVerified: Schema.Literal(false),
    failures: Schema.Array(Schema.String),
  }),
});
export type BenchResult = typeof BenchResult.Type;
export const BenchReport = Schema.Struct({
  version: Schema.Literal(3),
  createdAt: Schema.String,
  methodology: Schema.String,
  thresholds: Schema.Struct({
    frameBudgetMs: Schema.Finite,
    p95Ms: Schema.Finite,
    p99Ms: Schema.Finite,
    firstMeaningfulPaintMs: Schema.Finite,
    readToPresentationP95Ms: Schema.Finite,
    regressionRatio: Schema.Finite,
    minimumDurationMs: Schema.Finite,
  }),
  reports: Schema.Array(BenchResult),
});
export type BenchReport = typeof BenchReport.Type;
export class BenchError extends Schema.TaggedError<BenchError>()("BenchError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

export const summarize = (values: readonly number[]): typeof distribution.Type => {
  const sorted = values.toSorted((a, b) => a - b);
  const percentile = (fraction: number) =>
    Number((sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0).toFixed(2));
  return { medianMs: percentile(0.5), p95Ms: percentile(0.95), p99Ms: percentile(0.99), worstMs: percentile(1) };
};

const sceneFailures = (report: BenchResult): readonly string[] => {
  const failures: string[] = [];
  for (const tier of ["stall", "works", "tower"] as const) {
    if (report.scene.maximumObservedTiers[tier] !== report.scene.expectedTiers[tier]) {
      failures.push(`The rendered ${tier} count does not match the requested workload`);
    }
    if (tier !== "stall" && report.scene.expectedTiers[tier] > 0 && report.scene.maximumInstrumentTiers[tier] === 0) {
      failures.push(`The camera never rendered a full ${tier} instrument`);
    }
  }
  return failures;
};

export function failuresFor(report: BenchResult): readonly string[] {
  const failures = [...sceneFailures(report)];
  if (new Set(report.cameraLevels).size !== 5) failures.push("The camera did not visit all five zoom levels");
  if (report.elapsedMs < thresholds.minimumDurationMs) failures.push("Sample is shorter than sixty seconds");
  if (report.frameCadence.p95Ms > thresholds.p95Ms) failures.push(`Frame p95 exceeds ${thresholds.p95Ms} ms`);
  if (report.frameCadence.p99Ms > thresholds.p99Ms) failures.push(`Frame p99 exceeds ${thresholds.p99Ms} ms`);
  if (report.firstMeaningfulPaintMs > thresholds.firstMeaningfulPaintMs) {
    failures.push("First meaningful atlas paint exceeds two seconds");
  }
  if (report.readToPixel.receiptToPresentationOpportunity.p95Ms > thresholds.readToPresentationP95Ms) {
    failures.push("Reading presentation p95 exceeds 250 ms");
  }
  if (report.readToPixel.samples === 0) failures.push("No reading reached a rendered presentation opportunity");
  if (
    report.readToPixel.samples !== report.workload.appliedBatches || report.readToPixel.supersededBatches > 0
    || report.readToPixel.unacknowledgedBatches > 0
    || report.readToPixel.revisions.length !== report.readToPixel.samples
  ) {
    failures.push("One or more applied reading batches lack a complete render and presentation acknowledgment");
  }
  if (
    new Set(report.readToPixel.revisions.map(reading => reading.revision)).size !== report.readToPixel.samples
    || report.readToPixel.revisions.some(reading =>
      reading.submittedAtMs < reading.receivedAtMs || reading.presentationAtMs < reading.submittedAtMs
    )
  ) {
    failures.push("Reading acknowledgments contain duplicate revisions or impossible timestamp ordering");
  }
  if (report.workload.appliedBatches < report.workload.expectedBatches) {
    failures.push("Input cadence fell behind the configured workload");
  }
  if (report.workload.launches !== report.workload.expectedLaunches) {
    failures.push("The launch workload did not complete");
  }
  if (report.webglErrors.length > 0) failures.push("Browser or WebGL errors were observed");
  return failures;
}

export function regressionsFor(current: BenchResult, baseline: BenchResult): readonly string[] {
  const metrics = [
    ["Frame p95", current.frameCadence.p95Ms, baseline.frameCadence.p95Ms],
    ["Frame p99", current.frameCadence.p99Ms, baseline.frameCadence.p99Ms],
    ["First meaningful paint", current.firstMeaningfulPaintMs, baseline.firstMeaningfulPaintMs],
    [
      "Reading presentation p95",
      current.readToPixel.receiptToPresentationOpportunity.p95Ms,
      baseline.readToPixel.receiptToPresentationOpportunity.p95Ms,
    ],
  ] as const;
  return metrics.flatMap(([name, value, prior]) =>
    prior > 0 && value > prior * thresholds.regressionRatio + 1
      ? [`${name} regressed more than 20% plus 1ms against the supplied baseline`]
      : []
  );
}

export function reportTable(report: BenchReport): string {
  return [
    "| Scenario | Actual stall / works / tower | p50 / p95 / p99 (ms) | Frames >16.7ms | Atlas paint (ms) | Reading p95 (ms) | Draws | Peak full works / towers | Result |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
    ...report.reports.map(result =>
      `| ${result.scenario} | ${result.scene.maximumObservedTiers.stall} / ${result.scene.maximumObservedTiers.works} / ${result.scene.maximumObservedTiers.tower} | ${result.frameCadence.medianMs} / ${result.frameCadence.p95Ms} / ${result.frameCadence.p99Ms} | ${result.frameCadence.overBudget.length} | ${result.firstMeaningfulPaintMs} | ${result.readToPixel.receiptToPresentationOpportunity.p95Ms} | ${result.maxDrawCalls} | ${result.scene.maximumInstrumentTiers.works} / ${result.scene.maximumInstrumentTiers.tower} | ${
        result.target.passesInThisBrowser ? "Pass" : result.target.failures.join("; ")
      } |`
    ),
  ].join("\n");
}
