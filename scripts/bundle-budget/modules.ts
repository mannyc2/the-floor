import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Effect } from "effect";
import { Command, Flag } from "effect/cli";
import { inspectModules } from "./graph";

const command = Command.make(
  "bundle-modules",
  {
    directory: Flag.String("directory"),
  },
  ({ directory }) => inspectModules(directory),
);

command.pipe(
  Command.run({ version: "1.0.0" }),
  Effect.provide(BunServices.layer),
  BunRuntime.runMain,
);
