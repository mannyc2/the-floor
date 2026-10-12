import { Schema } from "effect";
export class FrontendError extends Schema.TaggedError<FrontendError>()("FrontendError", { message: Schema.String }) {}
