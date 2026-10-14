import { Clock, Effect, Option, Schema } from "effect";
import {
  AdapterState,
  BenchResult,
  CaptureConfiguration,
  fixedSeed,
  fixedTimeEpochMs,
  ReadyState,
} from "../../../testing/look/protocol";
import type { Engine } from "../src/map/_lib/renderer/engine";
import { syntheticPalette } from "../src/map/_lib/renderer/scene";
import type { MapCommands } from "../src/map/_lib/renderer/service";
import type { Camera } from "../src/map/model";
import { installProportionStudy, proportionCamera, type ProportionStudy } from "./proportion-study";
import { browserCall, nextFrame, settled, WorkbenchFailure } from "./runtime";
import { digestJson, sceneDigest } from "./scene-evidence";
import { installToneStudy, type ToneStudy } from "./tone-study";

export const readCaptureConfiguration = Effect.fn("Workbench.readCaptureConfiguration")(
  function*(query: URLSearchParams) {
    return yield* Schema.decodeUnknownEffect(CaptureConfiguration)({
      technique: query.get("technique"),
      backend: query.get("backend"),
      theme: query.get("theme"),
      rung: query.get("rung"),
      asset: query.get("asset"),
      dpr: Number(query.get("dpr")),
      width: Number(query.get("width")),
      height: Number(query.get("height")),
      desks: Number(query.get("desks")),
      seed: Number(query.get("seed")),
      fixedTimeEpochMs: Number(query.get("fixedTimeEpochMs")),
    });
  },
);

export const captureCamera = (config: CaptureConfiguration, toneStudy = false): Camera => ({
  x: 0,
  z: 0,
  rotation: 0,
  extent: toneStudy ? 14 : config.rung === "building" ? config.desks > 12 ? 380 : 21 : config.rung === "floor" ? 12 : 7,
});

const prepareProportions = Effect.fn("Workbench.prepareProportions")(
  function*(
    engine: Engine,
    config: CaptureConfiguration,
    study: Option.Option<ToneStudy>,
    proportions: Option.Option<ProportionStudy>,
  ) {
    if (Option.isSome(proportions)) {
      if (
        Option.isSome(study) || config.asset !== "scene" || config.rung !== "building" || config.desks !== 12
      ) {
        return yield* new WorkbenchFailure({
          operation: "proportion-study",
          cause: "Proportion studies require the separate whole-scene request",
        });
      }
      if (!(yield* installProportionStudy(engine, proportions.value, config.theme === "night"))) {
        return yield* new WorkbenchFailure({
          operation: "proportion-study",
          cause: "The renderer's surface material is absent",
        });
      }
      engine.setCamera(proportionCamera(proportions.value, config.height));
      yield* Effect.logInfo("Unapproved proportion diagnostic installed", {
        id: proportions.value.id,
        view: proportions.value.view,
        recipe: proportions.value.recipe,
      });
    }
    return yield* Effect.void;
  },
);

export const prepareLookAdapter = Effect.fn("Workbench.prepareLookAdapter")(function*(
  commands: MapCommands["Service"],
  config: CaptureConfiguration,
  study: Option.Option<ToneStudy>,
  proportions: Option.Option<ProportionStudy>,
) {
  if (config.seed !== fixedSeed || config.fixedTimeEpochMs !== fixedTimeEpochMs) {
    return yield* new WorkbenchFailure({
      operation: "capture-environment",
      cause: "The synthetic reference scene requires the protocol's fixed seed and clock",
    });
  }
  let mounted = commands.inspect();
  while (Option.isNone(mounted)) {
    yield* nextFrame;
    mounted = commands.inspect();
  }
  const engine = mounted.value.engine;
  engine.canvas.dataset["floorLook"] = "";
  engine.setCamera(captureCamera(config, Option.isSome(study)));
  yield* prepareProportions(engine, config, study, proportions);
  if (Option.isSome(study)) {
    if (config.asset !== "scene" || config.rung !== "building" || config.desks !== 12) {
      return yield* new WorkbenchFailure({ operation: "tone-study", cause: "Tone studies use the fixed whole scene" });
    }
    if (!(yield* installToneStudy(engine, study.value))) {
      return yield* new WorkbenchFailure({
        operation: "tone-study",
        cause: "The renderer's surface material is absent",
      });
    }
  }
  if (config.asset === "rack") {
    const scene = engine.diagnosticScene();
    const gauge = Option.fromUndefinedOr(scene.entities.find((entity) => entity.id === scene.gaugeId));
    if (Option.isNone(gauge)) {
      return yield* new WorkbenchFailure({ operation: "capture-asset", cause: "Synthetic gauge is absent" });
    }
    for (const mesh of scene.meshes) mesh.visible = mesh === gauge.value.mesh;
  }
  engine.draw(true);
  yield* settled;
  const observed = engine.inspect();
  if (observed.width !== config.width || observed.height !== config.height || observed.dpr !== config.dpr) {
    return yield* new WorkbenchFailure({
      operation: "capture-viewport",
      cause: "Canvas dimensions or DPR differ from the request",
    });
  }
  yield* browserCall("fonts-ready", () => document.fonts.ready);
  const sourceSceneSha256 = yield* sceneDigest(engine);
  // No glyphs or font assets enter this wordless synthetic canvas. Interface
  // fonts outside the captured canvas do not change its source manifest.
  const fontManifestSha256 = yield* digestJson({ canvasFonts: [], source: "wordless-synthetic-scene" });
  const state: AdapterState = ReadyState.make({
    protocolVersion: 1,
    config,
    renderer: observed.renderer,
    sourceSceneSha256,
    fontManifestSha256,
    paletteSha256: yield* digestJson(
      Option.isSome(proportions)
        ? proportions.value.palette
        : Option.isSome(study)
        ? study.value.palette
        : syntheticPalette,
    ),
  });
  const mask = Effect.fn("Workbench.mask")(function*(enabled: boolean) {
    engine.setMask(enabled);
    yield* settled;
    engine.finishFrame();
  });
  const bench = Effect.fn("Workbench.bench")(function*(frames: number, warmupFrames: number) {
    yield* Schema.decodeEffect(Schema.Struct({
      frames: Schema.Int.check(Schema.isGreaterThan(0)),
      warmupFrames: Schema.Int.check(Schema.isGreaterThan(0)),
    }))({ frames, warmupFrames });
    const clock = yield* Clock.Clock;
    const now = () => Number(clock.monotonicTimeNanosUnsafe()) / 1e6;
    const cpuMs: Array<number> = [], completedFrameMs: Array<number> = [];
    for (let index = 0; index < warmupFrames + frames; index += 1) {
      yield* nextFrame;
      const start = now();
      const submitted = engine.draw(true);
      engine.finishFrame();
      const completed = now() - start;
      if (index >= warmupFrames) {
        cpuMs.push(submitted.cpuMs);
        completedFrameMs.push(completed);
      }
    }
    const info = engine.inspect();
    const result: BenchResult = {
      frames,
      warmupFrames,
      cpuMs,
      completedFrameMs,
      gpu: BenchResult.fields.gpu.members[1].make({
        reason: "GPU timer queries are not collected; completed-frame timing includes gl.finish blocking",
      }),
      drawCalls: info.calls,
      triangles: info.triangles,
      targetBytes: info.targetBytes,
      lineBufferBytes: info.lineBufferBytes,
    };
    return result;
  });
  return { state, mask, bench };
});
