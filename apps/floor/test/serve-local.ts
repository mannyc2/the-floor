import { BunRuntime } from "@effect/platform-bun";
import { makeFloorWorker } from "@floor/app-floor/worker";
import { localState, Stack } from "alchemy";
import { providers } from "alchemy/Cloudflare";
import * as Test from "alchemy/Test/Core";
import { Config, Effect } from "effect";

const options = { providers: providers(), state: localState(), dev: true, sidecar: false, stage: "floor-shell-local" };
const serve = Effect.gen(function*() {
  const port = yield* Config.Port("FLOOR_WORKER_PORT").pipe(Config.withDefault(19740));
  const stack = Stack(
    "FloorShellLocal",
    { providers: providers(), state: localState() },
    makeFloorWorker({
      devPort: port,
      assets: {
        directory: "apps/web/dist",
        runWorkerFirst: ["/api/*", "/mcp"],
        notFoundHandling: "single-page-application",
      },
    }),
  );
  const scope = yield* Effect.scope;
  yield* Test.deploy(options, stack, { scope });
  yield* Effect.addFinalizer(() => Test.destroy(options, stack).pipe(Effect.orDie));
  yield* Effect.log(`Floor local production entry ready at http://127.0.0.1:${port}`);
  return yield* Effect.never;
});

// oxlint-disable-next-line effecttsgo/any-unknown-in-error-context -- Alchemy erases the test harness error type; orDie contains that upstream boundary inside this process.
BunRuntime.runMain(Test.toEffect(serve, options).pipe(Effect.orDie));
