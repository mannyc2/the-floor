import { test } from "bun:test";
import { Effect, Scope } from "effect";
import { TestClock } from "effect/testing";

// Bun owns the test lifetime; every invocation gets a fresh controllable clock
// and Scope so interrupted ownership tests cannot leak into the next case.
export const effectTest = <A, E>(name: string, body: () => Effect.Effect<A, E, Scope.Scope | TestClock.TestClock>) =>
  test(name, () =>
    body().pipe(
      Effect.scoped,
      Effect.provide(TestClock.layer()),
      Effect.runPromise,
    ));
