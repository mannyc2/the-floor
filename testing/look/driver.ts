import { BunServices } from "@effect/platform-bun";
import { chromium } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";
import { Cause, Effect, Exit, FileSystem, Option, Schema } from "effect";
import { MeasurementError, phoneProfile, summarizeTimes } from "./performance";
import { decodePng } from "./png";
import { AdapterState, BenchResult, CaptureConfiguration, fixedSeed, fixedTimeEpochMs } from "./protocol";

export class BrowserError
  extends Schema.TaggedError<BrowserError>()("BrowserError", { operation: Schema.String, cause: Schema.Defect() })
{
  override get message() {
    return `${this.operation}: ${this.cause instanceof Error ? this.cause.message : String(this.cause)}`;
  }
}
export class HarnessBlocked extends Schema.TaggedError<HarnessBlocked>()("HarnessBlocked", { reason: Schema.String }) {
  override get message() {
    return this.reason;
  }
}
export interface DriverOptions {
  readonly url: string;
  readonly output: string;
  readonly renderer: "swiftshader" | "apple";
}
const browserCall = <A>(operation: string, invoke: () => Promise<A>) =>
  Effect.tryPromise({ try: invoke, catch: (cause) => new BrowserError({ operation, cause }) });
const writeJson = Effect.fn("writeLookReport")(function*(path: string, value: Schema.Json) {
  const fs = yield* FileSystem.FileSystem;
  const encoded = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Json))(value);
  yield* fs.writeFileString(path, encoded + "\n");
});
const newOutput = Effect.fn("prepareLookAttempt")(function*(output: string) {
  const fs = yield* FileSystem.FileSystem;
  if (yield* fs.exists(output)) {
    return yield* new HarnessBlocked({
      reason: "An attempt directory already exists; choose a new output path to preserve evidence",
    });
  }
  yield* fs.makeDirectory(output, { recursive: true });
  return output;
});
const browserResource = (renderer: DriverOptions["renderer"]) =>
  Effect.acquireRelease(
    browserCall("chromium.launch", () =>
      chromium.launch(
        renderer === "apple"
          ? { headless: true, channel: "chrome", args: ["--use-angle=metal"] }
          : { headless: true, args: ["--use-angle=swiftshader-webgl", "--enable-unsafe-swiftshader"] },
      )),
    (browser) => browserCall("chromium.close", () => browser.close()).pipe(Effect.orDie),
  );
const pageResource = (browser: Browser, config: CaptureConfiguration) =>
  Effect.acquireRelease(
    browserCall("browser.newPage", () =>
      browser.newPage({ viewport: { width: config.width, height: config.height }, deviceScaleFactor: config.dpr })),
    (page) =>
      browserCall("page.close", () => page.close()).pipe(Effect.orDie),
  );
