import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Effect, FileSystem, Path } from "effect";
import { Command, Flag } from "effect/cli";
import { encodeTraderKit } from "../../src/map/_lib/assets/trader-kit";
import { bakeTraderKit } from "./bake";
import { GltfError } from "./gltf";

// Bakes the trader kit to `--out`. The web build runs this under Bun, which
// loads the workspace's TypeScript packages that the bake shares with the
// viewer; Vite's own config runs under Node.
const command = Command.make(
  "trader-kit",
  { out: Flag.String("out") },
  Effect.fn("TraderKit.bake")(function*({ out }) {
    const files = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const sources = yield* path.fromFileUrl(new URL("../../../../assets/traders/source/", import.meta.url)).pipe(
      Effect.mapError(cause => new GltfError({ reason: "locate sources", cause })),
    );
    const kit = yield* bakeTraderKit(name =>
      files.readFile(path.join(sources, name)).pipe(
        Effect.mapError(cause => new GltfError({ reason: `read ${name}`, cause })),
      )
    );
    yield* files.makeDirectory(path.dirname(out), { recursive: true });
    yield* files.writeFile(out, yield* encodeTraderKit(kit));
  }),
);

command.pipe(
  Command.run({ version: "1.0.0" }),
  // oxlint-disable-next-line effecttsgo/strict-effect-provide -- This executable owns the CLI and its platform services.
  Effect.provide(BunServices.layer),
  BunRuntime.runMain,
);
