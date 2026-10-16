import { BunRuntime, BunServices } from "@effect/platform-bun";
import { make as reservePort } from "@effect/platform-node/NodeSocketServer";
import { Config, Effect, FileSystem, Layer, Option, Schedule, Schema } from "effect";
import { Argument, Command } from "effect/cli";
import { FetchHttpClient, HttpClient } from "effect/http";
import { ChildProcess, type ChildProcessSpawner } from "effect/process";

class FirstTradeFlowError extends Schema.TaggedError<FirstTradeFlowError>()("FirstTradeFlowError", {
  operation: Schema.String,
  cause: Schema.Defect(),
}) {}

const start = (command: string, args: ReadonlyArray<string>, env: Record<string, string> = {}) =>
  ChildProcess.make(command, args, {
    env: { CI: "true", ALCHEMY_TELEMETRY_DISABLED: "1", ...env },
    extendEnv: true,
    stdout: "inherit",
    stderr: "inherit",
    killSignal: "SIGTERM",
    forceKillAfter: "10 seconds",
  });
const run = Effect.fn("FirstTradeFlow.run")(
  function*(command: string, args: ReadonlyArray<string>, env: Record<string, string> = {}) {
    const child = yield* start(command, args, env);
    const code = yield* child.exitCode;
    if (code !== 0) return yield* new FirstTradeFlowError({ operation: "command", cause: { command, args, code } });
    return void 0;
  },
);
const unexpectedExit = (child: ChildProcessSpawner.ChildProcessHandle, operation: string) =>
  child.exitCode.pipe(Effect.flatMap(code => Effect.fail(new FirstTradeFlowError({ operation, cause: { code } }))));
const ready = Effect.fn("FirstTradeFlow.ready")(function*(path: string, url: string) {
  const fs = yield* FileSystem.FileSystem;
  const http = yield* HttpClient.HttpClient;
  yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown))(yield* fs.readFileString(path));
  const response = yield* http.get(url);
  yield* response.text;
});
const waitReady = (child: ChildProcessSpawner.ChildProcessHandle, path: string, url: string) =>
  ready(path, url).pipe(
    Effect.timeout("2 seconds"),
    Effect.retry({ schedule: Schedule.spaced("250 millis"), times: 480 }),
    Effect.timeout("120 seconds"),
    Effect.raceFirst(unexpectedExit(child, "startup")),
  );
const startFork = Effect.fn("FirstTradeFlow.startFork")(function*() {
  const fs = yield* FileSystem.FileSystem;
  yield* fs.remove("work/first-trade/fork.json", { force: true });
  yield* run("sh", ["apps/signer/test/install-surfpool.sh"]);
  yield* run("bun", ["apps/signer/test/clone-programs.ts"]);
  const child = yield* start("bun", [
    "--preload",
    "./apps/floor/test/local-only.ts",
    "apps/signer/test/serve-local.ts",
  ]);
  yield* waitReady(child, "work/first-trade/fork.json", "http://127.0.0.1:19744");
  return Option.some(child);
});

const execute = Effect.fn("FirstTradeFlow.execute")(function*(mode: "test" | "serve") {
  const fs = yield* FileSystem.FileSystem;
  const externalFork = yield* Config.schema(Schema.NonEmptyString, "FLOOR_FORK_INFO").pipe(Config.option);
  const assets = yield* Config.schema(Schema.NonEmptyString, "FLOOR_TRADE_ASSETS").pipe(Config.option);
  // Admission never reuses or terminates another checkout's servers. The child scopes own only processes started here.
  yield* Effect.forEach(
    Option.isSome(externalFork) ? [19743] : [18899, 18900, 19744, 19743],
    port => reservePort({ host: "127.0.0.1", port }).pipe(Effect.scoped, Effect.asVoid),
  );
  yield* fs.makeDirectory("work/first-trade", { recursive: true });
  yield* fs.remove("work/first-trade/agent.json", { force: true });
  if (mode === "serve" && Option.isNone(assets)) {
    yield* run("bun", ["x", "vite", "build", "--config", "apps/web/vite.config.ts"]);
  }
  const fork = Option.isSome(externalFork) ? Option.none<ChildProcessSpawner.ChildProcessHandle>() : yield* startFork();
  const env = { FLOOR_FORK_INFO: Option.getOrElse(externalFork, () => "work/first-trade/fork.json") };
  const work = mode === "test"
    ? run("bun", [
      "test",
      "--preload",
      "./apps/floor/test/local-only.ts",
      "./apps/floor/test/first-trade.native.test.ts",
    ], env)
    : Effect.gen(function*() {
      const child = yield* start("bun", [
        "--preload",
        "./apps/floor/test/local-only.ts",
        "apps/floor/test/serve-first-trade.ts",
      ], env);
      yield* waitReady(child, "work/first-trade/agent.json", "http://127.0.0.1:19743");
      yield* Effect.log("First-trade browser fixture ready at http://127.0.0.1:19743");
      return yield* unexpectedExit(child, "agent");
    });
  yield* Option.match(fork, {
    onNone: () => work,
    onSome: child => work.pipe(Effect.raceFirst(unexpectedExit(child, "fork"))),
  });
}, Effect.scoped);

Command.make("first-trade", { mode: Argument.Literals("mode", ["test", "serve"]) }, ({ mode }) => execute(mode)).pipe(
  Command.run({ version: "1.0.0" }),
  // oxlint-disable-next-line effecttsgo/strict-effect-provide -- This executable owns the CLI, child-process and HTTP service scope.
  Effect.provide(Layer.merge(BunServices.layer, FetchHttpClient.layer)),
  BunRuntime.runMain,
);
