import { Effect, Schema } from "effect";

export class WorkbenchFailure extends Schema.TaggedError<WorkbenchFailure>()("WorkbenchFailure", {
  operation: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message() {
    return `${this.operation}: ${this.cause instanceof Error ? this.cause.message : String(this.cause)}`;
  }
}

export const browserCall = <A>(operation: string, use: () => Promise<A>) =>
  Effect.tryPromise({ try: use, catch: (cause) => new WorkbenchFailure({ operation, cause }) });

export const nextFrame = Effect.callback<void>((resume) => {
  const request = requestAnimationFrame(() => resume(Effect.void));
  return Effect.sync(() => cancelAnimationFrame(request));
});
export const settled = nextFrame.pipe(Effect.andThen(nextFrame));
