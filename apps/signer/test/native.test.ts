import { Signer } from "@floor/chains/signer";
import { signerClientLayer } from "@floor/chains/signer-client";
import { ConstructionError } from "@floor/chains/solana";
import { readPoolLayer } from "@floor/chains/solana/read-pool";
import { rpcResult, SolanaRpc } from "@floor/chains/solana/rpc";
import { MeteoraSwap } from "@floor/chains/solana/swap";
import { AssetRef, IntentId, PositiveUsd, Receipt, SwapIntent } from "@floor/contract";
import { localState, Stack } from "alchemy";
import { providers } from "alchemy/Cloudflare";
import * as Test from "alchemy/Test/Bun";
import { expect } from "bun:test";
import { DateTime, Effect, Exit, HashMap, Layer, Option, Ref, Schedule, Schema } from "effect";
import { Base64 } from "effect/encoding";
import { ForkKey } from "../src/fork-key";
import { SubmissionJournal } from "../src/journal";
import { forkSignerLayer } from "../src/signer";
import { makeSignerWorker } from "../src/worker";
import { fixtureLayer, launchForkFixture } from "./fork-fixture";
import { forkEndpoint, startSurfpool } from "./surfpool";

const harness = Test.make({ providers: providers(), dev: true, sidecar: false, stage: "signer-native" });
const deployed = harness.beforeAll(Effect.gen(function*() {
  yield* startSurfpool;
  const fixture = yield* launchForkFixture(forkEndpoint).pipe(Effect.provide(fixtureLayer(forkEndpoint)));
  const stack = Stack(
    "floor-signer-native",
    { providers: providers(), state: localState() },
    makeSignerWorker({
      env: { FLOOR_FORK_CONFIGURATION: fixture.configuration, FLOOR_FORK_SECRET_KEY: fixture.secretKey },
    }),
  );
  yield* Effect.addFinalizer(() => harness.destroy(stack).pipe(Effect.orDie));
  const output = yield* harness.deploy(stack);
  const url = yield* Effect.fromOption(Option.fromNullishOr(output.url));
  return { stack, url, fixture };
}));
const makeIntent = Effect.fn("fork.intent")(function*(id: string, slippageCap: number) {
  const { fixture } = yield* deployed;
  return SwapIntent.make({
    id: IntentId.make(id),
    agent: fixture.configuration.agent,
    owner: fixture.configuration.owner,
    chain: fixture.chain,
    requestedAt: yield* DateTime.now,
    sell: AssetRef.make(`${fixture.chain}/token:${fixture.reading.quoteMint}`),
    buy: AssetRef.make(`${fixture.chain}/token:${fixture.reading.baseMint}`),
    dollars: yield* Schema.decodeEffect(PositiveUsd)("1"),
    slippageCap,
  });
});

harness.test(
  "the native signer settles a real fork swap and repeated intent IDs do not submit again",
  Effect.gen(function*() {
    const { fixture, url } = yield* deployed;
    const intent = yield* makeIntent("settled-native", 0.05);
    const receipt = yield* Signer.use(signer => signer.submit(intent)).pipe(Effect.provide(signerClientLayer(url)));
    expect(receipt._tag).toBe("SettledReceipt");
    if (receipt._tag !== "SettledReceipt") return yield* Effect.die(receipt);
    expect(receipt.result).toBe("succeeded");
    expect(receipt.policy._tag).toBe("ForkPolicy");
    const transaction = yield* SolanaRpc.use(rpc =>
      rpcResult(
        rpc,
        Schema.Struct({
          slot: Schema.Natural,
          transaction: Schema.Struct({ message: Schema.Struct({ accountKeys: Schema.Array(Schema.String) }) }),
          meta: Schema.Struct({
            err: Schema.Null,
            postTokenBalances: Schema.Array(
              Schema.Struct({
                accountIndex: Schema.Natural,
                mint: Schema.String,
                uiTokenAmount: Schema.Struct({ amount: Schema.String }),
              }),
            ),
          }),
        }),
        "getTransaction",
        [receipt.transaction.hash, { encoding: "json", commitment: "confirmed", maxSupportedTransactionVersion: 0 }],
      )
    ).pipe(Effect.provide(SolanaRpc.layer(forkEndpoint)));
    expect(String(transaction.slot)).toBe(receipt.checkpoint.height);
    expect(
      transaction.meta.postTokenBalances.some(balance =>
        transaction.transaction.message.accountKeys[balance.accountIndex] === fixture.configuration.outputTokenAccount
        && balance.mint === fixture.reading.baseMint && BigInt(balance.uiTokenAmount.amount) > 0n
      ),
    ).toBe(true);
    const duplicate = yield* Signer.use(signer => signer.submit(intent)).pipe(Effect.provide(signerClientLayer(url)));
    expect(duplicate).toEqual(receipt);
    return void 0;
  }),
  { timeout: 120000 },
);

