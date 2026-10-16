import { ScriptedModel, ScriptedStreamTurn } from "@yielded/agent-testing/scripted-model";
import type { Providers } from "alchemy/Cloudflare";
import { Database, QueryDatabase, QueryDatabaseBinding } from "alchemy/Cloudflare/D1";
import { DurableObject } from "alchemy/Cloudflare/Workers/DurableObject";
import { DurableObjectState } from "alchemy/Cloudflare/Workers/DurableObjectState";
import { Request } from "alchemy/Cloudflare/Workers/Request";
import { SqlMigrations } from "alchemy/Cloudflare/Workers/SqlMigrations";
import { Worker, type WorkerEnv } from "alchemy/Cloudflare/Workers/Worker";
import type { RuntimeContext } from "alchemy/RuntimeContext";
import { D1 } from "alchemy/SQL/D1";
import { Cause, Config, Effect, Exit, Layer, Option, Redacted, Schema } from "effect";
import { HttpServerResponse } from "effect/http";
import { AgentModel } from "../src/agents/models";
import { Agents, AgentSnapshot, makeAgentRuntime } from "../src/agents/runtime";

const StorageSnapshot = Schema.Struct({
  rows: Schema.Array(Schema.Struct({
    id: Schema.String,
    version: Schema.Natural,
    value: Schema.String,
    marker: Schema.String,
  })),
  migrations: Schema.Array(Schema.Struct({ name: Schema.String, hash: Schema.String })),
});
const StorageRun = Schema.Struct({
  rollbackFailed: Schema.Boolean,
  rollbackError: Schema.String,
  beforeRollback: StorageSnapshot,
  afterRollback: StorageSnapshot,
  casAttempts: Schema.Natural,
  casWinners: Schema.Natural,
  final: StorageSnapshot,
});
export const StorageReport = Schema.Struct({ durable: StorageRun, d1: StorageRun });
export const StorageRestart = Schema.Struct({ durable: StorageSnapshot, d1: StorageSnapshot });
// Snapshots hold Option and DateTime values, so the saved reports use their canonical JSON codecs.
export const AdmissionReport = Schema.fromJsonString(Schema.toCodecJson(Schema.Struct({
  ...AgentSnapshot.fields,
  quietStartedAt: Schema.Finite,
  observedAt: Schema.Finite,
  localUrl: Schema.String,
  threadName: Schema.String,
  storage: StorageReport,
})));
export const RestartReport = Schema.fromJsonString(Schema.toCodecJson(Schema.Struct({
  threadName: Schema.String,
  afterRestart: AgentSnapshot,
  afterDuplicate: AgentSnapshot,
  quietStartedAt: Schema.Finite,
  observedAt: Schema.Finite,
  storage: StorageRestart,
})));

const ScriptedAgent = Layer.succeed(
  AgentModel,
  AgentModel.of({
    provider: "scripted",
    name: "floor-local-model-v1",
    layer: ScriptedModel.layer([{
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
  }),
);

class RollbackProbe extends Schema.TaggedError<RollbackProbe>()("RollbackProbe", {}) {}
interface StorageRpc {
  exercise: () => Effect.Effect<typeof StorageRun.Type, never, RuntimeContext>;
  snapshot: () => Effect.Effect<typeof StorageSnapshot.Type>;
  reset: () => Effect.Effect<void>;
}
class Storage extends DurableObject<Storage, StorageRpc>()("STORAGE") {}
const StorageLive = Storage.make(Effect.map(
  SqlMigrations("./apps/floor/test/fixtures/migrations"),
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
        reset: () => Effect.sync(() => state.raw.abort("floor-hosted-storage-restart-probe")),
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

export const makeTestWorker = Effect.fn("makeTestWorker")(function*(
  options: { readonly env?: WorkerEnv } = {},
): Effect.fn.Return<Worker<{}>, never, Providers> {
  const database = yield* Database("FloorStorage", { migrations: "./apps/floor/test/fixtures/migrations" });
  return yield* Worker(
    "FloorLocalAgent",
    {
      main: import.meta.url,
      compatibility: { date: "2026-08-18", flags: [] },
      limits: { cpuMs: 10000 },
      env: options.env,
      dev: { host: "127.0.0.1", port: 19732 },
    },
    Effect.gen(function*() {
      const agents = yield* Agents;
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
          // Hosted probes carry a short-lived secret so discovery of their URL cannot exercise storage or alarms.
          const token = yield* Config.Redacted("FLOOR_PROBE_TOKEN").pipe(Config.option);
          if (Option.isSome(token) && request.headers.get("x-floor-probe-token") !== Redacted.value(token.value)) {
            return HttpServerResponse.empty({ status: 403 });
          }
          const url = new URL(request.url);
          const pathname = url.pathname;
          if (!["/enqueue", "/snapshot", "/storage-run", "/storage-snapshot", "/storage-reset"].includes(pathname)) {
            return HttpServerResponse.text("ready");
          }
          const threadName = yield* Schema.decodeUnknownEffect(Schema.NonEmptyString)(url.searchParams.get("thread"));

          if (pathname === "/storage-reset") {
            yield* storage.getByName(threadName).reset();
            return HttpServerResponse.empty({ status: 503 });
          }

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
            yield* agents.enqueue(threadName, "first", "synthetic probe");
            return HttpServerResponse.empty();
          }
          if (pathname === "/snapshot") {
            return yield* HttpServerResponse.schemaJson(AgentSnapshot)(yield* agents.snapshot(threadName, "first"));
          }
          return HttpServerResponse.text("ready");
        }).pipe(Effect.orDie),
      };
    }).pipe(Effect.provide(Layer.mergeAll(makeAgentRuntime(ScriptedAgent), StorageLive, QueryDatabaseBinding))),
  );
});

export default makeTestWorker();
