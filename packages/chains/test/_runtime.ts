import { expect } from "bun:test";
import { Effect } from "effect";

export const runTest = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

// Bun's equality overload otherwise requires the expected wire record to share
// the SDK's branded type, which would need an unsafe assertion in parity tests.
// oxlint-disable-next-line effect/noUnknownParameters -- Equality compares already-decoded SDK brands with wire records; another parse would conceal structural differences.
export const expectEqual = (actual: unknown, expected: unknown) => expect(actual).toEqual(expected);
