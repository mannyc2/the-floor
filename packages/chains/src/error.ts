import { Schema } from "effect";

export class ConstructionError extends Schema.TaggedError<ConstructionError>()("ConstructionError", {
  operation: Schema.String,
  cause: Schema.Defect(),
}) {}

export class UnsupportedConstruction extends Schema.TaggedError<UnsupportedConstruction>()("UnsupportedConstruction", {
  invariant: Schema.String,
}) {}
