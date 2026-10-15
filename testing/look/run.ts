import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Effect } from "effect";
import { Command, Flag } from "effect/cli";
import { runPhoneHarness } from "./driver";

const command = Command.make(
  "phone-profile",
  {
    url: Flag.String("url"),
    output: Flag.String("out"),
    renderer: Flag.Literals("renderer", ["swiftshader", "apple"]).pipe(Flag.withDefault("swiftshader")),
  },
  Effect.fn("PhoneProfile.command")(function*({ url, output, renderer }) {
    yield* runPhoneHarness({ url, output, renderer });
    yield* Effect.logInfo(`Completed phone profile; evidence retained in ${output}`);
  }),
);

if (import.meta.main) {
  BunRuntime.runMain(command.pipe(Command.run({ version: "1.0.0" }), Effect.provide(BunServices.layer)));
}
