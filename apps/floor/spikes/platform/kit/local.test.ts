import { localState, Stack } from "alchemy";
import { providers } from "alchemy/Cloudflare";
import * as Test from "alchemy/Test/Bun";
import { expect } from "bun:test";
import { Effect, FileSystem, Schema } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import worker from "./entry.ts";
const stack = Stack("floor-kit-probe", { providers: providers(), state: localState() }, worker);
const { test, deploy, destroy, beforeAll, afterAll } = Test.make({
  providers: providers(),
  dev: true,
  sidecar: false,
  stage: "floor-kit-local-001",
});
// oxlint-disable-next-line effect/noTestLifecycleHooks -- Alchemy Test.make owns deployment and destruction in this supported harness.
const deployed = beforeAll(deploy(stack));
// oxlint-disable-next-line effect/noTestLifecycleHooks -- Always destroy this local test-owned resource after the suite, including failures.
afterAll(destroy(stack));
const Counter = Schema.fromJsonString(Schema.Struct({ acceptedFixtureRequests: Schema.Finite }));
const ConstructionResult = Schema.Struct({
  byteLength: Schema.Finite,
  sha256: Schema.String,
  attachedSignatures: Schema.Finite,
});
const LaunchResult = Schema.fromJsonString(
  Schema.Struct({
    first: ConstructionResult,
    second: ConstructionResult,
    bunPresent: Schema.Boolean,
    processPresent: Schema.Boolean,
  }),
);
const EvmResult = Schema.fromJsonString(
  Schema.Struct({
    byteLength: Schema.Finite,
    sha256: Schema.String,
    repeatSha256: Schema.String,
    attachedSignatures: Schema.Finite,
    constructionTransportRequests: Schema.Finite,
    negativeControlRejected: Schema.Boolean,
  }),
);

test(
  "constructs both unsigned launches and validates math in local workerd",
  Effect.gen(function*() {
    const deployedWorker = yield* deployed;
    const url = yield* Schema.decodeUnknownEffect(Schema.NonEmptyString)(deployedWorker.url);
    const fs = yield* FileSystem.FileSystem;
    const client = yield* HttpClient.HttpClient;
    const before = yield* client.get(`${url}/rpc-count`).pipe(
      Effect.flatMap((counterResponse) => counterResponse.text),
      Effect.flatMap(Schema.decodeEffect(Counter)),
    );
    const response = yield* client.get(`${url}/launch`);
    const text = yield* response.text;
    yield* fs.writeFileString("result.json", text);
    const result = yield* Schema.decodeEffect(LaunchResult)(text);
    expect(response.status).toBe(200);
    expect(result.first.byteLength).toBe(1025);
    expect(result.first.sha256).toBe("e23d001d76f7e51eff63b09c1b59dc75c09a075cd87d32d74baca474bec30a59");
    expect(result.second.sha256).toBe(result.first.sha256);
    expect(result.first.attachedSignatures).toBe(0);
    expect(result.second.attachedSignatures).toBe(0);
    expect(result.bunPresent).toBe(false);
    const after = yield* client.get(`${url}/rpc-count`).pipe(
      Effect.flatMap((counterResponse) => counterResponse.text),
      Effect.flatMap(Schema.decodeEffect(Counter)),
    );
    expect(after.acceptedFixtureRequests - before.acceptedFixtureRequests).toBe(2);
    yield* fs.writeFileString(
      "rpc-counts.json",
      yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Struct({ before: Schema.Finite, after: Schema.Finite })))(
        { before: before.acceptedFixtureRequests, after: after.acceptedFixtureRequests },
      ),
    );
    const evm = yield* client.get(`${url}/evm`);
    const evmText = yield* evm.text;
    yield* fs.writeFileString("evm-result.json", evmText);
    const evmResult = yield* Schema.decodeEffect(EvmResult)(evmText);
    expect(evm.status).toBe(200);
    expect(evmResult.sha256).toBe("ffcc13ac755ebd8c0bc3d44ea58ab97022662d49f804cf76e4c1c8132aa9815c");
    expect(evmResult.repeatSha256).toBe(evmResult.sha256);
    expect(evmResult.byteLength).toBe(2020);
    expect(evmResult.attachedSignatures).toBe(0);
    expect(evmResult.constructionTransportRequests).toBe(0);
    expect(evmResult.negativeControlRejected).toBe(true);
    const crypto = yield* client.get(`${url}/crypto`);
    yield* fs.writeFileString("crypto-result.json", yield* crypto.text);
    expect(crypto.status).toBe(200);
    const math = yield* client.get(`${url}/math`);
    yield* fs.writeFileString("math-worker-result.json", yield* math.text);
    expect(math.status).toBe(200);
    const bad = yield* HttpClientRequest.post(`${url}/rpc`).pipe(
      HttpClientRequest.bodyJson({ method: "getBalance" }),
      Effect.flatMap(client.execute),
    );
    yield* fs.writeFileString("rpc-negative-status.txt", String(bad.status));
    expect(bad.status).toBe(500);
    // oxlint-disable-next-line effecttsgo/strict-effect-provide -- The test suite is the entry point for its HTTP client layer.
  }).pipe(Effect.provide(FetchHttpClient.layer)),
  { timeout: 120000 },
);
