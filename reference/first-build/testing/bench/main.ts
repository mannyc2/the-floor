import { BrowserRuntime } from "@effect/platform-browser";
import { chooseOrange, type MarketTier } from "@floor/districts";
import { MarketRecording } from "@floor/markets/schema";
import { type AtlasMarket, type AtlasRenderer, type AtlasZoom, createAtlasRenderer } from "@floor/renderer";
import { Effect, Option, Result, Schema } from "effect";
import capturedDay from "../recordings/base-day.json";
import { BenchError, BenchResult, failuresFor, type ReadingLatency, summarize, thresholds } from "./result";
import { type BenchScenario, generateScenario, nextBatch, scenarios, scenarioTiers } from "./scenarios";

declare global {
  interface Window {
    floorBench?: { run: () => Promise<typeof BenchResult.Encoded>; ready: true };
  }
}

// oxlint-disable-next-line effect/noGlobals -- Renderer completion and RAF presentation callbacks share this browser timestamp origin.
const browserNow = (): number => performance.now();
const heapMemory = Schema.Struct({ memory: Schema.Struct({ usedJSHeapSize: Schema.Finite }) });
const jsHeap = (): Option.Option<number> => {
  // Unsupported browsers report None rather than an invented memory allocation.
  return Option.map(Schema.decodeUnknownOption(heapMemory)(performance), value => value.memory.usedJSHeapSize);
};

function cameraStep(
  renderer: AtlasRenderer,
  observations: readonly AtlasMarket[],
  tiers: readonly MarketTier[],
  step: number,
): void {
  if (step === 0) renderer.zoomOut();
  else if (step === 1) renderer.resetView();
  else if (step === 2 || step === 3 || step === 4) renderer.zoomIn();
  else if (step === 5) {
    renderer.focus(
      Option.getOrNull(Option.map(
        Option.fromUndefinedOr(
          tiers.find(tier => tier.tier === "works" && observations.some(market => market.id === tier.marketId)),
        ),
        tier => tier.marketId,
      )),
    );
  } else if (step === 6) {
    renderer.focus(
      Option.getOrNull(Option.map(
        Option.fromUndefinedOr(
          tiers.find(tier => tier.tier === "tower" && observations.some(market => market.id === tier.marketId)),
        ),
        tier => tier.marketId,
      )),
    );
    renderer.setExploded(true);
  } else {
    renderer.setExploded(false);
    renderer.resetView();
  }
}

interface Sample {
  readonly frames: readonly number[];
  readonly overBudget: readonly { readonly atMs: number; readonly durationMs: number }[];
  readonly elapsedMs: number;
  readonly inputReadings: number;
  readonly emittedReadings: number;
  readonly appliedBatches: number;
  readonly launches: number;
}

/** RAF measures presentation opportunities while real district batches force renderer work at four updates per second. */
const sampleFrames = (
  renderer: AtlasRenderer,
  scenario: BenchScenario,
  initial: readonly AtlasMarket[],
  tiers: readonly MarketTier[],
  onReceipt: (revision: number, receivedAtMs: number) => void,
) =>
  Effect.callback<Sample, BenchError>((resume) => {
    const durationMs = thresholds.minimumDurationMs;
    const slots = initial.map((market, slot) => ({ marketId: market.id, slot }));
    const frames: number[] = [];
    const overBudget: { atMs: number; durationMs: number }[] = [];
    let observations = scenario.launches > 0 ? [] : initial;
    let start = Option.none<number>();
    let last = 0;
    let step = -1;
    let scheduledBatch = 0;
    let appliedBatches = 0;
    let inputReadings = 0;
    let emittedReadings = 0;
    let launches = 0;
    let pending = 0;
    const frame = (now: number): void => {
      if (Option.isNone(start)) {
        start = Option.some(now);
        last = now;
      } else {
        const duration = now - last;
        frames.push(duration);
        if (Number(duration.toFixed(3)) > thresholds.frameBudgetMs) {
          overBudget.push({
            atMs: Number((now - Option.getOrElse(start, () => now)).toFixed(2)),
            durationMs: Number(duration.toFixed(3)),
          });
        }
      }
      last = now;
      const elapsedMs = now - Option.getOrElse(start, () => now);
      const nextStep = Math.min(7, Math.floor(elapsedMs / (durationMs / 8)));
      if (nextStep !== step) {
        step = nextStep;
        cameraStep(renderer, observations, tiers, step);
      }
      const due = Math.min(durationMs / 250, Math.floor(elapsedMs / 250));
      if (due > scheduledBatch) {
        scheduledBatch = due;
        const receivedAtMs = browserNow();
        const batch = nextBatch(scenario, initial, observations, due, Math.min(elapsedMs, durationMs));
        observations = batch.markets;
        const active = chooseOrange(
          observations.map(market => ({ id: market.id, valueMoving: market.valueMovingUsd ?? 0 })),
        );
        const revision = due + 1;
        onReceipt(revision, receivedAtMs);
        const outcome = renderer.setData({
          markets: observations,
          slots,
          tiers,
          activeMarketId: Option.getOrNull(active),
          revision,
        });
        if (Result.isFailure(outcome)) {
          resume(Effect.fail(new BenchError({ message: outcome.failure.message })));
          return;
        }
        inputReadings += batch.inputReadings;
        emittedReadings += batch.emittedReadings;
        launches = batch.launches;
        appliedBatches++;
      }
      if (elapsedMs >= durationMs) {
        resume(
          Effect.succeed({ frames, overBudget, elapsedMs, inputReadings, emittedReadings, appliedBatches, launches }),
        );
        return;
      }
      pending = requestAnimationFrame(frame);
    };
    pending = requestAnimationFrame(frame);
    return Effect.sync(() => cancelAnimationFrame(pending));
  });

