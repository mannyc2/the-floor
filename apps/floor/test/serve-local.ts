import { BunRuntime } from "@effect/platform-bun";
import { makeFloorWorker } from "@floor/app-floor/worker";
import { localState, Stack } from "alchemy";
import { providers } from "alchemy/Cloudflare";
import type { WorkerAssetsConfig } from "alchemy/Cloudflare/Workers/Worker";
import * as Test from "alchemy/Test/Core";
import { Config, Effect, Option, Redacted, Schedule, Schema } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import { makePreviewSeedWorker, SeedResult } from "./_preview-seed";

const options = { providers: providers(), state: localState(), dev: true, sidecar: false, stage: "floor-shell-local" };
const assets: WorkerAssetsConfig = {
  directory: "apps/web/dist",
  runWorkerFirst: ["/api/*", "/mcp"],
  notFoundHandling: "single-page-application",
};
const serve = Effect.gen(function*() {
  const port = yield* Config.Port("FLOOR_WORKER_PORT").pipe(Config.withDefault(19740));
  const seedPort = yield* Schema.decodeEffect(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 })))(
    port + 1,
  );
  // With a seed secret, serve the same pair a pr-<n> stage deploys and seed it the
  // way CI does, so the production-entry pick flow runs locally too.
  const secret = yield* Config.option(Config.Redacted("FLOOR_PREVIEW_SEED_SECRET"));
  const host = `floor-shell-local-${port}`;
  const stack = Stack(
    "FloorShellLocal",
    { providers: providers(), state: localState() },
    Effect.gen(function*() {
      const floor = yield* makeFloorWorker({ devPort: port, name: host, assets });
      if (Option.isNone(secret)) return { url: floor.url };
      yield* makePreviewSeedWorker({
        name: `${host}-seed`,
        hostScript: host,
        host: floor.workerName,
        devPort: seedPort,
      });
      return { url: floor.url };
    }),
  );
  const scope = yield* Effect.scope;
  yield* Test.deploy(options, stack, { scope });
  yield* Effect.addFinalizer(() => Test.destroy(options, stack).pipe(Effect.orDie));
  if (Option.isSome(secret)) {
    const http = yield* HttpClient.HttpClient;
    const seeded = yield* HttpClientRequest.post(`http://127.0.0.1:${seedPort}/seed`).pipe(
      HttpClientRequest.bearerToken(Redacted.value(secret.value)),
      http.execute,
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap(HttpClientResponse.schemaBodyJson(SeedResult)),
      // The local registry can route a cross-script binding a moment after deploy
      // returns. Seeding is idempotent, so retrying cannot duplicate events.
      Effect.retry({ schedule: Schedule.spaced("500 millis"), times: 40 }),
    );
    yield* Effect.log(`Seeded the synthetic world through ${seeded.joined.world}`);
  }
  yield* Effect.log(`Floor local production entry ready at http://127.0.0.1:${port}`);
  return yield* Effect.never;
});

// oxlint-disable-next-line effecttsgo/any-unknown-in-error-context -- Alchemy erases the test harness error type; orDie contains that upstream boundary inside this process.
BunRuntime.runMain(Test.toEffect(serve.pipe(Effect.provide(FetchHttpClient.layer)), options).pipe(Effect.orDie));
