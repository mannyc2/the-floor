import { BrowserRuntime } from "@effect/platform-browser";
import { proportionPalette } from "@floor/atlas/materials";
import { colors } from "@floor/atlas/tokens";
import { Context, Effect, Layer, Option } from "effect";
import { Runtime } from "foldkit";
import { makeInit, makeView, Model, subscriptions, update } from "./main";
import { selectionFromQuery, sequenceFromQuery } from "./map/_lib/live-world";
import { MapCommands } from "./map/_lib/renderer/service";
import { initialModel } from "./map/main";
import { cameraFromQuery, themeFromQuery } from "./map/model";

const hex = (value: number) => `#${value.toString(16).padStart(6, "0")}`;
const main = Effect.gen(function*() {
  // The chrome's colours come from the Atlas: paper ground, ink and the lit
  // screen, for each theme.
  for (const theme of ["day", "night"] as const) {
    const style = document.documentElement.style;
    style.setProperty(`--floor-ground-${theme}`, hex(colors.ground[theme]));
    style.setProperty(`--floor-paper-${theme}`, hex(colors.paper[theme]));
    style.setProperty(`--floor-ink-${theme}`, hex(colors.line[theme]));
    style.setProperty(`--floor-lit-${theme}`, hex(proportionPalette.colors["screen-light-0"][theme]));
  }
  const context = yield* Layer.build(MapCommands.layer);
  const commands = Context.get(context, MapCommands);
  const query = new URL(location.href).searchParams;
  const camera = cameraFromQuery(query);
  const application = Runtime.makeApplication({
    Model,
    init: makeInit(
      initialModel(
        12,
        camera,
        selectionFromQuery(query),
        sequenceFromQuery(query),
        Option.getOrElse(themeFromQuery(query), () => "day" as const),
      ),
    ),
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
