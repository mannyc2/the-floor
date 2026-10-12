import { Agent } from "@yielded/agent";
import * as ThreadObject from "@yielded/agent-platform-alchemy-cloudflare/thread-object";
import { ThreadObjectIdentity } from "@yielded/agent-platform-cloudflare/cloudflare-host-bindings";
import { encodeReceipt, SubmitRequest } from "@yielded/agent-platform-cloudflare/cloudflare-thread-client-host";
import { ScriptedModel, ScriptedStreamTurn } from "@yielded/agent-testing/scripted-model";
import { digestDefinitions } from "@yielded/agent/digest";
import { DefinitionDigestInput, PersistedJson } from "@yielded/agent/records";
import { IdempotencyKey, Principal } from "@yielded/agent/submission-ledger";
import { ThreadRead, ThreadStore } from "@yielded/agent/thread-store";
import { makeCallback } from "alchemy/Callback";
import type { Providers } from "alchemy/Cloudflare";
import { Database, QueryDatabase, QueryDatabaseBinding } from "alchemy/Cloudflare/D1";
import { DurableObject } from "alchemy/Cloudflare/Workers/DurableObject";
import { DurableObjectState } from "alchemy/Cloudflare/Workers/DurableObjectState";
import { Request } from "alchemy/Cloudflare/Workers/Request";
import { SqlMigrations } from "alchemy/Cloudflare/Workers/SqlMigrations";
import { Worker } from "alchemy/Cloudflare/Workers/Worker";
import type { RuntimeContext } from "alchemy/RuntimeContext";
import { D1 } from "alchemy/SQL/D1";
import { Cause, Clock, DateTime, Effect, Exit, Layer, Schema, Stream } from "effect";
import { Model, Toolkit } from "effect/ai";
import { HttpServerResponse } from "effect/http";
import { StorageRun, StorageSnapshot } from "../contract.ts";

const planner = Agent.make("floor-local-agent", {
  input: Schema.Struct({ question: Schema.Literal("synthetic probe") }),
  output: Schema.Struct({ answer: Schema.Literal("synthetic-done-v1") }),
  instructions: "Return the fixed synthetic probe answer as JSON.",
  toolkit: Toolkit.empty,
  policy: { maxTurns: 1, maxToolCalls: 1, maxDuration: "20 seconds" },
});
const definitions = DefinitionDigestInput.make({
  agent: { id: planner.id, revision: 1 },
  model: { provider: "scripted", name: "floor-local-model-v1" },
  tools: [],
});
const model = Model.make(
  "scripted",
  "floor-local-model-v1",
  ScriptedModel.layer([{
    ...ScriptedStreamTurn.make({
      parts: [
        { type: "text-start", id: "answer" },
        { type: "text-delta", id: "answer", delta: "{\"answer\":\"synthetic-done-v1\"}" },
        { type: "text-end", id: "answer" },
        { type: "finish", reason: "stop", usage: { inputTokens: {}, outputTokens: {} } },
      ],
      termination: Schema.TaggedStruct("Complete", {}).make({}),
    }),
    onStreamStart: Effect.sleep("250 millis"),
  }]),
);
const handlers = {
  submitProbe: (key: string) =>
    Effect.gen(function*() {
      const { threadId } = yield* ThreadObjectIdentity;
      const hashes = yield* digestDefinitions(definitions);
      const receipt = yield* ThreadObject.submit(
        threadId,
        SubmitRequest.make({
          agentId: planner.id,
          principal: Principal.make("local-probe"),
          idempotencyKey: IdempotencyKey.make(key),
          definitions: hashes,
          inputPayload: PersistedJson.make({ question: "synthetic probe" }),
        }),
      );
      return yield* encodeReceipt(receipt);
    }),
  snapshot: () =>
    Effect.gen(function*() {
      const { threadId } = yield* ThreadObjectIdentity;
      const store = yield* ThreadStore;
      const records = yield* Stream.runCollect(store.read(ThreadRead.make({ threadId, limit: 100 })));
      return records.map(({ record, sequence }) => ({
        sequence,
        kind: record.payload._tag,
        createdAt: DateTime.toEpochMillis(record.createdAt),
        output: record.payload._tag === "RunCompleted" ? record.payload.output : { absent: true },
        settlement: record.payload._tag === "SubmissionSettled" ? record.payload.outcome : "none",
      }));
    }),
};
class Threads extends DurableObject<Threads, ThreadObject.Rpc<typeof handlers>>()("THREADS") {}
const ThreadsLive = Threads.make(ThreadObject.make(
  ThreadObject.layer([{ agent: planner, definitions, model }]),
  { namespaceBinding: "THREADS", deploymentId: "floor-local-agent-v1", producerPrefix: "local" },
  handlers,
));

