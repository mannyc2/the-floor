import { BrowserRuntime } from "@effect/platform-browser";
import { Context, Effect, Layer } from "effect";
import { Runtime } from "foldkit";
import { makeInit, makeView, Model, update } from "./main";
import { MapCommands } from "./map/_lib/renderer/service";
import { initialModel } from "./map/main";
import { cameraFromQuery } from "./map/model";

const main = Effect.gen(function*() {
  const context = yield* Layer.build(MapCommands.layer);
  const commands = Context.get(context, MapCommands);
  const query = new URL(location.href).searchParams;
  const camera = cameraFromQuery(query);
  const application = Runtime.makeApplication({
    Model,
    init: makeInit(initialModel(12, camera)),
    update,
    view: makeView(commands),
    container: document.getElementById("root"),
    resources: Layer.succeedContext(context),
  });
  yield* Effect.acquireRelease(
    Effect.sync(() => Runtime.embed(application)),
    handle => Effect.sync(() => handle.dispose()),
  );
  return yield* Effect.never;
});

main.pipe(Effect.scoped, BrowserRuntime.runMain);
