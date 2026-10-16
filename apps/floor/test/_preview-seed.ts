import { JoinWorld, LandWorldReceipt, WorldPublisher } from "@floor/api/world";
import { WorldEvent } from "@floor/contract/world-events";
import type { Providers } from "alchemy/Cloudflare";
import { Request } from "alchemy/Cloudflare/Workers/Request";
import { Worker } from "alchemy/Cloudflare/Workers/Worker";
import type { Input } from "alchemy/Input";
import { Config, Effect, Option, Redacted, Schema } from "effect";
import { HttpServerResponse } from "effect/http";
import { remoteWorldPublisher } from "../src/world/runtime";
import { join, receipt } from "./_world-fixture";

// The seeded world reuses the native world test's synthetic fixture: its agent,
// world, chain and refused receipt are all named and described as synthetic.
export const SeedResult = Schema.Struct({
  host: Schema.OptionFromNullOr(Schema.String),
  joined: WorldEvent,
  landed: WorldEvent,
});

// Every character is compared whatever the first difference, so response time
// does not reveal how much of a guess matched.
const sameSecret = (presented: string, expected: string) => {
  let difference = presented.length ^ expected.length;
  for (let index = 0; index < expected.length; index++) {
    difference |= expected.charCodeAt(index) ^ presented.charCodeAt(index);
  }
  return difference === 0;
};

/**
 * A preview-only Worker that writes the synthetic fixture into a host Floor
 * Worker's world namespace through a cross-script Durable Object binding. The
 * production Floor Worker keeps no mutation route; this script exists only in a
 * `pr-<n>` stage or a local test stack, and is destroyed with it.
 */
export const makePreviewSeedWorker = Effect.fn("makePreviewSeedWorker")(
  function*(options: {
    readonly name: string;
    // The binding needs the host's physical script name while planning, so the
    // stage names its Floor Worker explicitly.
    readonly hostScript: string;
    // Referencing the deployed host orders deploys host-first and deletions seed-first.
    readonly host: Input<string>;
    readonly devPort?: number;
  }): Effect.fn.Return<Worker<{}>, never, Providers> {
    return yield* Worker(
      "FloorPreviewSeed",
      {
        name: options.name,
        main: import.meta.url,
        compatibility: { date: "2026-08-18", flags: [] },
        dev: { host: "127.0.0.1", port: options.devPort ?? 19741 },
        env: { FLOOR_PREVIEW_HOST: options.host },
      },
      Effect.gen(function*() {
        // Bound as a secret when the deploying process supplies a per-run value.
        // Without one, every seed request is refused.
        const secret = yield* Config.option(Config.Redacted("FLOOR_PREVIEW_SEED_SECRET"));
        const host = yield* Config.option(Config.String("FLOOR_PREVIEW_HOST"));
        const publisher = yield* WorldPublisher;
        return {
          fetch: Effect.gen(function*() {
            const request = yield* Request;
            if (request.method !== "POST" || new URL(request.url).pathname !== "/seed") {
              return HttpServerResponse.empty({ status: 404 });
            }
            const presented = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
            if (Option.isNone(secret) || !sameSecret(presented, Redacted.value(secret.value))) {
              return HttpServerResponse.empty({ status: 401 });
            }
            const joined = yield* publisher.join(JoinWorld.make(join));
            const landed = yield* publisher.receipt(LandWorldReceipt.make({ ...join, receipt }));
            return yield* HttpServerResponse.schemaJson(SeedResult)({ host, joined, landed });
          }).pipe(Effect.orDie),
        };
      }).pipe(Effect.provide(remoteWorldPublisher(options.hostScript))),
    );
  },
);

// The deployed bundle resolves its namespace from the uploaded binding; these
// planning inputs are replaced by the stack's values before upload.
export default makePreviewSeedWorker({ name: "floor-preview-seed", hostScript: "floor", host: "floor" });
