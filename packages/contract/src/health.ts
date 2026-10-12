import { Schema } from "effect";

export const Health = Schema.Struct({ status: Schema.Literal("ready"), service: Schema.Literal("floor") });
export type Health = typeof Health.Type;
