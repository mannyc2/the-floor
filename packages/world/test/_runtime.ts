import { expect } from "bun:test";
import { Effect, Schema } from "effect";

export const runTest = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

export const roundTrip = <A, I>(schema: Schema.Codec<A, I>, value: A) => {
  const codec = Schema.fromJsonString(Schema.toCodecJson(schema));
  return Schema.encodeEffect(codec)(value).pipe(
    Effect.flatMap(Schema.decodeEffect(codec)),
    Effect.map(decoded => Schema.toEquivalence(schema)(value, decoded)),
  );
};

export const expectPassed = (result: { readonly _tag: string }) => expect(result._tag).toBe("Passed");
