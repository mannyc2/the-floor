// oxlint-disable effect/noEffectRunInTests, effecttsgo/strict-effect-provide -- Bun owns this Promise/Effect boundary and the native filesystem Layer used to read tracked approval briefs.
import { Effect, type Layer } from "effect";

export const runTest = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

export const runPlatformTest = <A, E, R>(effect: Effect.Effect<A, E, R>, layer: Layer.Layer<R>) =>
  Effect.runPromise(effect.pipe(Effect.provide(layer)));
