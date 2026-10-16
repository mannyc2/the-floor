import { makeFloorWorker } from "@floor/app-floor/worker";
import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import type { WorkerAssetsConfig } from "alchemy/Cloudflare/Workers/Worker";
import { Effect, Schema } from "effect";
import { makePreviewSeedWorker } from "./apps/floor/test/_preview-seed";
import { PreviewStage, ProjectStage, requireSelectedAccount } from "./stacks/_lib/policy";

export default Alchemy.Stack(
  "Floor",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function*() {
    const stage = yield* Schema.decodeEffect(ProjectStage)(yield* Alchemy.Stage).pipe(Effect.orDie);
    const { accountId } = yield* yield* Cloudflare.CloudflareEnvironment;
    yield* requireSelectedAccount(accountId).pipe(Effect.orDie);
    const preview = Schema.is(PreviewStage)(stage);
    const assets: WorkerAssetsConfig = {
      directory: "apps/web/dist",
      runWorkerFirst: ["/api/*", "/mcp"],
      notFoundHandling: "single-page-application",
    };
    if (!preview) return { url: (yield* makeFloorWorker({ assets })).url };
    // Hosted acceptance picks a seeded desk. Only pr-<n> stages add the test-built
    // seed Worker, which binds this stage's world namespace by its script name.
    const floor = yield* makeFloorWorker({ assets, name: `floor-${stage}` });
    const seed = yield* makePreviewSeedWorker({
      name: `floor-seed-${stage}`,
      hostScript: `floor-${stage}`,
      host: floor.workerName,
    });
    return { url: floor.url, seed: seed.url };
  }),
);
