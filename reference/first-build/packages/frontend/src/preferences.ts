import { Context, Effect, Layer, Option } from "effect";
import { KeyValueStore } from "effect/persistence";
import { FrontendError } from "./_lib/errors";
import { Theme } from "./state";

/** @stability unstable */
export class Preferences extends Context.Service<Preferences, {
  readonly theme: Effect.Effect<typeof Theme.Type>;
  readonly saveTheme: (theme: typeof Theme.Type) => Effect.Effect<void, FrontendError>;
}>()("@floor/frontend/Preferences") {
  static readonly layer = Layer.effect(
    Preferences,
    Effect.gen(function*() {
      const store = KeyValueStore.toSchemaStore(yield* KeyValueStore.KeyValueStore, Theme);
      return Preferences.of({
        theme: store.get("floor-theme").pipe(
          Effect.map(Option.getOrElse(() => "day" as const)),
          Effect.orElseSucceed(() => "day" as const),
        ),
        saveTheme: theme =>
          store.set("floor-theme", theme).pipe(
            Effect.mapError(() => new FrontendError({ message: "This browser could not save your theme preference." })),
          ),
      });
    }),
  );
}
