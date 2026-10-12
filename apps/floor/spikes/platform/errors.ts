import { Schema } from "effect";

export class ProbeError extends Schema.TaggedError<ProbeError>()("ProbeError", {
  operation: Schema.String,
  cause: Schema.Defect(),
}) {}

export class DeliberateRollback extends Schema.TaggedError<DeliberateRollback>()("DeliberateRollback", {
  marker: Schema.String,
}) {}

export class ProbeAssertion extends Schema.TaggedError<ProbeAssertion>()("ProbeAssertion", {
  invariant: Schema.String,
}) {}
