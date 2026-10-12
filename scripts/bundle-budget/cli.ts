import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Effect, FileSystem, Path, Record, Result, Schema, Stream } from "effect";
import { Command, Flag } from "effect/cli";
import { ChildProcess } from "effect/process";
import { inspectModules } from "./graph";
import { assets, budgetGroups, BundleBudgetError, Manifest } from "./model";

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
    profile: Flag.Literals("profile", ["shell", "complete"]).pipe(Flag.withDefault("complete")),
  },
  Effect.fn("BundleBudget.check")(function*({ directory, profile }) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const manifest = yield* fs.readFileString(path.join(directory, ".vite/manifest.json")).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Manifest))),
    );
    const groups = budgetGroups(manifest, profile);
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
    const reachable = assets(
      manifest,
      Record.keys(Record.filter(manifest, chunk => chunk.isEntry)),
      true,
    );
    if (Result.isFailure(reachable)) return yield* reachable.failure;
    const entries = Record.values(Record.filter(manifest, chunk => chunk.isEntry)).map(chunk => chunk.file);
    const result = yield* inspectModules({
      target: "web",
      directory,
      entry: entries,
      expectedFiles: reachable.success,
    });
    yield* Effect.logInfo(`web: ${result.modules} emitted modules, ${result.mappedSources} mapped sources inspected`);
    if (profile === "shell") {
      yield* Effect.logInfo(
        "Shell budget measured. Deferred renderer acceptance remains pending the external Foldkit renderer.",
      );
    }
    return void 0;
  }),
);

command.pipe(
  Command.run({ version: "1.0.0" }),
  // oxlint-disable-next-line effecttsgo/strict-effect-provide -- The CLI owns the filesystem and scoped measurement process.
  Effect.provide(BunServices.layer),
  BunRuntime.runMain,
);
