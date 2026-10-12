import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Effect, Schema } from "effect";
import { ChildProcess } from "effect/process";

class DevelopmentProcessStopped
  extends Schema.TaggedError<DevelopmentProcessStopped>()("DevelopmentProcessStopped", { exitCode: Schema.Int })
{}

const develop = Effect.gen(function*() {
  const api = yield* ChildProcess.make("bun", ["--watch", "packages/server/src/local.ts"], {
    stdout: "inherit",
    stderr: "inherit",
    forceKillAfter: "10 seconds",
  });
  const ui = yield* ChildProcess.make("bun", ["run", "dev:ui"], {
    stdout: "inherit",
    stderr: "inherit",
    forceKillAfter: "10 seconds",
  });
  // Both child lifetimes belong to this scope; one exit or an interrupt closes its sibling too.
  const exitCode = yield* Effect.raceFirst(api.exitCode, ui.exitCode);
  if (exitCode !== 0) return yield* new DevelopmentProcessStopped({ exitCode });
  return yield* Effect.void;
});

// oxlint-disable-next-line effecttsgo/strict-effect-provide -- This development-process entry point owns both child scopes.
develop.pipe(Effect.scoped, Effect.provide(BunServices.layer), BunRuntime.runMain);
