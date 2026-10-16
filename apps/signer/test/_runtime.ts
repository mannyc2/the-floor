import { Effect } from "effect";
export const runTest = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);
