import { WorldRpcs } from "@floor/api/world-rpc";
import { makeFloorWorker } from "@floor/app-floor/worker";
import { localState, Stack } from "alchemy";
import { providers } from "alchemy/Cloudflare";
import * as Test from "alchemy/Test/Bun";
import { expect } from "bun:test";
import { Config, Effect, FileSystem, Layer, Option, Redacted, Schema, Stream } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import { RpcClient, RpcSerialization } from "effect/rpc";
import { makePreviewSeedWorker, SeedResult } from "./_preview-seed";
import { agent, chain, join, receipt, world } from "./_world-fixture";

// The same composition alchemy.run.ts adds for pr-<n> stages, on local workerd.
const floor = makeFloorWorker({ devPort: 19734, name: "floor-preview-local" });
const stage = "floor-preview-local";
const seeded = Stack(
  "floor-preview-local",
  { providers: providers(), state: localState() },
  Effect.gen(function*() {
    const worker = yield* floor;
    const seed = yield* makePreviewSeedWorker({
      name: "floor-preview-local-seed",
      hostScript: "floor-preview-local",
      host: worker.workerName,
      devPort: 19735,
    });
    return { url: worker.url, seed: seed.url };
  }),
);
// Cleanup derives deletions from recorded state, not from the stack body. Destroying
// through a Floor-only definition shows the seed Worker cannot outlive its stage.
const floorOnly = Stack("floor-preview-local", { providers: providers(), state: localState() }, floor);
const { test, deploy, destroy, beforeAll, afterAll } = Test.make({
  providers: providers(),
  dev: true,
  sidecar: false,
  stage,
});
// oxlint-disable-next-line effect/noTestLifecycleHooks -- Alchemy's native harness owns both Workers across the seed and destroy checks.
const deployed = beforeAll(deploy(seeded));
// oxlint-disable-next-line effect/noTestLifecycleHooks -- A failed check still destroys whatever the stage recorded.
afterAll(destroy(floorOnly));

const Urls = Schema.Struct({ url: Schema.NonEmptyString, seed: Schema.NonEmptyString });

test(
  "a secret-gated preview seed writes the synthetic fixture into the Floor's own world stream",
  Effect.gen(function*() {
    const { url, seed } = yield* Schema.decodeUnknownEffect(Urls)(yield* deployed);
    const secret = yield* Config.Redacted("FLOOR_PREVIEW_SEED_SECRET");
    const http = yield* HttpClient.HttpClient;
    const status = (request: HttpClientRequest.HttpClientRequest) =>
      http.execute(request).pipe(Effect.map(response => response.status));
    expect(yield* status(HttpClientRequest.get(`${seed}/seed`))).toBe(404);
    expect(yield* status(HttpClientRequest.post(`${seed}/seed`))).toBe(401);
    expect(yield* status(HttpClientRequest.post(`${seed}/seed`).pipe(HttpClientRequest.bearerToken("wrong")))).toBe(
      401,
    );
    // The production Floor Worker serves no seed or publication route.
    expect(yield* status(HttpClientRequest.post(`${url}/api/seed`))).toBe(404);
    const post = HttpClientRequest.post(`${seed}/seed`).pipe(HttpClientRequest.bearerToken(Redacted.value(secret)));
    const first = yield* http.execute(post).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap(HttpClientResponse.schemaBodyJson(SeedResult)),
    );
    expect(first.host).toEqual(Option.some("floor-preview-local"));
    expect(first.joined._tag).toBe("AgentJoined");
    expect(first.landed._tag).toBe("ReceiptLanded");
    // A retried CI step must not add events or replace the receipt.
    const retry = yield* http.execute(post).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap(HttpClientResponse.schemaBodyJson(SeedResult)),
    );
    expect(retry).toEqual(first);
    const frames = yield* Effect.gen(function*() {
      const client = yield* RpcClient.make(WorldRpcs);
      return yield* client.watchWorld({ world, chain, after: Option.none() }).pipe(
        Stream.take(1),
        Stream.runCollect,
        Effect.timeout("10 seconds"),
      );
    }).pipe(
      Effect.scoped,
      Effect.provide(
        RpcClient.layerProtocolHttp({ url: `${url}/api/world` }).pipe(Layer.provide(RpcSerialization.layerNdjson)),
      ),
    );
    const snapshot = frames[0];
    if (snapshot?._tag !== "Snapshot") return yield* Effect.die("Expected the seeded snapshot");
    expect(snapshot.snapshot.sequence).toBe(2);
    expect(snapshot.snapshot.agents).toEqual([{ agent, state: Option.none(), receipt: Option.some(receipt) }]);
    expect(snapshot.snapshot.checkpoint).toEqual(Option.some(join.checkpoint));
    return void 0;
  }),
  { timeout: 120000 },
);

test(
  "destroying the stage removes the seed Worker with the Floor Worker",
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem;
    const directory = `.alchemy/state/floor-preview-local/${stage}`;
    const before = yield* fs.readDirectory(directory);
    expect(before.some(file => file.includes("FloorPreviewSeed"))).toBe(true);
    expect(before.some(file => file.includes("FloorWorker"))).toBe(true);
    yield* destroy(floorOnly);
    expect(yield* fs.exists(directory)).toBe(false);
  }),
  { timeout: 120000 },
);
