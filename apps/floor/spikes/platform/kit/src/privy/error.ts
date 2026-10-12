import { Schema } from "effect";

export class PrivyFailure extends Schema.TaggedError<PrivyFailure>()("PrivyFailure", {
  operation: Schema.String,
  detail: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}
