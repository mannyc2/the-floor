import { test } from "bun:test";
import { Effect, Scope } from "effect";
import { TestClock } from "effect/testing";

// Bun owns the test lifetime; every invocation gets a fresh controllable clock
// and Scope so interrupted ownership tests cannot leak into the next case.
export const effectTest = <A, E>(name: string, body: () => Effect.Effect<A, E, Scope.Scope | TestClock.TestClock>) =>
  test(name, () =>
    body().pipe(
      Effect.scoped,
      // oxlint-disable-next-line effecttsgo/strict-effect-provide -- This Bun test adapter is the sole runtime boundary for the controllable clock.
      Effect.provide(TestClock.layer()),
      // oxlint-disable-next-line effect/noEffectRunInTests -- Bun consumes a Promise; only this test adapter runs Effects.
      Effect.runPromise,
    ));
