import { type PlateRenderInput, PlateRenderJson } from "@floor/renderer/plate";
import { ApiError } from "@floor/surfaces";
import { Config, Context, Effect, Layer, Option, Schema, Semaphore } from "effect";
import { Chromium } from "effect-browser";
import { Base64 } from "effect/encoding";
import { ServerConfig } from "./config";

/** @stability unstable */
export class PlateRenderer extends Context.Service<PlateRenderer, {
  readonly render: (input: PlateRenderInput) => Effect.Effect<string, ApiError>;
}>()("floor/PlateRenderer") {
  static readonly unavailable = Layer.succeed(
    PlateRenderer,
    PlateRenderer.of({
      render: () => Effect.fail(new ApiError({ message: "Trusted plate rendering is unavailable." })),
    }),
  );
}

/** @stability unstable */
export const PlateRendererLive = Layer.effect(
  PlateRenderer,
  Effect.gen(function*() {
    const server = yield* ServerConfig;
    const executable = yield* Config.NonEmptyString("GATE_BROWSER_EXECUTABLE").pipe(Config.option);
    const capacity = yield* Semaphore.make(2);
    const render = Effect.fn("PlateRenderer.render")(
      function*(input: PlateRenderInput) {
        const encoded = yield* Schema.encodeEffect(PlateRenderJson)(input);
        const browser = yield* Chromium.open({
          sandbox: true,
          viewport: { width: 1440, height: 1000 },
          maxPages: 1,
          executablePath: Option.getOrUndefined(executable),
          actionTimeout: "10 seconds",
          navigationTimeout: "15 seconds",
        });
        const page = yield* browser.firstPage;
        // The only executable resource is the built renderer. Titles, identities and readings are inert fragment data.
        yield* page.goto(`${server.origin}/plate-render.html#${encodeURIComponent(encoded)}`);
        yield* page.waitFor({ selector: "html[data-plate-rendered=\"true\"]" }, "15 seconds").pipe(
          Effect.tapError(() =>
            Effect.flatMap(page.text(), content => Effect.logWarning("Plate page did not finish", content.text))
          ),
        );
        const image = yield* page.screenshot({ format: "png" });
        return `data:image/png;base64,${Base64.encode(image.data)}`;
      },
      Effect.scoped,
      Effect.timeout("30 seconds"),
      Effect.tapError(error => Effect.logError("Trusted plate renderer failed", error.message)),
      Effect.mapError(() =>
        new ApiError({
          message:
            "The trusted plate renderer is unavailable. Build the application and install Playwright Chromium, then retry.",
        })
      ),
      capacity.withPermits(1),
    );
    return PlateRenderer.of({ render });
  }),
);
