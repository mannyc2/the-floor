import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Effect } from "effect";
import { Command, Flag } from "effect/cli";
import { runLookHarness } from "./driver";

const command = Command.make(
  "look-harness",
  {
    url: Flag.String("url"),
    output: Flag.String("out"),
    mode: Flag.Literals("mode", ["matrix", "phone", "impostor"]),
    renderer: Flag.Literals("renderer", ["swiftshader", "apple"]).pipe(Flag.withDefault("swiftshader")),
    repetitions: Flag.Int("repetitions").pipe(Flag.withDefault(20)),
  },
  Effect.fn("LookHarness.command")(function*({ url, output, mode, renderer, repetitions }) {
    yield* runLookHarness({ url, output, renderer }, mode, repetitions);
    yield* Effect.logInfo(`Completed ${mode}; evidence retained in ${output}`);
  }),
);

if (import.meta.main) {
  // oxlint-disable-next-line effecttsgo/strict-effect-provide -- The CLI owns terminal/argument parsing services; the driver owns browser work.
  BunRuntime.runMain(command.pipe(Command.run({ version: "1.0.0" }), Effect.provide(BunServices.layer)));
}
