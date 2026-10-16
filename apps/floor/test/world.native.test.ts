import {
  ChangeWorldState,
  JoinWorld,
  LandWorldReceipt,
  MoveInWorld,
  WorldFrame,
  WorldPublishError,
} from "@floor/api/world";
import { WorldRpcs } from "@floor/api/world-rpc";
import { Receipt } from "@floor/contract/economics";
import { ChainRef, DeskId, ReceiptId, TradingPostId } from "@floor/contract/identifiers";
import { AgentLocation } from "@floor/contract/world";
import { WorldEvent, WorldEventDelivery } from "@floor/contract/world-events";
import { localState, Stack } from "alchemy";
import { providers } from "alchemy/Cloudflare";
import * as Test from "alchemy/Test/Bun";
import { expect } from "bun:test";
import { Effect, Fiber, Layer, Option, Queue, Result, Schema, Stream } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import { RpcClient, RpcClientError, RpcSerialization } from "effect/rpc";
import { chain, join, receipt, world } from "./_world-fixture";
import { makeWorldTestWorker } from "./_world-worker";

const stack = Stack("floor-world-local", { providers: providers(), state: localState() }, makeWorldTestWorker());
const { test, deploy, destroy, beforeAll, afterAll } = Test.make({
  providers: providers(),
  dev: true,
  sidecar: false,
  stage: "floor-world-local",
});
// oxlint-disable-next-line effect/noTestLifecycleHooks -- Alchemy's native harness owns the Worker across stream and publication requests.
const deployed = beforeAll(deploy(stack));
// oxlint-disable-next-line effect/noTestLifecycleHooks -- Destroy the native Worker before the harness closes its scope.
afterAll(destroy(stack));

