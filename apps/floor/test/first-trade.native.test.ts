import { WorldFrame, WorldPublishError } from "@floor/api/world";
import { WorldRpcs } from "@floor/api/world-rpc";
import { rpcResult, SolanaRpc } from "@floor/chains/solana/rpc";
import { Receipt } from "@floor/contract/economics";
import { WorldId } from "@floor/contract/identifiers";
import { localState, Stack } from "alchemy";
import { providers } from "alchemy/Cloudflare";
import * as Test from "alchemy/Test/Bun";
import { expect } from "bun:test";
import { Effect, Layer, Option, Queue, Schema, Stream } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import { RpcClient, RpcClientError, RpcSerialization } from "effect/rpc";
import { TradeMandate } from "../src/agents/mandate";
import { readTradeConfiguration, TradeConfiguration } from "./_trade-configuration";
import { makeTradeTestWorker } from "./_trade-worker";

const harness = Test.make({ providers: providers(), dev: true, sidecar: false, stage: "first-agent-native" });
const deployed = harness.beforeAll(Effect.gen(function*() {
  const configuration = yield* readTradeConfiguration(WorldId.make("first-agent-native"));
  const stack = Stack(
    "floor-first-agent-native",
    { providers: providers(), state: localState() },
    makeTradeTestWorker({
      env: { FLOOR_TRADE_CONFIGURATION: yield* Schema.encodeEffect(TradeConfiguration)(configuration) },
    }),
  );
  yield* Effect.addFinalizer(() => harness.destroy(stack).pipe(Effect.orDie));
  const output = yield* harness.deploy(stack);
  const url = yield* Schema.decodeUnknownEffect(Schema.NonEmptyString)(output.url);
  return { configuration, url };
}));

harness.test(
  "a native first agent reads the fork, settles a swap and publishes its ordered world activity",
  Effect.gen(function*() {
    const { configuration, url } = yield* deployed;
    const input = configuration.mandate;
    const http = yield* HttpClient.HttpClient;
    yield* Effect.gen(function*() {
      const client = yield* RpcClient.make(WorldRpcs);
      const frames = yield* Queue.unbounded<
        typeof WorldFrame.Type,
        WorldPublishError | RpcClientError.RpcClientError
      >();
      yield* client.watchWorld({ world: input.world, chain: input.intent.chain, after: Option.none() }).pipe(
        Stream.runForEach(frame => Queue.offer(frames, frame)),
        Effect.catchCause(cause => Queue.failCause(frames, cause)),
        Effect.forkScoped,
      );
      const initial = yield* Queue.take(frames).pipe(Effect.timeout("10 seconds"));
      expect(initial._tag).toBe("Snapshot");
      if (initial._tag !== "Snapshot") return yield* Effect.die("Expected initial world snapshot");
      expect(initial.snapshot.sequence).toBe(0);
      const submit = HttpClientRequest.post(`${url}/trade`).pipe(
        HttpClientRequest.bodyJson(yield* Schema.encodeEffect(Schema.toCodecJson(TradeMandate))(input)),
        Effect.flatMap(http.execute),
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.flatMap(HttpClientResponse.schemaBodyJson(Receipt)),
        Effect.timeout("45 seconds"),
      );
      const receipt = yield* submit;
      expect(receipt._tag).toBe("SettledReceipt");
      if (receipt._tag !== "SettledReceipt") return yield* Effect.die(receipt);
      expect(receipt.result).toBe("succeeded");
      expect(receipt.action).toEqual(input.intent);
      expect(receipt.policy._tag).toBe("ForkPolicy");
      const delivered = yield* Effect.forEach([1, 2, 3, 4, 5], () => Queue.take(frames)).pipe(
        Effect.timeout("10 seconds"),
      );
      expect(delivered.map(frame => frame._tag === "Delivery" ? frame.sequence : -1)).toEqual([1, 2, 3, 4, 5]);
      expect(delivered.map(frame => frame._tag === "Delivery" ? frame.delivery.event._tag : frame._tag)).toEqual([
        "AgentJoined",
        "AgentStateChanged",
        "AgentStateChanged",
        "ReceiptLanded",
        "AgentStateChanged",
      ]);
      expect(
        delivered.flatMap(frame =>
          frame._tag === "Delivery" && frame.delivery.event._tag === "AgentStateChanged"
            ? [frame.delivery.event.state]
            : []
        ),
      ).toEqual(["researching", "trading", "idle"]);
      const landed = delivered[3];
      expect(landed?._tag === "Delivery" ? landed.receipt : Option.none()).toEqual(Option.some(receipt));
      const transaction = yield* SolanaRpc.use(rpc =>
        rpcResult(
          rpc,
          Schema.Struct({ slot: Schema.Natural, meta: Schema.Struct({ err: Schema.Null }) }),
          "getTransaction",
          [receipt.transaction.hash, { encoding: "json", commitment: "confirmed", maxSupportedTransactionVersion: 0 }],
        )
      ).pipe(Effect.provide(SolanaRpc.layer(configuration.endpoint)));
      expect(String(transaction.slot)).toBe(receipt.checkpoint.height);
      const latest = yield* client.watchWorld({ world: input.world, chain: input.intent.chain, after: Option.none() })
        .pipe(
          Stream.take(1),
          Stream.runCollect,
        );
      const snapshot = latest[0];
      if (snapshot?._tag !== "Snapshot") return yield* Effect.die("Expected final world snapshot");
      expect(snapshot.snapshot.sequence).toBe(5);
      expect(snapshot.snapshot.agents[0]?.state).toEqual(Option.some("idle"));
      expect(snapshot.snapshot.agents[0]?.receipt).toEqual(Option.some(receipt));
      expect(snapshot.snapshot.checkpoint).toEqual(Option.some(receipt.checkpoint));
      const repeated = yield* submit;
      expect(repeated).toEqual(receipt);
      const retried = yield* client.watchWorld({ world: input.world, chain: input.intent.chain, after: Option.none() })
        .pipe(
          Stream.take(1),
          Stream.runCollect,
        );
      const retrySnapshot = retried[0];
      if (retrySnapshot?._tag !== "Snapshot") return yield* Effect.die("Expected snapshot after the repeated intent");
      // The run may report its activity again, but join and the same terminal receipt remain journal-idempotent.
      expect(retrySnapshot.snapshot.sequence).toBe(8);
      expect(retrySnapshot.snapshot.agents[0]?.state).toEqual(Option.some("idle"));
      expect(retrySnapshot.snapshot.agents[0]?.receipt).toEqual(Option.some(receipt));
      return void 0;
    }).pipe(
      Effect.scoped,
      Effect.provide(
        RpcClient.layerProtocolHttp({ url: `${url}/api/world` }).pipe(Layer.provide(RpcSerialization.layerNdjson)),
      ),
    );
  }),
  { timeout: 120000 },
);
