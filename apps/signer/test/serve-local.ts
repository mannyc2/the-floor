import { BunRuntime } from "@effect/platform-bun";
import { PoolReading } from "@floor/chains/solana/reader";
import { ChainRef } from "@floor/contract";
import { localState, Stack } from "alchemy";
import { providers } from "alchemy/Cloudflare";
import * as Test from "alchemy/Test/Core";
import { Effect, FileSystem, Schema } from "effect";
import { ForkConfiguration } from "../src/signer";
import { makeSignerWorker } from "../src/worker";
import { fixtureLayer, launchForkFixture } from "./fork-fixture";
import { forkEndpoint, startSurfpool } from "./surfpool";

const options = {
  providers: providers(),
  state: localState(),
  dev: true,
  sidecar: false,
  stage: "signer-first-trade-local",
};
const serve = Effect.gen(function*() {
  const scope = yield* Effect.scope;
  const fs = yield* FileSystem.FileSystem;
  yield* startSurfpool;
  const fixture = yield* launchForkFixture(forkEndpoint).pipe(Effect.provide(fixtureLayer(forkEndpoint)));
  const stack = Stack(
    "SignerFirstTradeLocal",
    { providers: providers(), state: localState() },
    makeSignerWorker({
      env: { FLOOR_FORK_CONFIGURATION: fixture.configuration, FLOOR_FORK_SECRET_KEY: fixture.secretKey },
    }),
  );
  yield* Test.deploy(options, stack, { scope });
  yield* Effect.addFinalizer(() => Test.destroy(options, stack).pipe(Effect.orDie));
  yield* fs.makeDirectory("work/first-trade", { recursive: true });
  const info = Schema.Struct({
    configuration: ForkConfiguration,
    reading: PoolReading,
    chain: ChainRef,
    signerUrl: Schema.String,
    payer: Schema.String,
  });
  yield* fs.writeFileString(
    "work/first-trade/fork.json",
    yield* Schema.encodeEffect(Schema.fromJsonString(Schema.toCodecJson(info)))({
      ...fixture,
      signerUrl: "http://127.0.0.1:19744",
    }),
  );
  yield* Effect.addFinalizer(() => fs.remove("work/first-trade/fork.json").pipe(Effect.orDie));
  yield* Effect.log("Fork and signer ready; public fixture metadata is in work/first-trade/fork.json");
  return yield* Effect.never;
});
// oxlint-disable-next-line effecttsgo/any-unknown-in-error-context -- Alchemy erases its harness error type; this executable contains it at the runtime boundary.
BunRuntime.runMain(Test.toEffect(serve, options).pipe(Effect.orDie));
