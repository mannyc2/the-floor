import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Effect, FileSystem, Path, Result, Schema, Stream } from "effect";
import { Command, Flag } from "effect/cli";
import { ChildProcess } from "effect/process";
import { inspectModules } from "./graph";
import { budgetGroups, BundleBudgetError, Manifest } from "./model";

const gzipBytes = Effect.fn("BundleBudget.gzipBytes")(function*(file: string) {
  const child = yield* ChildProcess.make("gzip", ["-9", "-n", "-c", "--", file], {
    stdout: "pipe",
    stderr: "inherit",
    forceKillAfter: "5 seconds",
  });
  const bytes = yield* Stream.runFold(child.stdout, () => 0, (total, chunk) => total + chunk.byteLength);
  const exitCode = yield* child.exitCode;
  if (exitCode !== 0 || bytes === 0) {
    return yield* new BundleBudgetError({ reason: "ExceededBudget", detail: `Could not measure ${file}` });
  }
  return bytes;
}, Effect.scoped);

const command = Command.make(
  "bundle-budget",
  {
    directory: Flag.String("directory").pipe(Flag.withDefault("apps/web/dist")),
  },
  Effect.fn("BundleBudget.check")(function*({ directory }) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const manifest = yield* fs.readFileString(path.join(directory, ".vite/manifest.json")).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Manifest))),
    );
    const groups = budgetGroups(manifest);
    if (Result.isFailure(groups)) return yield* groups.failure;
    for (const group of groups.success) {
      const sizes = yield* Effect.forEach(group.files, file => gzipBytes(path.join(directory, file)), {
        concurrency: 4,
      });
      const bytes = sizes.reduce((sum, size) => sum + size, 0);
      yield* Effect.logInfo(`${group.name}: ${bytes} / ${group.maximumBytes} bytes gzip`);
      if (bytes > group.maximumBytes) {
        return yield* new BundleBudgetError({ reason: "ExceededBudget", detail: `${group.name}: ${bytes}` });
      }
    }
    yield* inspectModules(directory, "web");
    return void 0;
  }),
);

command.pipe(
  Command.run({ version: "1.0.0" }),
  Effect.provide(BunServices.layer),
  BunRuntime.runMain,
);
