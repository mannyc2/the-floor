import { AdmissionReport, Snapshot, StorageReport } from "@floor/app-floor/testing";
import { makeTestWorker } from "@floor/app-floor/testing";
import { localState, Stack } from "alchemy";
import { providers } from "alchemy/Cloudflare";
import * as Test from "alchemy/Test/Bun";
import { expect } from "bun:test";
import { Clock, Config, Effect, FileSystem, Option, Path, Schema } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
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
// oxlint-disable-next-line effect/noTestLifecycleHooks -- Retaining resource identity permits a separate-process restart; the harness still closes its runtime scope.
afterAll(Effect.gen(function*() {
  const retained = yield* Config.Boolean("FLOOR_RETAIN_LOCAL_STATE").pipe(Config.withDefault(false));
  if (!retained) yield* destroy(stack);
}));

test(
  "Alchemy callback admits a native Yielded agent and its alarm settles without polling",
  Effect.gen(function*() {
    const output = yield* deployed;
    const url = yield* Effect.fromOption(Option.fromNullishOr(output.url));
    const client = yield* HttpClient.HttpClient;
    const threadName = `native-${yield* Clock.currentTimeMillis}`;
    yield* client.get(`${url}/enqueue?thread=${threadName}`).pipe(Effect.flatMap(HttpClientResponse.filterStatusOk));
    const quietStartedAt = yield* Clock.currentTimeMillis;
    // oxlint-disable-next-line effect/noFixedWaitInTests -- This measured request-free interval is the behavior under test; polling would invalidate it.
    yield* Effect.sleep("3000 millis");
    const observedAt = yield* Clock.currentTimeMillis;
    const snapshot = yield* client.get(`${url}/snapshot?thread=${threadName}`).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap(HttpClientResponse.schemaBodyJson(Snapshot)),
    );
    expect(snapshot.callback.completedAt).toBeGreaterThan(quietStartedAt);
    expect(snapshot.callback.completedAt).toBeLessThan(observedAt);
    const settled = snapshot.records.find((record) => record.kind === "SubmissionSettled");
    expect(settled?.settlement).toBe("completed");
    expect(settled?.createdAt).toBeLessThan(observedAt);
    expect(settled?.createdAt).toBeGreaterThan(quietStartedAt);
    expect(snapshot.records.find((record) => record.kind === "RunCompleted")?.output).toEqual({
      answer: "synthetic-done-v1",
    });
    const storage = yield* client.get(`${url}/storage-run?thread=${threadName}`).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap(HttpClientResponse.schemaBodyJson(StorageReport)),
    );
    for (const result of [storage.durable, storage.d1]) {
      expect(result.rollbackFailed).toBe(true);
      expect(result.afterRollback).toEqual(result.beforeRollback);
      expect(result.casAttempts).toBe(16);
      expect(result.casWinners).toBe(1);
      expect(result.final.rows).toHaveLength(1);
      expect(result.final.rows[0]?.version).toBe(1);
      expect(result.final.rows[0]?.marker).toBe("migration-2");
      expect(result.final.migrations).toEqual(result.beforeRollback.migrations);
      expect(result.final.migrations).toHaveLength(2);
    }
    expect(storage.durable.rollbackError).toContain("RollbackProbe");
    expect(storage.d1.rollbackError).toContain("UNIQUE constraint failed");
    const report = yield* Schema.encodeEffect(Schema.fromJsonString(AdmissionReport))({
      ...snapshot,
      quietStartedAt,
      observedAt,
      localUrl: url,
      threadName,
      storage,
    });
    const path = yield* Path.Path;
    const destination = yield* path.fromFileUrl(
      new URL("../../../work/stage-0-checks/floor-admission-result.json", import.meta.url),
    );
    const fs = yield* FileSystem.FileSystem;
    yield* fs.writeFileString(destination, report);
    yield* Effect.log(report);
  }),
  { timeout: 120000 },
);
