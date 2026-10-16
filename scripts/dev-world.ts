import { BunRuntime, BunServices } from "@effect/platform-bun";
import { make as reservePort } from "@effect/platform-node/NodeSocketServer";
import { Config, Effect, FileSystem, Layer, Schedule, Schema } from "effect";
import { Command, Flag } from "effect/cli";
import { FetchHttpClient, HttpClient } from "effect/http";
import { ChildProcess, type ChildProcessSpawner } from "effect/process";
import { DevWorldFloors, DevWorldMetadataJson, ProposalSeed } from "../apps/floor/test/_dev-world";

// `bun run dev:world` builds the production viewer with the development layout
// switch, starts the local world test Worker with a labelled synthetic world,
// and prints where to open it. Ctrl-C stops the Worker and removes its state.
class DevWorldError extends Schema.TaggedError<DevWorldError>()("DevWorldError", {
  operation: Schema.String,
  cause: Schema.Defect(),
}) {}

const metadataPath = "work/dev-world/world.json";
const start = (command: string, args: ReadonlyArray<string>, env: Record<string, string> = {}) =>
  ChildProcess.make(command, args, {
    env: { CI: "true", ALCHEMY_TELEMETRY_DISABLED: "1", ...env },
    extendEnv: true,
    stdout: "inherit",
    stderr: "inherit",
    killSignal: "SIGTERM",
    forceKillAfter: "20 seconds",
  });
const unexpectedExit = (child: ChildProcessSpawner.ChildProcessHandle, operation: string) =>
  child.exitCode.pipe(Effect.flatMap(code => Effect.fail(new DevWorldError({ operation, cause: { code } }))));
const ready = Effect.fn("DevWorld.ready")(function*(url: string) {
  const fs = yield* FileSystem.FileSystem;
  const http = yield* HttpClient.HttpClient;
  const metadata = yield* Schema.decodeEffect(DevWorldMetadataJson)(yield* fs.readFileString(metadataPath));
  yield* http.get(url).pipe(Effect.flatMap(response => response.text));
  return metadata;
});

const execute = Effect.fn("DevWorld.execute")(function*({ layout, floors, seed }: {
  readonly layout: "proposal" | "grid";
  readonly floors: typeof DevWorldFloors.Type;
  readonly seed: typeof ProposalSeed.Type;
}) {
  const fs = yield* FileSystem.FileSystem;
  const port = yield* Config.Port("FLOOR_WORKER_PORT").pipe(Config.withDefault(19740));
  // An occupied listener is never reused or terminated; this run owns only what it starts.
  yield* reservePort({ host: "127.0.0.1", port }).pipe(Effect.scoped, Effect.asVoid);
  yield* fs.remove(metadataPath, { force: true });
  const build = yield* start("bun", [
    "x",
    "vite",
    "build",
    "--config",
    "apps/web/vite.config.ts",
    "--mode",
    "dev-world",
    "--logLevel",
    "warn",
  ]);
  const built = yield* build.exitCode;
  if (built !== 0) return yield* new DevWorldError({ operation: "build", cause: { code: built } });
  const server = yield* start("bun", [
    "--preload",
    "./apps/floor/test/local-only.ts",
    "apps/floor/test/serve-dev-world.ts",
  ], {
    FLOOR_WORKER_PORT: String(port),
    FLOOR_DEV_WORLD_FLOORS: String(floors),
    FLOOR_DEV_WORLD_SEED: String(seed),
    FLOOR_DEV_WORLD_ASSETS: "work/dev-world/web",
    FLOOR_DEV_WORLD_METADATA: metadataPath,
  });
  // Ten full floors publish thousands of arrivals; the server logs its progress.
  const metadata = yield* ready(`http://127.0.0.1:${port}/`).pipe(
    Effect.timeout("2 seconds"),
    Effect.retry({ schedule: Schedule.spaced("500 millis"), times: 2400 }),
    Effect.raceFirst(unexpectedExit(server, "startup")),
  );
  const [first, second] = layout === "proposal"
    ? [["proposal", metadata.urls.proposal], ["grid", metadata.urls.grid]]
    : [["grid", metadata.urls.grid], ["proposal", metadata.urls.proposal]];
  yield* Effect.log([
    `Development world ready: ${metadata.floors} occupied floors and a blueprint, seed ${metadata.seed}.`,
    `Open the ${first[0]} layout: ${first[1]}`,
    `Same world, ${second[0]} layout: ${second[1]}`,
    "Switch layout or scale with the links at the top of the page. Ctrl-C stops the world.",
  ].join("\n"));
  return yield* unexpectedExit(server, "server");
}, Effect.scoped);

Command.make("dev-world", {
  layout: Flag.Literals("layout", ["proposal", "grid"]).pipe(
    Flag.withDescription("The layout whose URL is printed first; the page switches between both"),
    Flag.withDefault("proposal"),
  ),
  floors: Flag.Int("floors").pipe(
    Flag.withSchema(DevWorldFloors),
    Flag.withDescription("Occupied floors, beside one blueprint"),
    Flag.withDefault(4),
  ),
  seed: Flag.Int("seed").pipe(
    Flag.withSchema(ProposalSeed),
    Flag.withDescription("The proposal's seed, shared by both layouts' URLs"),
    Flag.withDefault(20261014),
  ),
}, execute).pipe(
  Command.run({ version: "1.0.0" }),
  // oxlint-disable-next-line effecttsgo/strict-effect-provide -- This executable owns the CLI, child-process and HTTP service scope.
  Effect.provide(Layer.merge(BunServices.layer, FetchHttpClient.layer)),
  BunRuntime.runMain,
);