const Status = Schema.Struct({ acceptedAt: Schema.Finite, completedAt: Schema.Finite });
interface CallbackRpc {
  enqueue: (threadName: string) => Effect.Effect<number, never, RuntimeContext>;
  snapshot: () => Effect.Effect<typeof Status.Type>;
}
class Callbacks extends DurableObject<Callbacks, CallbackRpc>()("CALLBACKS") {}
const CallbacksLive = Callbacks.make(Effect.map(Threads, (threads) =>
  Effect.gen(function*() {
    const state = yield* DurableObjectState;
    const complete = yield* makeCallback(
      "floor-local-agent",
      (payload: { readonly key: string; readonly threadName: string }) =>
        Effect.gen(function*() {
          yield* threads.getByName(payload.threadName).submitProbe(payload.key);
          const completedAt = yield* Clock.currentTimeMillis;
          state.raw.storage.sql.exec("UPDATE probe SET completed_at = ? WHERE id = 1", completedAt);
        }),
    );
    state.raw.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS probe (id INTEGER PRIMARY KEY, accepted_at INTEGER NOT NULL, completed_at INTEGER NOT NULL)",
    );
    return {
      enqueue: (threadName: string) =>
        state.storage.transaction(Effect.gen(function*() {
          const acceptedAt = yield* Clock.currentTimeMillis;
          state.raw.storage.sql.exec("INSERT OR REPLACE INTO probe VALUES (1, ?, 0)", acceptedAt);
          yield* complete.schedule("once", { after: "250 millis", payload: { key: "first", threadName } });
          return acceptedAt;
        })).pipe(Effect.orDie),
      snapshot: () =>
        Schema.decodeUnknownEffect(Status)(
          state.raw.storage.sql.exec(
            "SELECT accepted_at AS acceptedAt, completed_at AS completedAt FROM probe WHERE id = 1",
          ).one(),
        ).pipe(Effect.orDie),
    };
  })));

class RollbackProbe extends Schema.TaggedError<RollbackProbe>()("RollbackProbe", {}) {}
interface StorageRpc {
  exercise: () => Effect.Effect<typeof StorageRun.Type, never, RuntimeContext>;
  snapshot: () => Effect.Effect<typeof StorageSnapshot.Type>;
}
class Storage extends DurableObject<Storage, StorageRpc>()("STORAGE") {}
const StorageLive = Storage.make(Effect.map(
  SqlMigrations("./work-floor-replay/test/fixtures/migrations"),
  (migrations) =>
    Effect.gen(function*() {
      const state = yield* DurableObjectState;
      yield* migrations.apply().pipe(Effect.orDie);
      const snapshot = () =>
        Schema.decodeUnknownEffect(StorageSnapshot)({
          rows: state.raw.storage.sql.exec("SELECT id, version, value, marker FROM storage_probe ORDER BY id")
            .toArray(),
          migrations: state.raw.storage.sql.exec("SELECT name, hash FROM __alchemy_migrations ORDER BY id").toArray(),
        }).pipe(Effect.orDie);
      return {
        snapshot,
        exercise: () =>
          Effect.gen(function*() {
            state.raw.storage.sql.exec("INSERT INTO storage_probe (id, version, value) VALUES ('item', 0, 'before')");
            const beforeRollback = yield* snapshot();
            const rollback = yield* state.storage.transaction(Effect.gen(function*() {
              state.raw.storage.sql.exec("UPDATE storage_probe SET value = 'must-rollback' WHERE id = 'item'");
              return yield* new RollbackProbe({});
            })).pipe(Effect.exit);
            const afterRollback = yield* snapshot();
            const winners = yield* Effect.forEach(
              Array.from({ length: 16 }, (_, index) => index),
              (index) =>
                state.storage.transaction(Effect.sync(() =>
                  state.raw.storage.sql.exec(
                    "UPDATE storage_probe SET value = ?, version = version + 1 WHERE id = 'item' AND version = 0 RETURNING version",
                    `winner-${index}`,
                  ).toArray().length
                )).pipe(Effect.orDie),
              { concurrency: 16 },
            );
            // Reapplying captured files must preserve the data and exactly two history entries.
            yield* migrations.apply().pipe(Effect.provideService(DurableObjectState, state), Effect.orDie);
            return {
              rollbackFailed: Exit.isFailure(rollback),
              rollbackError: Exit.isFailure(rollback) ? Cause.pretty(rollback.cause) : "",
              beforeRollback,
              afterRollback,
              casAttempts: winners.length,
              casWinners: winners.reduce((total, count) => total + count, 0),
              final: yield* snapshot(),
            };
          }),
      };
    }),
));