test(
  "native world stream retains ordered join, state, receipt and movement across reconnect",
  Effect.gen(function*() {
    const output = yield* deployed;
    const url = yield* Schema.decodeUnknownEffect(Schema.NonEmptyString)(output.url);
    const http = yield* HttpClient.HttpClient;
    const post = Effect.fnUntraced(function*(path: string, body: Schema.Json) {
      return yield* HttpClientRequest.post(`${url}${path}`).pipe(
        HttpClientRequest.bodyJson(body),
        Effect.flatMap(http.execute),
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.flatMap(HttpClientResponse.schemaBodyJson(WorldEvent)),
      );
    });
    yield* Effect.gen(function*() {
      const client = yield* RpcClient.make(WorldRpcs);
      const frames = yield* Queue.unbounded<
        typeof WorldFrame.Type,
        WorldPublishError | RpcClientError.RpcClientError
      >();
      const live = yield* client.watchWorld({ world, chain, after: Option.none() }).pipe(
        Stream.runForEach(frame => Queue.offer(frames, frame)),
        Effect.catchCause(cause => Queue.failCause(frames, cause)),
        Effect.forkScoped,
      );
      const first = yield* Queue.take(frames).pipe(Effect.timeout("10 seconds"));
      expect(first._tag).toBe("Snapshot");
      if (first._tag !== "Snapshot") return yield* Effect.die("Expected initial snapshot");
      expect(first.snapshot.sequence).toBe(0);
      expect(first.snapshot.checkpoint).toEqual(Option.none());
      const mismatchedFrames = yield* Queue.unbounded<
        typeof WorldFrame.Type,
        WorldPublishError | RpcClientError.RpcClientError
      >();
      yield* client.watchWorld({ world, chain: ChainRef.make("solana:another-fork"), after: Option.none() }).pipe(
        Stream.runForEach(frame => Queue.offer(mismatchedFrames, frame)),
        Effect.catchCause(cause => Queue.failCause(mismatchedFrames, cause)),
        Effect.forkScoped,
      );
      yield* Queue.take(mismatchedFrames).pipe(Effect.timeout("10 seconds"));
      const joined = yield* post("/join", yield* Schema.encodeEffect(Schema.toCodecJson(JoinWorld))(join));
      const next = yield* Queue.take(frames).pipe(Effect.timeout("10 seconds"));
      expect(next._tag).toBe("Delivery");
      if (next._tag !== "Delivery") return yield* Effect.die("Expected joined delivery");
      expect(next.sequence).toBe(1);
      expect(next.delivery).toEqual(WorldEventDelivery.cases.Live.make({ event: joined }));
      const mismatched = yield* Queue.take(mismatchedFrames).pipe(Effect.timeout("10 seconds"), Effect.result);
      expect(Result.isFailure(mismatched)).toBe(true);
      if (Result.isFailure(mismatched)) expect(mismatched.failure._tag).toBe("WorldPublishError");
      yield* Fiber.interrupt(live);
      const duplicate = yield* post("/join", yield* Schema.encodeEffect(Schema.toCodecJson(JoinWorld))(join));
      expect(duplicate).toEqual(joined);
      yield* post(
        "/state",
        yield* Schema.encodeEffect(Schema.toCodecJson(ChangeWorldState))({ ...join, state: "researching" }),
      );
      const firstReceiptEvent = yield* post(
        "/receipt",
        yield* Schema.encodeEffect(Schema.toCodecJson(LandWorldReceipt))({ ...join, receipt }),
      );
      const resumed = yield* client.watchWorld({ world, chain, after: Option.some(next.sequence) }).pipe(
        Stream.take(3),
        Stream.runCollect,
        Effect.timeout("10 seconds"),
      );
      expect(resumed.map(frame => frame._tag === "Snapshot" ? frame.snapshot.sequence : frame.sequence)).toEqual([
        1,
        2,
        3,
      ]);
      expect(resumed.map(frame => frame._tag === "Snapshot" ? "Snapshot" : frame.delivery.event._tag)).toEqual([
        "Snapshot",
        "AgentStateChanged",
        "ReceiptLanded",
      ]);
      yield* post("/receipt", yield* Schema.encodeEffect(Schema.toCodecJson(LandWorldReceipt))({ ...join, receipt }));
      const latest = yield* client.watchWorld({ world, chain, after: Option.none() }).pipe(
        Stream.take(1),
        Stream.runCollect,
      );
      const snapshot = latest[0];
      if (snapshot?._tag !== "Snapshot") return yield* Effect.die("Expected current snapshot");
      expect(snapshot.snapshot.sequence).toBe(3);
      expect(snapshot.snapshot.agents[0]?.state).toEqual(Option.some("researching"));
      expect(snapshot.snapshot.agents[0]?.receipt).toEqual(Option.some(receipt));
      const newerReceipt = Receipt.cases.RefusedReceipt.make({
        ...receipt,
        id: ReceiptId.make("synthetic-newer-receipt"),
      });
      yield* post(
        "/receipt",
        yield* Schema.encodeEffect(Schema.toCodecJson(LandWorldReceipt))({ ...join, receipt: newerReceipt }),
      );
      const oldRetry = yield* post(
        "/receipt",
        yield* Schema.encodeEffect(Schema.toCodecJson(LandWorldReceipt))({ ...join, receipt }),
      );
      expect(oldRetry).toEqual(firstReceiptEvent);
      const afterRetry = yield* client.watchWorld({ world, chain, after: Option.none() }).pipe(
        Stream.take(1),
        Stream.runCollect,
      );
      const finalSnapshot = afterRetry[0];
      if (finalSnapshot?._tag !== "Snapshot") return yield* Effect.die("Expected snapshot after receipt retry");
      expect(finalSnapshot.snapshot.sequence).toBe(4);
      expect(finalSnapshot.snapshot.agents[0]?.receipt).toEqual(Option.some(newerReceipt));
      const postId = TradingPostId.make("floor_0_post_0");
      const moved = yield* post(
        "/move",
        yield* Schema.encodeEffect(Schema.toCodecJson(MoveInWorld))({
          ...join,
          location: AgentLocation.cases.AtPost.make({ postId }),
        }),
      );
      expect(moved._tag).toBe("AgentMoved");
      if (moved._tag !== "AgentMoved") return yield* Effect.die("Expected a movement event");
      // The world records the origin from its own journal, not from the publisher.
      expect(moved.from).toEqual(
        Option.some(AgentLocation.cases.AtDesk.make({ deskId: DeskId.make("floor_0_post_0_station_0_desk") })),
      );
      const movedFrames = yield* client.watchWorld({ world, chain, after: Option.some(4) }).pipe(
        Stream.take(2),
        Stream.runCollect,
        Effect.timeout("10 seconds"),
      );
      expect(movedFrames.map(frame => frame._tag === "Snapshot" ? frame.snapshot.sequence : frame.sequence)).toEqual([
        4,
        5,
      ]);
      const movement = movedFrames[1];
      if (movement?._tag !== "Delivery") return yield* Effect.die("Expected the movement delivery");
      expect(movement.delivery.event).toEqual(moved);
      const nowhere = yield* post(
        "/move",
        yield* Schema.encodeEffect(Schema.toCodecJson(MoveInWorld))({
          ...join,
          location: AgentLocation.cases.AtPost.make({ postId: TradingPostId.make("floor_0_post_9") }),
        }),
      ).pipe(Effect.result);
      expect(Result.isFailure(nowhere)).toBe(true);
      const future = yield* client.watchWorld({ world, chain, after: Option.some(6) }).pipe(
        Stream.runDrain,
        Effect.result,
      );
      expect(Result.isFailure(future)).toBe(true);
      if (Result.isFailure(future)) expect(future.failure._tag).toBe("WorldPublishError");
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
