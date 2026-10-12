import { makeFloorWorker } from "@floor/app-floor/worker";
import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { Effect, Schema } from "effect";
import { ProjectStage, requireSelectedAccount } from "./stacks/_lib/policy";

export default Alchemy.Stack(
  "Floor",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function*() {
    yield* Schema.decodeEffect(ProjectStage)(yield* Alchemy.Stage).pipe(Effect.orDie);
    const { accountId } = yield* yield* Cloudflare.CloudflareEnvironment;
    yield* requireSelectedAccount(accountId).pipe(Effect.orDie);
    const floor = yield* makeFloorWorker({
      assets: { directory: "apps/web/dist", runWorkerFirst: ["/api/*"], notFoundHandling: "single-page-application" },
    });
    return { url: floor.url };
  }),
);
