import { Schema } from "effect";

// An empty record has an object JSON Schema root and rejects stray tool arguments.
export const HealthRequest = Schema.Record(Schema.String, Schema.Never);
export const Health = Schema.Struct({ status: Schema.Literal("ready"), service: Schema.Literal("floor") });
export type Health = typeof Health.Type;
