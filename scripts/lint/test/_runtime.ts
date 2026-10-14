// oxlint-disable effect/noEffectRunInTests, effecttsgo/strict-effect-provide -- Bun owns the lint test runner; this adapter owns platform Layers, scoped child processes and the Promise/Effect boundary.
import { Effect, type Layer, type Scope } from "effect";

export const runTest = <A, E, R>(effect: Effect.Effect<A, E, R | Scope.Scope>, layer: Layer.Layer<R>) =>
  Effect.runPromise(effect.pipe(Effect.scoped, Effect.provide(layer)));
