import { describe, expect, it } from "@effect/vitest";
import { Array, Effect, Option } from "effect";
import { type BenchResult, failuresFor, regressionsFor, summarize } from "../result";

const distribution = { medianMs: 8, p95Ms: 16, p99Ms: 16, worstMs: 20 };
const measured: BenchResult = {
  scenario: "1k",
  synthetic: true,
  markets: 1_000,
  agents: 2_000,
  viewport: { width: 1440, height: 900, pixelRatio: 1 },
  cameraLevels: ["archipelago", "island", "district", "works", "machine"],
  userAgent: "Benchmark gate fixture",
  scene: {
    expectedTiers: { stall: 800, works: 180, tower: 20 },
    maximumObservedTiers: { stall: 800, works: 180, tower: 20 },
    maximumInstrumentTiers: { stall: 0, works: 10, tower: 2 },
  },
  workload: {
    inputReadings: 240_000,
    emittedReadings: 240_000,
    appliedBatches: 240,
    expectedBatches: 240,
    launches: 0,
    expectedLaunches: 0,
    recordedSource: "Gate fixture",
    verifiedLiquidationReplay: false,
  },
  scenePreparationMs: 20,
  firstMeaningfulPaintMs: 300,
  sampleCount: 3600,
  elapsedMs: 60_000,
  frameCadence: { ...distribution, estimatedFps: 60, overBudget: [] },
  rendering: { frameCount: 300, cpuSubmission: distribution },
  readToPixel: {
    measurement: "submission-to-next-presentation-opportunity",
    physicalPixelsVerified: false,
    samples: 240,
    supersededBatches: 0,
    unacknowledgedBatches: 0,
    revisions: Array.makeBy(
      240,
      revision => ({
        revision,
        receivedAtMs: revision * 250,
        submittedAtMs: revision * 250 + 10,
        presentationAtMs: revision * 250 + 20,
      }),
    ),
    receiptToSubmission: distribution,
    receiptToPresentationOpportunity: distribution,
  },
  renderer: {
    framesPerSecond: 0,
    frameTimeMs: 3,
    drawCalls: 40,
    triangles: 1000,
    parts: 1000,
    markets: 1000,
    detail: 1,
    orangeParts: 1,
    activeMarketId: Option.getOrNull(Option.some("fixture")),
    tierCounts: { stall: 800, works: 180, tower: 20 },
    instrumentTierCounts: { stall: 0, works: 0, tower: 0 },
  },
  memory: {
    jsHeapBytes: Option.some(1_000_000),
    gpuBytes: Option.none(),
    gpuMeasurement: "WebGL exposes allocation counts; byte size is unavailable",
    geometries: 10,
    textures: 0,
  },
  maxDrawCalls: 40,
  maxTriangles: 1000,
  webglErrors: [],
  target: { fps: 60, passesInThisBrowser: false, phoneVerified: false, failures: [] },
};

describe("Benchmark evidence gates", () => {
  it.effect("rejects a substituted tier scene even when performance passes", () =>
    Effect.sync(() => {
      expect(
        failuresFor({
          ...measured,
          scene: { ...measured.scene, maximumObservedTiers: { stall: 976, works: 21, tower: 3 } },
        }),
      ).toContain("The rendered works count does not match the requested workload");
      expect(
        failuresFor({
          ...measured,
          scene: { ...measured.scene, maximumInstrumentTiers: { stall: 0, works: 0, tower: 0 } },
        }),
      ).toContain("The camera never rendered a full tower instrument");
      expect(failuresFor({ ...measured, firstMeaningfulPaintMs: 2001 })).toContain(
        "First meaningful atlas paint exceeds two seconds",
      );
    }));
  it.effect("rejects missing batch evidence even when measured frame and latency percentiles pass", () =>
    Effect.sync(() => {
      expect(failuresFor(measured)).toEqual([]);
      const missing = {
        ...measured,
        readToPixel: {
          ...measured.readToPixel,
          samples: 239,
          unacknowledgedBatches: 1,
          revisions: measured.readToPixel.revisions.slice(0, 239),
        },
      };
      expect(failuresFor(missing)).toContain(
        "One or more applied reading batches lack a complete render and presentation acknowledgment",
      );
      expect(failuresFor({ ...measured, workload: { ...measured.workload, appliedBatches: 239 } })).toContain(
        "Input cadence fell behind the configured workload",
      );
    }));
  it.effect("rejects duplicate revisions and presentation timestamps earlier than submission", () =>
    Effect.sync(() => {
      const duplicate = {
        ...measured,
        readToPixel: {
          ...measured.readToPixel,
          revisions: measured.readToPixel.revisions.map(reading => ({ ...reading, revision: 1 })),
        },
      };
      expect(failuresFor(duplicate)).toContain(
        "Reading acknowledgments contain duplicate revisions or impossible timestamp ordering",
      );
      const impossible = {
        ...measured,
        readToPixel: {
          ...measured.readToPixel,
          revisions: measured.readToPixel.revisions.map(reading => ({
            ...reading,
            presentationAtMs: reading.receivedAtMs,
          })),
        },
      };
      expect(failuresFor(impossible)).toContain(
        "Reading acknowledgments contain duplicate revisions or impossible timestamp ordering",
      );
    }));
  it.effect("applies the baseline regression limit independently of absolute frame limits", () =>
    Effect.sync(() => {
      const fast = { ...measured, frameCadence: { ...measured.frameCadence, p95Ms: 8, p99Ms: 8 } };
      expect(failuresFor(measured)).toEqual([]);
      expect(regressionsFor(measured, fast)).toEqual([
        "Frame p95 regressed more than 20% plus 1ms against the supplied baseline",
        "Frame p99 regressed more than 20% plus 1ms against the supplied baseline",
      ]);
      expect(regressionsFor(measured, measured)).toEqual([]);
    }));
  it.effect("keeps the long frame in p99 and the worst-frame metric", () =>
    Effect.sync(() => {
      expect(summarize([...Array.makeBy(98, () => 8), 70, 120])).toEqual({
        medianMs: 8,
        p95Ms: 8,
        p99Ms: 70,
        worstMs: 120,
      });
    }));
});
