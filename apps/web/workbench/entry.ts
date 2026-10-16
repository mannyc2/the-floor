import { BrowserRuntime } from "@effect/platform-browser";
import { Cause, Context, Effect, Layer, Option } from "effect";
import { Runtime } from "foldkit";
import { __setDevToolsOverlay as setDevToolsOverlay, type DevToolsStore } from "foldkit/devtools-host";
import type { HtmlBuilder } from "foldkit/html";
import { AdapterState } from "../../../testing/look/protocol";
import { MapCommands } from "../src/map/_lib/renderer/service";
import { cameraFromQuery } from "../src/map/model";
import { makeWorkbenchApi } from "./api";
import { ComparisonMessage, comparisonPorts, comparisonSubscriptions, makeCameraComparison } from "./camera-comparison";
import { captureCamera, prepareLookAdapter, readCaptureConfiguration } from "./look-adapter";
import { initialModel, makeView, Model } from "./model";
import { installNativeProbes } from "./native-probes";
import { instrumentMounted } from "./renderer-probe";
import { installReplay } from "./replay-bridge";
import { WorkbenchFailure } from "./runtime";
import { SceneDigest } from "./scene-evidence";

installNativeProbes();
const run = Effect.gen(function*() {
  const query = new URL(location.href).searchParams;
  const look = document.body.hasAttribute("data-look");
  const config = look ? Option.some(yield* readCaptureConfiguration(query)) : Option.none();
  const context = yield* Effect.context<MapCommands | SceneDigest>();
  const commands = Context.get(context, MapCommands);
  const runPromise = Effect.runPromiseWith(context);
  const debug = { store: Option.none<DevToolsStore>() };
  setDevToolsOverlay((store) =>
    Effect.sync(() => {
      debug.store = Option.some(store);
    })
  );
  const store = () =>
    Option.getOrThrowWith(
      debug.store,
      () => new WorkbenchFailure({ operation: "devtools-store", cause: "DevTools has not initialized" }),
    );
  const embedded = { handle: Option.none<Runtime.EmbedHandle<typeof comparisonPorts>>() };
  const comparison = yield* makeCameraComparison(commands, input =>
    Option.getOrThrowWith(
      embedded.handle,
      () => new WorkbenchFailure({ operation: "camera-comparison-port", cause: "Application is not embedded" }),
    ).ports.comparisonCamera.send(input));
  window.floorTest = makeWorkbenchApi(commands, store, runPromise, comparison);
  const requestedCamera = cameraFromQuery(query);
  const delay = Number(query.get("delay") ?? 0);
  const desks = Option.isSome(config) ? config.value.desks : query.get("desks") === "1000" ? 1000 : 12;
  const initial = initialModel(
    desks,
    Number.isFinite(delay) ? Math.max(0, Math.min(5000, delay)) : 0,
    Option.isSome(config) ? Option.some(captureCamera(config.value)) : requestedCamera,
  );
  const model: Model = Option.isSome(config)
    ? {
      ...initial,
      presentation: {
        ...initial.presentation,
        theme: config.value.theme,
        sampleTime: 0,
        intervalStart: 0,
      },
    }
    : initial;
  const mapView = makeView(commands, !look);
  const application = Runtime.makeApplication({
    Model,
    init: () => ({ model }),
    update: comparison.update,
    view: (current: Model, h: HtmlBuilder<ComparisonMessage>) => ({
      title: "The Floor workbench",
      body: h.submodel({ slotId: "map", model: current, view: mapView, toParentMessage: message => message }),
    }),
    ports: comparisonPorts,
    subscriptions: comparisonSubscriptions,
    container: document.getElementById("root"),
    resources: Layer.succeedContext(context),
    devTools: { Message: ComparisonMessage, show: "Always", keyframeInterval: 1 },
  });
  yield* Effect.acquireRelease(
    Effect.sync(() => {
      const handle = Runtime.embed(application);
      embedded.handle = Option.some(handle);
      return handle;
    }),
    (handle) => Effect.sync(() => handle.dispose()),
  );
  if (Option.isSome(config)) {
    let state: AdapterState = AdapterState.members[1].make({});
    let implementation = Option.none<Effect.Success<ReturnType<typeof prepareLookAdapter>>>();
    const ready = () =>
      Option.getOrThrowWith(
        implementation,
        () => new WorkbenchFailure({ operation: "look-adapter", cause: "Renderer has not become ready" }),
      );
    window.floorLook = {
      state: () => state,
      mask: (enabled) => runPromise(ready().mask(enabled)),
      bench: (frames, warmupFrames) => runPromise(ready().bench(frames, warmupFrames)),
    };
    yield* prepareLookAdapter(commands, config.value).pipe(
      Effect.timeout("15 seconds"),
      Effect.tap((adapter) =>
        Effect.sync(() => {
          implementation = Option.some(adapter);
          state = adapter.state;
        })
      ),
      Effect.catchCause((cause) =>
        Effect.sync(() => {
          state = AdapterState.members[2].make({ reason: Cause.pretty(cause) });
        })
      ),
    );
  }
  yield* Effect.logInfo("Synthetic renderer workbench mounted");
  return yield* Effect.never;
});
BrowserRuntime.runMain(run.pipe(
  Effect.scoped,
  Effect.provide(Layer.merge(
    MapCommands.makeLayer({
      preserveDrawingBuffer: true,
      mounted: (mounted, options) => instrumentMounted(mounted).pipe(Effect.andThen(installReplay(mounted, options))),
    }),
    SceneDigest.layer,
  )),
));