const configurePage = Effect.fn("pinLookEnvironment")(function*(page: Page) {
  // Fix wall-clock time without replacing performance.now, which owns CPU and
  // completed-frame timings in the benchmark. Every navigation resets the seed.
  yield* browserCall("clock.setFixedTime", () => page.clock.setFixedTime(fixedTimeEpochMs));
  yield* browserCall("page.addInitScript", () =>
    page.addInitScript((seed: number) => {
      let state = seed >>> 0;
      // oxlint-disable-next-line effect/noGlobals -- This isolated browser adapter must seed native Math.random before the renderer's first document script.
      Math.random = () => {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        return (state >>> 0) / 4294967296;
      };
    }, fixedSeed));
});
const navigate = Effect.fn("openLookConfiguration")(
  function*(page: Page, options: DriverOptions, config: CaptureConfiguration) {
    const url = new URL(options.url);
    for (const [key, value] of Object.entries(config)) url.searchParams.set(key, String(value));
    yield* browserCall("page.goto", () => page.goto(url.href));
    yield* browserCall("adapter.ready", () =>
      page.waitForFunction(
        () => (window.floorLook?.state()._tag ?? "Loading") !== "Loading",
        {},
        { timeout: 15_000 },
      ));
    const observed: unknown = yield* browserCall("adapter.state", () => page.evaluate(() => window.floorLook?.state()));
    const state = yield* Schema.decodeUnknownEffect(AdapterState)(observed);
    if (state._tag !== "Ready") {
      return yield* new HarnessBlocked({
        reason: state._tag === "Failed"
          ? state.reason
          : "The web renderer must provide protocol v1 on window.floorLook",
      });
    }
    if (!Schema.toEquivalence(CaptureConfiguration)(state.config, config)) {
      return yield* new HarnessBlocked({
        reason: "The renderer did not apply the requested deterministic capture configuration",
      });
    }
    if (!state.renderer.toLowerCase().includes(options.renderer)) {
      return yield* new HarnessBlocked({
        reason: `Requested ${options.renderer} but observed ${state.renderer}`,
      });
    }
    yield* browserCall("fonts.ready", () => page.evaluate(() => document.fonts.ready.then(() => true)));
    return state;
  },
);
const screenshot = Effect.fn("captureLookCanvas")(function*(page: Page, path: string, config: CaptureConfiguration) {
  const bytes = yield* browserCall(
    "canvas.screenshot",
    () => page.locator("canvas[data-floor-look]").screenshot({ path, animations: "disabled" }),
  );
  const image = yield* decodePng(bytes);
  if (image.width !== config.width * config.dpr || image.height !== config.height * config.dpr) {
    return yield* new MeasurementError({
      operation: "screenshot",
      invariant: "The canvas raster does not match the requested CSS viewport and DPR",
    });
  }
  return { bytes, image };
});
const timingJson = (value: Effect.Success<ReturnType<typeof summarizeTimes>>) => ({
  count: value.count,
  p50: Option.getOrNull(value.p50),
  p95: Option.getOrNull(value.p95),
  p99: Option.getOrNull(value.p99),
  over16_7ms: value.over16_7ms,
  cpuBudget16_7ms: Option.getOrNull(value.cpuBudget16_7ms),
});
const phoneCell = Effect.fn("capturePhoneProfile")(function*(browser: Browser, options: DriverOptions, desks: number) {
  const config: CaptureConfiguration = {
    technique: "B",
    backend: "webgl",
    theme: "day",
    rung: "building",
    asset: "scene",
    width: 390,
    height: 844,
    dpr: 3,
    desks,
    seed: fixedSeed,
    fixedTimeEpochMs,
  };
  const page = yield* pageResource(browser, config);
  yield* configurePage(page);
  const cdp = yield* browserCall("newCDPSession", () => page.context().newCDPSession(page));
  yield* browserCall(
    "Emulation.setCPUThrottlingRate",
    () => cdp.send("Emulation.setCPUThrottlingRate", { rate: phoneProfile.cpuThrottlingRate }),
  );
  const id = `webgl-B-${desks}`;
  yield* Effect.acquireRelease(
    browserCall(
      "tracing.start",
      () => page.context().tracing.start({ screenshots: true, snapshots: true, sources: false }),
    ),
    () =>
      browserCall("tracing.stop", () => page.context().tracing.stop({ path: `${options.output}/${id}.trace.zip` }))
        .pipe(Effect.orDie),
  );
  const state = yield* navigate(page, options, config);
  const observed: unknown = yield* browserCall(
    "adapter.bench",
    () =>
      page.evaluate(({ frames, warmupFrames }) => window.floorLook?.bench(frames, warmupFrames), {
        frames: phoneProfile.measuredFrames,
        warmupFrames: phoneProfile.warmupFrames,
      }),
  );
  const measured = yield* Schema.decodeUnknownEffect(BenchResult)(observed);
  if (
    measured.frames !== phoneProfile.measuredFrames || measured.warmupFrames !== phoneProfile.warmupFrames
    || measured.cpuMs.length !== measured.frames || measured.completedFrameMs.length !== measured.frames
  ) {
    return yield* new HarnessBlocked({
      reason: "The phone benchmark did not return all requested CPU and completed-frame samples after warmup",
    });
  }
  const cpu = yield* summarizeTimes(measured.cpuMs), completed = yield* summarizeTimes(measured.completedFrameMs);
  const gpu = measured.gpu._tag === "Measured"
    ? { method: measured.gpu.method, ...timingJson(yield* summarizeTimes(measured.gpu.samplesMs)) }
    : measured.gpu;
  yield* screenshot(page, `${options.output}/${id}.png`, config);
  const row = {
    id,
    status: "measured",
    state,
    profile: phoneProfile,
    samples: measured,
    cpu: timingJson(cpu),
    completedFrame: timingJson(completed),
    gpu,
    limitation: options.renderer === "apple"
      ? "390×844 DPR 3 with 4× CPU throttling on desktop Apple GPU; this is not a real phone. Playwright trace is retained; GPU duration is only the adapter's actual timer query."
      : "390×844 DPR 3 with 4× CPU throttling and desktop SwiftShader software rendering; this is not an Apple hardware measurement or a real phone. Playwright trace is retained; GPU duration is only the adapter's actual timer query.",
  };
  yield* writeJson(`${options.output}/${id}.json`, row);
  return row;
}, Effect.scoped);

const runPhoneProfile = Effect.fn("runPhoneProfile")(function*(options: DriverOptions) {
  yield* newOutput(options.output);
  const browser = yield* browserResource(options.renderer);
  const rows: Array<Schema.Json> = [];
  for (const desks of [12, 1000]) {
    const exit = yield* Effect.exit(phoneCell(browser, options, desks));
    if (Exit.isFailure(exit)) {
      rows.push({ status: "failed", desks, reason: Cause.pretty(exit.cause) });
      yield* writeJson(`${options.output}/results.json`, rows);
      return yield* new HarnessBlocked({ reason: "Phone profile failed; the cell and browser trace are retained" });
    }
    rows.push(exit.value);
    yield* writeJson(`${options.output}/results.json`, rows);
  }
  return rows.length;
}, Effect.scoped);

export class HarnessExecutionError
  extends Schema.TaggedError<HarnessExecutionError>()("HarnessExecutionError", { cause: Schema.Defect() })
{
  override get message() {
    return this.cause instanceof Error ? this.cause.message : String(this.cause);
  }
}
export const runPhoneHarness = Effect.fn("runPhoneHarness")(
  runPhoneProfile,
  Effect.mapError((cause) => new HarnessExecutionError({ cause })),
  // oxlint-disable-next-line effecttsgo/strict-effect-provide -- The host harness is the single Bun runtime boundary for browser, filesystem and digest work.
  Effect.provide(BunServices.layer),
);
