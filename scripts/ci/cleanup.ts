import { BunServices } from "@effect/platform-bun";
import { runMain } from "alchemy/Util/PlatformServices";
import { Effect } from "effect";
import { Command, Flag } from "effect/cli";
import { destroyPreview } from "./runtime";

Command.make(
  "cleanup-preview",
  { stage: Flag.String("stage") },
  Effect.fn("Preview.cleanup")(function*({ stage }) {
    yield* destroyPreview(stage);
  }),
).pipe(
  Command.run({ version: "1.0.0" }),
  // oxlint-disable-next-line effecttsgo/strict-effect-provide -- The executable owns CLI services; rejected stages never acquire the live deployment runtime.
  Effect.provide(BunServices.layer),
  runMain,
);
