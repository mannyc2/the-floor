import { Effect, Option, Predicate, Result, Schema } from "effect";
import { PrivyFailure } from "./error";

const invalid = (detail: string) => Result.fail(new PrivyFailure({ operation: "canonicalize", detail }));

// RFC 8785 uses ECMAScript primitive serialization and UTF-16 property ordering.
// Joining entries directly also avoids JavaScript's numeric-property reordering.
const serialize = (value: Schema.Json): Result.Result<string, PrivyFailure> => {
  if (Schema.is(Schema.String)(value) && !value.isWellFormed()) return invalid("Lone surrogate");
  if (Predicate.isNumber(value) && !Number.isFinite(value)) return invalid("Non-finite number");
  if (Schema.is(Schema.Union([Schema.Null, Schema.String, Schema.Finite, Schema.Boolean]))(value)) {
    // oxlint-disable-next-line effecttsgo/prefer-schema-over-json, effect/noGlobals -- JCS specifically requires ECMAScript's primitive serialization; the public boundary is already Schema-decoded.
    return Result.succeed(JSON.stringify(value));
  }
  if (Schema.is(Schema.Array(Schema.Json))(value)) {
    return Result.map(Result.all(value.map(serialize)), parts => `[${parts.join(",")}]`);
  }
  return Result.map(
    Result.all(
      Object.keys(value).toSorted().map(key => {
        const entry = Option.fromUndefinedOr(value[key]);
        if (Option.isNone(entry)) return invalid("Undefined object value");
        return Result.map(Result.all([serialize(key), serialize(entry.value)]), ([name, item]) => `${name}:${item}`);
      }),
    ),
    parts => `{${parts.join(",")}}`,
  );
};

// Accept values, never raw JSON text: duplicate textual keys cannot be recovered
// after parsing. All request objects are constructed from closed endpoint Schemas.
export const canonicalize = Effect.fn("Privy.canonicalize")(function*(input: Schema.Json) {
  const value = yield* Schema.decodeEffect(Schema.Json)(input).pipe(
    Effect.mapError(cause => new PrivyFailure({ operation: "canonicalize", detail: "Invalid JSON value", cause })),
  );
  return yield* Effect.fromResult(serialize(value));
});
