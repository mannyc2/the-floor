import { localState, Stack } from "alchemy";
import { providers } from "alchemy/Cloudflare";
import * as Test from "alchemy/Test/Bun";
import { expect } from "bun:test";
import { Clock, DateTime, Effect, FileSystem, Option, Path, Schema } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import { AgentSnapshot } from "../src/agents/runtime";
import { AdmissionReport, makeTestWorker, RestartReport, StorageRestart } from "./_worker";
const worker = makeTestWorker();

const stack = Stack("floor-local-agent", { providers: providers(), state: localState() }, worker);
const { test, deploy, destroy, beforeAll, afterAll } = Test.make({
  providers: providers(),
  dev: true,
  sidecar: false,
  stage: "floor-local-agent-001",
});
// oxlint-disable-next-line effect/noTestLifecycleHooks -- Alchemy's supported harness owns the local runtime across requests.
const deployed = beforeAll(deploy(stack));
// oxlint-disable-next-line effect/noTestLifecycleHooks -- Alchemy must remove its local resources before its shared runtime scope closes.
afterAll(destroy(stack));

test(
  "saved records survive a new Alchemy workerd process and duplicate admission",
  Effect.gen(function*() {
    const path = yield* Path.Path;
    const fs = yield* FileSystem.FileSystem;
    const savedPath = yield* path.fromFileUrl(
      new URL("../../../work/stage-0-checks/floor-admission-result.json", import.meta.url),
    );
    const saved = yield* fs.readFileString(savedPath).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(AdmissionReport)),
    );
    const output = yield* deployed;
    const url = yield* Effect.fromOption(Option.fromNullishOr(output.url));
    const client = yield* HttpClient.HttpClient;
    const read = Effect.fn("probe.readSnapshot")(() =>
      client.get(`${url}/snapshot?thread=${saved.threadName}`).pipe(
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.flatMap(HttpClientResponse.schemaBodyJson(AgentSnapshot)),
      )
    );
    const afterRestart = yield* read();
    expect(afterRestart.callback).toEqual(saved.callback);
    expect(afterRestart.records).toEqual(saved.records);
    const storage = yield* client.get(`${url}/storage-snapshot?thread=${saved.threadName}`).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap(HttpClientResponse.schemaBodyJson(StorageRestart)),
    );
    expect(storage.durable).toEqual(saved.storage.durable.final);
    expect(storage.d1).toEqual(saved.storage.d1.final);
    yield* client.get(`${url}/enqueue?thread=${saved.threadName}`).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
    );
    const quietStartedAt = yield* Clock.currentTimeMillis;
    // oxlint-disable-next-line effect/noFixedWaitInTests -- Duplicate delivery must settle during a measured interval without a polling request.
    yield* Effect.sleep("1500 millis");
    const observedAt = yield* Clock.currentTimeMillis;
    const afterDuplicate = yield* read();
    const completedAt = DateTime.toEpochMillis(yield* Effect.fromOption(afterDuplicate.callback.completedAt));
    expect(completedAt).toBeGreaterThan(quietStartedAt);
    expect(completedAt).toBeLessThan(observedAt);
    expect(afterDuplicate.records).toEqual(saved.records);
    const report = yield* Schema.encodeEffect(RestartReport)({
      threadName: saved.threadName,
      afterRestart,
      afterDuplicate,
      quietStartedAt,
      observedAt,
      storage,
    });
    const destination = yield* path.fromFileUrl(
      new URL("../../../work/stage-0-checks/floor-restart-result.json", import.meta.url),
    );
    yield* fs.writeFileString(destination, report);
    yield* Effect.log(report);
  }),
  { timeout: 120000 },
);
