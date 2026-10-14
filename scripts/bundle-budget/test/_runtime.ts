import { Effect } from "effect";

// oxlint-disable-next-line effect/noEffectRunInTests -- Bun is the leaf runner; this adapter owns the Promise/Effect boundary for artifact checks.
export const runTest = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);
