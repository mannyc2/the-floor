import { localState, Stack } from "alchemy";
import { providers } from "alchemy/Cloudflare";
import * as Test from "alchemy/Test/Bun";
import { expect } from "bun:test";
import { Effect, FileSystem, Option, Schema } from "effect";
import { HttpClient } from "effect/http";
import { makeSignerWorker } from "../src/worker";

const harness = Test.make({ providers: providers(), dev: true, sidecar: false, stage: "signer-build" });
const stack = Stack("floor-signer-build", { providers: providers(), state: localState() }, makeSignerWorker());
const deployed = harness.beforeAll(Effect.gen(function*() {
  yield* Effect.addFinalizer(() => harness.destroy(stack).pipe(Effect.orDie));
  return yield* harness.deploy(stack);
}));
const SourceMap = Schema.Struct({ sources: Schema.NonEmptyArray(Schema.String) });
const excluded =
  /(?:^|[/\\])(?:@yielded|@anthropic-ai|openai|@effect\/ai-[^/]+|apps\/floor)(?:[/\\]|$)|effect\/(?:src\/)?(?:unstable\/)?ai\//;

harness.test(
  "Alchemy starts the signer Worker and its bundle excludes models and Floor application code",
  Effect.gen(function*() {
    const output = yield* deployed;
    const url = yield* Effect.fromOption(Option.fromNullishOr(output.url));
    const response = yield* (yield* HttpClient.HttpClient).get(`${url}/`);
    expect(response.status).toBe(404);
    const fs = yield* FileSystem.FileSystem;
    const directory = ".alchemy/bundles/SignerWorker";
    const files = yield* fs.readDirectory(directory, { recursive: true });
    const maps = files.filter(file => /\.[cm]?js\.map$/.test(file));
    expect(maps.length).toBeGreaterThan(0);
    for (const file of maps) {
      const map = yield* fs.readFileString(`${directory}/${file}`).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(SourceMap))),
      );
      for (const source of map.sources) expect(source).not.toMatch(excluded);
    }
  }),
  { timeout: 120000 },
);
