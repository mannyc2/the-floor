import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Effect } from "effect";
import { Command, Flag } from "effect/cli";
import { inspectModules } from "./graph";

const command = Command.make(
  "bundle-modules",
  {
    target: Flag.Literals("target", ["web", "floor", "signer"]),
    directory: Flag.String("directory"),
    entry: Flag.String("entry").pipe(Flag.atLeast(1)),
  },
  Effect.fn("BundleModules.check")(function*(options) {
    const result = yield* inspectModules(options);
    yield* Effect.logInfo(
      `${options.target}: ${result.modules} emitted modules, ${result.mappedSources} mapped sources inspected`,
    );
  }),
);

command.pipe(
  Command.run({ version: "1.0.0" }),
  // oxlint-disable-next-line effecttsgo/strict-effect-provide -- The artifact-inspection executable owns its filesystem and cryptographic digest services.
  Effect.provide(BunServices.layer),
  BunRuntime.runMain,
);
