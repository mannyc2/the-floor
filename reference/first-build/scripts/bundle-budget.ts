import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Effect, FileSystem, Path, Result, Schema, Stream } from "effect";
import { Command, Flag } from "effect/cli";
import { ChildProcess } from "effect/process";
import { budgetGroups, BundleBudgetError, Manifest } from "./bundle-budget/model";

const gzipBytes = Effect.fn("BundleBudget.gzipBytes")(function*(file: string) {
  const process = yield* ChildProcess.make("gzip", ["-9", "-n", "-c", "--", file], {
    stdout: "pipe",
    stderr: "inherit",
    forceKillAfter: "5 seconds",
  });
  const bytes = yield* Stream.runFold(process.stdout, () => 0, (total, chunk) => total + chunk.byteLength);
  const exitCode = yield* process.exitCode;
  if (exitCode !== 0 || bytes === 0) return yield* new BundleBudgetError({ message: `Could not measure ${file}` });
  return bytes;
}, Effect.scoped);

const command = Command.make(
  "bundle-budget",
  {
    directory: Flag.String("directory").pipe(Flag.withDefault("dist/client")),
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
      const sizes = yield* Effect.forEach(group.files, (file) => gzipBytes(path.join(directory, file)), {
        concurrency: 4,
      });
      const bytes = sizes.reduce((total, size) => total + size, 0);
      yield* Effect.logInfo(`${group.name}: ${(bytes / 1024).toFixed(2)} KiB / ${group.maximumBytes / 1024} KiB gzip`);
      if (bytes > group.maximumBytes) {
        return yield* new BundleBudgetError({
          message: `${group.name} exceeds its gzip budget by ${bytes - group.maximumBytes} bytes.`,
        });
      }
    }
    return void 0;
  }),
);

command.pipe(
  Command.run({ version: "1.0.0" }),
  // oxlint-disable-next-line effecttsgo/strict-effect-provide -- This CLI composition root owns filesystem and scoped child-process adapters.
  Effect.provide(BunServices.layer),
  BunRuntime.runMain,
);
