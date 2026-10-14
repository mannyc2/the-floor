import { BunRuntime } from "@effect/platform-bun";
import { makeFloorWorker } from "@floor/app-floor/worker";
import { localState, Stack } from "alchemy";
import { providers } from "alchemy/Cloudflare";
import * as Test from "alchemy/Test/Core";
import { Effect } from "effect";

const options = { providers: providers(), state: localState(), dev: true, sidecar: false, stage: "floor-shell-local" };
const stack = Stack(
  "FloorShellLocal",
  { providers: providers(), state: localState() },
  makeFloorWorker({
    assets: {
      directory: "apps/web/dist",
      runWorkerFirst: ["/api/*", "/mcp"],
      notFoundHandling: "single-page-application",
    },
  }),
);
const serve = Effect.gen(function*() {
  const scope = yield* Effect.scope;
  yield* Test.deploy(options, stack, { scope });
  yield* Effect.addFinalizer(() => Test.destroy(options, stack).pipe(Effect.orDie));
  yield* Effect.log("Floor local production entry ready at http://127.0.0.1:19740");
  return yield* Effect.never;
});

// oxlint-disable-next-line effecttsgo/any-unknown-in-error-context -- Alchemy erases the test harness error type; orDie contains that upstream boundary inside this process.
BunRuntime.runMain(Test.toEffect(serve, options).pipe(Effect.orDie));
