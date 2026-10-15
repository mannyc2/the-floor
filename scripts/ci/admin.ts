import { BunServices } from "@effect/platform-bun";
import { runMain } from "alchemy/Util/PlatformServices";
import { Effect } from "effect";
import { Command, Flag } from "effect/cli";
import { configurePreviewCi } from "./runtime";

// The command has a single administrative stage. The stack independently
// requires the explicitly selected floor-admin profile and selected account.
Command.make(
  "configure-preview-ci",
  {
    stage: Flag.Literals("stage", ["admin"]).pipe(Flag.withDefault("admin")),
  },
  Effect.fn("Preview.configureCiCommand")(function*({ stage }) {
    yield* configurePreviewCi(stage);
  }),
).pipe(
  Command.run({ version: "1.0.0" }),
  Effect.provide(BunServices.layer),
  runMain,
);
