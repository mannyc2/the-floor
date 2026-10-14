import { expect } from "bun:test";
import { Effect, Schema } from "effect";

// oxlint-disable-next-line effect/noEffectRunInTests -- Bun owns the leaf runner; this adapter is its only Promise/Effect boundary.
export const runTest = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

export const roundTrip = <A, I>(schema: Schema.Codec<A, I>, value: A) => {
  const codec = Schema.fromJsonString(Schema.toCodecJson(schema));
  return Schema.encodeEffect(codec)(value).pipe(
    Effect.flatMap(Schema.decodeEffect(codec)),
    Effect.map(decoded => Schema.toEquivalence(schema)(value, decoded)),
  );
};

export const expectPassed = (result: { readonly _tag: string }) => expect(result._tag).toBe("Passed");