const program = Effect.gen(function*() {
  const host = yield* Effect.fromOption(Option.fromNullishOr(document.getElementById("atlas"))).pipe(
    Effect.mapError(() => new BenchError({ message: "The bench drawing host is absent" })),
  );
  const scenario = yield* Effect.fromOption(
    Option.fromUndefinedOr(
      scenarios.find(item => item.name === new URLSearchParams(location.search).get("scenario")) ?? scenarios[0],
    ),
  ).pipe(
    Effect.mapError(() => new BenchError({ message: "The bench scenario is absent" })),
  );
  const recording = yield* Schema.decodeUnknownEffect(MarketRecording)(capturedDay);
  const initial = generateScenario(scenario, recording);
  const tiers = scenarioTiers(scenario, initial);
  const scenarioLabel = document.getElementById("scenario");
  if (scenarioLabel) scenarioLabel.textContent = scenario.description;
  const status = document.getElementById("status");
  const errors: string[] = [];
  const submissions: number[] = [];
  const receiptToSubmission: number[] = [];
  const receiptToPresentation: number[] = [];
  const revisions: ReadingLatency[] = [];
  const cameraLevels = new Set<AtlasZoom>();
  const receipts = new Map<number, number>();
  const presentationCallbacks = new Set<number>();
  let firstMeaningfulPaint = Option.none<number>();
  let maximumDrawCalls = 0;
  let maximumTriangles = 0;
  let maxGeometries = 0;
  let maxTextures = 0;
  let supersededBatches = 0;
  const maximumObservedTiers = { stall: 0, works: 0, tower: 0 };
  const maximumInstrumentTiers = { stall: 0, works: 0, tower: 0 };
  let sampling = false;
  const renderer = yield* Effect.acquireRelease(
    Effect.try({
      try: () =>
        createAtlasRenderer(host, {
          allowSynthetic: true,
          onFrame: frame => {
            for (const tier of ["stall", "works", "tower"] as const) {
              maximumObservedTiers[tier] = Math.max(maximumObservedTiers[tier], frame.stats.tierCounts[tier]);
              maximumInstrumentTiers[tier] = Math.max(
                maximumInstrumentTiers[tier],
                frame.stats.instrumentTierCounts[tier],
              );
            }
            if (sampling) submissions.push(frame.stats.frameTimeMs);
            maximumDrawCalls = Math.max(maximumDrawCalls, frame.stats.drawCalls);
            maximumTriangles = Math.max(maximumTriangles, frame.stats.triangles);
            maxGeometries = Math.max(maxGeometries, frame.memory.geometries);
            maxTextures = Math.max(maxTextures, frame.memory.textures);
            const received = Option.fromUndefinedOr(receipts.get(frame.revision));
            if (Option.isSome(received)) {
              receiptToSubmission.push(frame.renderedAtMs - received.value);
              for (const revision of receipts.keys()) {
                if (revision < frame.revision) {
                  receipts.delete(revision);
                  supersededBatches++;
                }
              }
              receipts.delete(frame.revision);
            }
            if (Option.isSome(received) || (Option.isNone(firstMeaningfulPaint) && frame.stats.markets > 0)) {
              const pending = requestAnimationFrame(() => {
                const now = browserNow();
                presentationCallbacks.delete(pending);
                if (Option.isSome(received)) {
                  receiptToPresentation.push(now - received.value);
                  revisions.push({
                    revision: frame.revision,
                    receivedAtMs: received.value,
                    submittedAtMs: frame.renderedAtMs,
                    presentationAtMs: now,
                  });
                }
                if (Option.isNone(firstMeaningfulPaint) && frame.stats.markets > 0) {
                  firstMeaningfulPaint = Option.some(now);
                }
              });
              presentationCallbacks.add(pending);
            }
            if (status) {
              status.textContent =
                `${frame.stats.markets.toLocaleString()} markets · ${frame.stats.parts.toLocaleString()} parts · ${frame.stats.drawCalls} draws · ${
                  frame.stats.frameTimeMs.toFixed(1)
                } ms CPU submission`;
            }
          },
          onError: error => errors.push(error.message),
          onViewChange: view => cameraLevels.add(view.level),
        }),
      catch: cause => new BenchError({ message: "The bench renderer could not start", cause }),
    }),
    value =>
      Effect.sync(() => {
        value.destroy();
        for (const pending of presentationCallbacks) cancelAnimationFrame(pending);
      }),
  );
  const began = browserNow();
  const observations = scenario.launches > 0 ? [] : initial;
  yield* Effect.fromResult(
    renderer.setData({
      markets: observations,
      slots: initial.map((market, slot) => ({ marketId: market.id, slot })),
      tiers,
      revision: 1,
    }),
  );
  const scenePreparationMs = browserNow() - began;
  const run = Effect.fn("Bench.sample")(function*() {
    cameraLevels.clear();
    cameraLevels.add(renderer.getView().level);
    sampling = true;
    const sample = yield* sampleFrames(
      renderer,
      scenario,
      initial,
      tiers,
      (revision, receivedAtMs) => receipts.set(revision, receivedAtMs),
    );
    // The last update gets a renderer frame and a subsequent presentation opportunity before metrics are frozen.
    yield* Effect.callback<void>(resume => {
      const outer = requestAnimationFrame(() => {
        const inner = requestAnimationFrame(() => resume(Effect.void));
        presentationCallbacks.add(inner);
      });
      return Effect.sync(() => cancelAnimationFrame(outer));
    });
    sampling = false;
    const result: BenchResult = {
      scenario: scenario.name,
      synthetic: true,
      markets: initial.length,
      agents: scenario.agents,
      viewport: { width: innerWidth, height: innerHeight, pixelRatio: devicePixelRatio },
      cameraLevels: [...cameraLevels],
      userAgent: navigator.userAgent,
      scene: { expectedTiers: scenario.tiers, maximumObservedTiers, maximumInstrumentTiers },
      workload: {
        inputReadings: sample.inputReadings,
        emittedReadings: sample.emittedReadings,
        appliedBatches: sample.appliedBatches,
        expectedBatches: thresholds.minimumDurationMs / 250,
        launches: sample.launches,
        expectedLaunches: scenario.launches,
        recordedSource: recording.description,
        verifiedLiquidationReplay: false,
      },
      scenePreparationMs: Number(scenePreparationMs.toFixed(2)),
      firstMeaningfulPaintMs: Number(Option.getOrElse(firstMeaningfulPaint, () => browserNow()).toFixed(2)),
      sampleCount: sample.frames.length,
      elapsedMs: Number(sample.elapsedMs.toFixed(2)),
      frameCadence: {
        ...summarize(sample.frames),
        estimatedFps: Number((sample.frames.length / sample.elapsedMs * 1000).toFixed(1)),
        overBudget: sample.overBudget,
      },
      rendering: { frameCount: submissions.length, cpuSubmission: summarize(submissions) },
      readToPixel: {
        measurement: "submission-to-next-presentation-opportunity",
        physicalPixelsVerified: false,
        samples: receiptToPresentation.length,
        supersededBatches,
        unacknowledgedBatches: Math.max(0, sample.appliedBatches - revisions.length - supersededBatches),
        revisions,
        receiptToSubmission: summarize(receiptToSubmission),
        receiptToPresentationOpportunity: summarize(receiptToPresentation),
      },
      renderer: renderer.getStats(),
      memory: {
        jsHeapBytes: jsHeap(),
        gpuBytes: Option.none(),
        gpuMeasurement: "WebGL exposes allocation counts; byte size is unavailable",
        geometries: maxGeometries,
        textures: maxTextures,
      },
      maxDrawCalls: maximumDrawCalls,
      maxTriangles: maximumTriangles,
      webglErrors: [...errors],
      target: { fps: 60, passesInThisBrowser: false, phoneVerified: false, failures: [] },
    };
    const failures = failuresFor(result);
    return yield* Schema.encodeEffect(BenchResult)({
      ...result,
      target: { ...result.target, passesInThisBrowser: failures.length === 0, failures },
    });
  });
  const services = yield* Effect.context();
  window.floorBench = { ready: true, run: () => Effect.runPromiseWith(services)(run()) };
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      delete window.floorBench;
    })
  );
  return yield* Effect.never;
});

program.pipe(Effect.scoped, BrowserRuntime.runMain);