harness.test(
  "a swap past the slippage cap is refused before signing",
  Effect.gen(function*() {
    const { url } = yield* deployed;
    const intent = yield* makeIntent("slippage-native", 0);
    const receipt = yield* Signer.use(signer => signer.submit(intent)).pipe(Effect.provide(signerClientLayer(url)));
    expect(receipt._tag).toBe("RefusedReceipt");
    if (receipt._tag !== "RefusedReceipt") return yield* Effect.die(receipt);
    expect(receipt.refusal.code).toBe("simulationFailed");
    expect(receipt.refusal.detail).toContain("failed");
    return void 0;
  }),
  { timeout: 30000 },
);

harness.test(
  "the fork-key layer refuses an RPC with a different genesis",
  Effect.gen(function*() {
    const { fixture } = yield* deployed;
    const secretKey = yield* Effect.fromResult(Base64.decode(fixture.secretKey));
    const exit = yield* ForkKey.pipe(
      Effect.provide(
        ForkKey.layer({ endpoint: forkEndpoint, genesisHash: "a-different-fork", secretKey }).pipe(
          Layer.provide(SolanaRpc.layer(forkEndpoint)),
        ),
      ),
      Effect.exit,
    );
    expect(Exit.isFailure(exit)).toBe(true);
  }),
  { timeout: 30000 },
);

harness.test(
  "a lost submission response stays unknown and settles from the chain without rebroadcast",
  Effect.gen(function*() {
    const { fixture } = yield* deployed;
    const upstream = yield* SolanaRpc.pipe(Effect.provide(SolanaRpc.layer(forkEndpoint)));
    const submissions = yield* Ref.make(0);
    const rows = yield* Ref.make(HashMap.empty<IntentId, Receipt>());
    const journal = Layer.succeed(
      SubmissionJournal,
      SubmissionJournal.of({
        read: id => Ref.get(rows).pipe(Effect.map(HashMap.get(id))),
        write: receipt => Ref.update(rows, HashMap.set(receipt.action.id, receipt)),
      }),
    );
    const rpc = Layer.succeed(
      SolanaRpc,
      SolanaRpc.of({
        request: Effect.fn("test.lostReply")(function*(method, params) {
          const result = yield* upstream.request(method, params);
          if (method === "sendTransaction") {
            yield* Ref.update(submissions, count => count + 1);
            return yield* new ConstructionError({
              operation: "test.lostSubmissionResponse",
              cause: "The real fork accepted this transaction, then the test discarded its response",
            });
          }
          return result;
        }),
      }),
    );
    const secretKey = yield* Effect.fromResult(Base64.decode(fixture.secretKey));
    const dependencies = Layer.mergeAll(
      journal,
      MeteoraSwap.layer,
      readPoolLayer(fixture.chain),
      ForkKey.layer({ endpoint: forkEndpoint, genesisHash: fixture.configuration.genesisHash, secretKey }),
    ).pipe(Layer.provideMerge(rpc));
    const signer = yield* Signer.pipe(
      Effect.provide(forkSignerLayer(fixture.configuration).pipe(Layer.provide(dependencies))),
    );
    const intent = yield* makeIntent("unknown-native", 0.05);
    const pending = yield* signer.submit(intent);
    expect(pending._tag).toBe("UnknownReceipt");
    const settled = yield* signer.settle(intent.id).pipe(Effect.repeat({
      while: receipt => receipt._tag === "UnknownReceipt",
      schedule: Schedule.spaced("100 millis"),
      times: 20,
    }));
    expect(settled._tag).toBe("SettledReceipt");
    expect(yield* Ref.get(submissions)).toBe(1);
    const duplicate = yield* signer.submit(intent);
    expect(duplicate).toEqual(settled);
    expect(yield* Ref.get(submissions)).toBe(1);
  }),
  { timeout: 30000 },
);
