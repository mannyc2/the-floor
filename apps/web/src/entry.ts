import { BrowserRuntime } from "@effect/platform-browser";
import { Context, Effect, Layer, Schema } from "effect";
import { Runtime } from "foldkit";
import { makeInit, makeView, Model, update } from "./main";
import { MapCommands } from "./map/_lib/renderer/service";
import { initialModel } from "./map/main";
import { Camera } from "./map/model";

const main = Effect.gen(function*() {
  const context = yield* Layer.build(MapCommands.layer);
  const commands = Context.get(context, MapCommands);
  const query = new URL(location.href).searchParams;
  const camera = yield* Schema.decodeEffect(Camera)({
    x: Number(query.get("x")),
    z: Number(query.get("z")),
    extent: Number(query.get("extent")),
  }).pipe(Effect.option);
  const application = Runtime.makeApplication({
    Model,
    init: makeInit(initialModel(12, 0, camera)),
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
