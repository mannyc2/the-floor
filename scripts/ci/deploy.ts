import { BunServices } from "@effect/platform-bun";
import { runMain } from "alchemy/Util/PlatformServices";
import { Effect, FileSystem, Schema } from "effect";
import { Command, Flag } from "effect/cli";
import { deployPreview } from "./runtime";

const command = Command.make(
  "preview",
  { stage: Flag.String("stage") },
  Effect.fn("Preview.command")(function*({ stage }) {
    const output = yield* deployPreview(stage);
    const fs = yield* FileSystem.FileSystem;
    yield* fs.makeDirectory("work/ci", { recursive: true });
    yield* fs.writeFileString(
      "work/ci/preview.json",
      yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Json))(output),
    );
  }),
);

command.pipe(
  Command.run({ version: "1.0.0" }),
  // oxlint-disable-next-line effecttsgo/strict-effect-provide -- The executable owns CLI and artifact I/O; the live engine is acquired only after stage validation.
  Effect.provide(BunServices.layer),
  runMain,
);