const worker: Effect.Effect<Worker<{}>, never, Providers> = Effect.gen(function*() {
  const database = yield* Database("FloorStorage", { migrations: "./work-floor-replay/test/fixtures/migrations" });
  return yield* Worker(
    "FloorLocalAgent",
    {
      main: import.meta.url,
      compatibility: { date: "2026-08-18", flags: [] },
      dev: { host: "127.0.0.1", port: 19732 },
    },
    Effect.gen(function*() {
      const callbacks = yield* Callbacks;
      const threads = yield* Threads;
      const storage = yield* Storage;
      const sql = yield* D1(yield* QueryDatabase(database));
      const d1Snapshot = (id: string) =>
        Effect.gen(function*() {
          return yield* Schema.decodeUnknownEffect(StorageSnapshot)({
            rows: yield* sql`SELECT id, version, value, marker FROM storage_probe WHERE id = ${id}`,
            migrations: yield* sql`SELECT name, hash FROM __alchemy_migrations ORDER BY id`,
          });
        });
      return {
        fetch: Effect.gen(function*() {
          const request = yield* Request;
          const url = new URL(request.url);
          const pathname = url.pathname;
          if (!["/enqueue", "/snapshot", "/storage-run", "/storage-snapshot"].includes(pathname)) {
            return HttpServerResponse.text("ready");
          }
          const threadName = yield* Schema.decodeUnknownEffect(Schema.NonEmptyString)(url.searchParams.get("thread"));
          const owner = callbacks.getByName(threadName);
          if (pathname === "/storage-snapshot") {
            return HttpServerResponse.jsonUnsafe({
              durable: yield* storage.getByName(threadName).snapshot(),
              d1: yield* d1Snapshot(threadName),
            });
          }
          if (pathname === "/storage-run") {
            const durable = yield* storage.getByName(threadName).exercise();
            yield* sql`INSERT INTO storage_probe (id, version, value) VALUES (${threadName}, 0, 'before')`;
            const beforeRollback = yield* d1Snapshot(threadName);
            const rollback = yield* sql.batch([
              sql`UPDATE storage_probe SET value = 'must-rollback' WHERE id = ${threadName}`,
              sql`INSERT INTO storage_probe (id, version, value) VALUES (${threadName}, 0, 'duplicate')`,
            ]).pipe(Effect.exit);
            const afterRollback = yield* d1Snapshot(threadName);
            const winners = yield* Effect.forEach(
              Array.from({ length: 16 }, (_, index) => index),
              (index) =>
                sql`UPDATE storage_probe SET value = ${`winner-${index}`}, version = version + 1 WHERE id = ${threadName} AND version = 0 RETURNING version`,
              { concurrency: 16 },
            );
            return HttpServerResponse.jsonUnsafe({
              durable,
              d1: {
                rollbackFailed: Exit.isFailure(rollback),
                rollbackError: Exit.isFailure(rollback) ? Cause.pretty(rollback.cause) : "",
                beforeRollback,
                afterRollback,
                casAttempts: winners.length,
                casWinners: winners.reduce((total, rows) => total + rows.length, 0),
                final: yield* d1Snapshot(threadName),
              },
            });
          }
          if (pathname === "/enqueue") {
            return HttpServerResponse.jsonUnsafe({ acceptedAt: yield* owner.enqueue(threadName) });
          }
          if (pathname === "/snapshot") {
            return HttpServerResponse.jsonUnsafe({
              callback: yield* owner.snapshot(),
              records: yield* threads.getByName(threadName).snapshot(),
            });
          }
          return HttpServerResponse.text("ready");
        }).pipe(Effect.orDie),
      };
    }).pipe(
      // oxlint-disable-next-line effecttsgo/strict-effect-provide, effect/noInlineProvide -- This is the native Alchemy Worker application boundary.
      Effect.provide(Layer.mergeAll(Layer.provideMerge(CallbacksLive, ThreadsLive), StorageLive, QueryDatabaseBinding)),
    ),
  );
});

export default worker;
