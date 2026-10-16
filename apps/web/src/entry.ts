import { BrowserRuntime } from "@effect/platform-browser";
import { colors } from "@floor/atlas/tokens";
import { Context, Effect, Layer } from "effect";
import { Runtime } from "foldkit";
import { makeInit, makeView, Model, subscriptions, update } from "./main";
import { selectionFromQuery, sequenceFromQuery } from "./map/_lib/live-world";
import { MapCommands } from "./map/_lib/renderer/service";
import { initialModel } from "./map/main";
import { cameraFromQuery } from "./map/model";

const main = Effect.gen(function*() {
  document.documentElement.style.setProperty("--floor-paper", `#${colors.paper.day.toString(16).padStart(6, "0")}`);
  document.documentElement.style.setProperty("--floor-ink", `#${colors.line.day.toString(16).padStart(6, "0")}`);
  const context = yield* Layer.build(MapCommands.layer);
  const commands = Context.get(context, MapCommands);
  const query = new URL(location.href).searchParams;
  const camera = cameraFromQuery(query);
  const application = Runtime.makeApplication({
    Model,
    init: makeInit(initialModel(12, camera, selectionFromQuery(query), sequenceFromQuery(query))),
    update,
    subscriptions,
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
