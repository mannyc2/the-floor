import { BrowserRuntime } from "@effect/platform-browser";
import { Cause, Context, Effect, Layer, Option } from "effect";
import { Runtime } from "foldkit";
import { __setDevToolsOverlay as setDevToolsOverlay, type DevToolsStore } from "foldkit/devtools-host";
import type { HtmlBuilder } from "foldkit/html";
import { AdapterState } from "../../../testing/look/protocol";
import { initialModel, makeView, MapCommands, Message, Model, update } from "../src/map/main";
import { cameraFromQuery } from "../src/map/model";
import { makeWorkbenchApi } from "./api";
import { captureCamera, prepareLookAdapter, readCaptureConfiguration } from "./look-adapter";
import { proportionCamera, readProportionStudy } from "./proportion-study";
import { WorkbenchFailure } from "./runtime";
import { SceneDigest } from "./scene-evidence";
import { readToneStudy } from "./tone-study";

const run = Effect.gen(function*() {
  const query = new URL(location.href).searchParams;
  const look = document.body.hasAttribute("data-look");
  const config = look ? Option.some(yield* readCaptureConfiguration(query)) : Option.none();
  const study = look ? yield* readToneStudy(query) : Option.none();
  const proportions = look ? yield* readProportionStudy(query) : Option.none();
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
  window.floorTest = makeWorkbenchApi(commands, store, runPromise);
  const requestedCamera = cameraFromQuery(query);
  const delay = Number(query.get("delay") ?? 0);
  const desks = Option.isSome(config) ? config.value.desks : query.get("desks") === "1000" ? 1000 : 12;
  const initial = initialModel(
    desks,
    Number.isFinite(delay) ? Math.max(0, Math.min(5000, delay)) : 0,
    Option.isSome(config)
      ? Option.some(
        Option.isSome(proportions)
          ? proportionCamera(proportions.value, config.value.height)
          : captureCamera(config.value, Option.isSome(study)),
      )
      : requestedCamera,
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
    update,
    view: (current: Model, h: HtmlBuilder<Message>) => ({ title: "The Floor workbench", body: mapView(current, h) }),
    container: document.getElementById("root"),
    resources: Layer.succeedContext(context),
    devTools: { Message, show: "Always", keyframeInterval: 1 },
  });
  yield* Effect.acquireRelease(
    Effect.sync(() => Runtime.embed(application)),
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
    yield* prepareLookAdapter(commands, config.value, study, proportions).pipe(
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

// oxlint-disable-next-line effecttsgo/strict-effect-provide -- This development entry owns the application scope and provides its command and digest services once.
BrowserRuntime.runMain(run.pipe(Effect.scoped, Effect.provide(Layer.merge(MapCommands.layer, SceneDigest.layer))));
