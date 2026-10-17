import { proportionPalette } from "@floor/atlas/materials";
import { Clock, Effect, Option, Schema } from "effect";
import {
  AdapterState,
  BenchResult,
  CaptureConfiguration,
  fixedSeed,
  fixedTimeEpochMs,
  ReadyState,
} from "../../../testing/look/protocol";
import { syntheticPalette } from "../src/map/_lib/renderer/scene";
import type { MapCommands } from "../src/map/_lib/renderer/service";
import type { Camera } from "../src/map/model";
import { installAssetReview } from "./_lib/asset-review";
import { assetCamera, type AssetReview } from "./_lib/asset-review-model";
import { installReferenceScene, referenceCamera, referencePalette, type ReferenceScene } from "./_lib/reference-scene";
import { type Engine, mountedProbe } from "./renderer-probe";
import { browserCall, nextFrame, settled, WorkbenchFailure } from "./runtime";
import { digestJson, sceneDigest } from "./scene-evidence";

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

const captureCamera = (config: CaptureConfiguration): Camera => ({
  x: 0,
  z: 0,
  rotation: 0,
  extent: config.rung === "building" ? config.desks > 12 ? 380 : 21 : config.rung === "floor" ? 12 : 7,
});

// A reference scene or asset review replaces the synthetic desks, so its
// camera is chosen before the first Model presentation can apply another.
export const lookCamera = (
  config: CaptureConfiguration,
  reference: Option.Option<ReferenceScene>,
  assets: Option.Option<AssetReview>,
): Camera =>
  Option.isSome(reference)
    ? referenceCamera(reference.value, config.height)
    : Option.isSome(assets)
    ? assetCamera(assets.value)
    : captureCamera(config);

const installScene = Effect.fn("Workbench.installScene")(function*(
  engine: Engine,
  config: CaptureConfiguration,
  reference: Option.Option<ReferenceScene>,
  assets: Option.Option<AssetReview>,
) {
  if (Option.isNone(reference) && Option.isNone(assets)) return yield* Effect.void;
  if (
    (Option.isSome(reference) && Option.isSome(assets)) || config.asset !== "scene" || config.rung !== "building"
    || config.desks !== 12
  ) {
    return yield* new WorkbenchFailure({
      operation: "look-scene",
      cause: "A reference scene or asset review replaces the fixed whole scene on its own",
    });
  }
  const night = config.theme === "night";
  if (Option.isSome(assets)) return yield* installAssetReview(engine, assets.value, night);
  if (Option.isSome(reference) && !(yield* installReferenceScene(engine, reference.value, night))) {
    return yield* new WorkbenchFailure({ operation: "reference-scene", cause: "The surface material is absent" });
  }
  return yield* Effect.void;
});

export const prepareLookAdapter = Effect.fn("Workbench.prepareLookAdapter")(function*(
  commands: MapCommands["Service"],
  config: CaptureConfiguration,
  reference: Option.Option<ReferenceScene>,
  assets: Option.Option<AssetReview>,
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
  const engine = mountedProbe(mounted.value).engine;
  engine.canvas.dataset["floorLook"] = "";
  engine.setCamera(lookCamera(config, reference, assets));
  yield* installScene(engine, config, reference, assets);
  if (config.asset === "rack") {
    const scene = engine.diagnosticScene();
    const gauge = Option.flatMap(
      scene.gauge,
      id => Option.fromUndefinedOr(scene.entities.find(entity => entity.id === id)),
    );
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
      Option.isSome(reference)
        ? referencePalette(reference.value)
        : Option.isSome(assets)
        ? proportionPalette
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
