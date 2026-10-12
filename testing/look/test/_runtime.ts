import { Effect } from "effect";

// oxlint-disable-next-line effect/noEffectRunInTests -- Bun is the workspace leaf runner; this adapter owns its Promise/Effect test boundary.
export const runTest = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);
