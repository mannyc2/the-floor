import type { D1Database, DurableObjectStorage } from "@cloudflare/workers-types";
import { D1Client } from "@effect/sql-d1";
import { SqliteClient, SqliteMigrator } from "@effect/sql-sqlite-do";
import { Cause, Context, Effect, Exit, Layer, Option, Schema } from "effect";
import { SqlClient } from "effect/sql";
import { DeliberateRollback, ProbeAssertion, ProbeError } from "./errors";

const Rows = Schema.Array(Schema.Struct({ id: Schema.String, value: Schema.Int }));
const Counter = Schema.Tuple([Schema.Struct({ total: Schema.Int })]);

const migration = Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE probe_entries (id TEXT PRIMARY KEY, value INTEGER NOT NULL)`;
  yield* sql`INSERT INTO probe_entries (id, value) VALUES ('persisted', 7)`;
});

const journalLayer = (storage: DurableObjectStorage) =>
  SqliteMigrator.layer({
    loader: SqliteMigrator.fromRecord({ "0001_probe_entries": migration }),
  }).pipe(Layer.provideMerge(SqliteClient.layer({ storage })));

const readJournal = Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{ id: unknown; value: unknown }>`SELECT id, value FROM probe_entries ORDER BY id`;
  const migrations = yield* sql<{ total: unknown }>`SELECT COUNT(*) AS total FROM effect_sql_migrations`;
  return {
    rows: yield* Schema.decodeUnknownEffect(Rows)(rows),
    migrations: (yield* Schema.decodeUnknownEffect(Counter)(migrations))[0].total,
  };
});

const probeJournalRollback = Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient;
  const rollback = yield* sql.withTransaction(
    Effect.gen(function*() {
      yield* sql`INSERT INTO probe_entries (id, value) VALUES ('must-rollback', 99)`;
      return yield* new DeliberateRollback({ marker: "outer" });
    }),
  ).pipe(Effect.exit);
  const rows = yield* sql<
    { id: unknown; value: unknown }
  >`SELECT id, value FROM probe_entries WHERE id = 'must-rollback'`;
  const deliberateFailure = Exit.isFailure(rollback)
    ? Cause.findErrorOption(rollback.cause).pipe(
      Option.filter((error) => error._tag === "DeliberateRollback" && error.marker === "outer"),
    )
    : Option.none();
  if (Option.isNone(deliberateFailure) || rows.length !== 0) {
    return yield* new ProbeAssertion({ invariant: "A failed DO transaction does not persist its write" });
  }
  return { failureObserved: true, failureMarker: "outer", rolledBackRows: rows.length };
});

const probeNestedRollback = Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient;
  yield* sql.withTransaction(Effect.gen(function*() {
    yield* sql`INSERT OR REPLACE INTO probe_entries (id, value) VALUES ('parent', 11)`;
    yield* sql.withTransaction(Effect.gen(function*() {
      yield* sql`INSERT INTO probe_entries (id, value) VALUES ('child-must-rollback', 22)`;
      return yield* new DeliberateRollback({ marker: "child" });
    })).pipe(Effect.catchTag("DeliberateRollback", () => Effect.void));
  }));
  const rows = yield* sql<
    { id: unknown; value: unknown }
  >`SELECT id, value FROM probe_entries WHERE id IN ('parent', 'child-must-rollback') ORDER BY id`;
  const decoded = yield* Schema.decodeUnknownEffect(Rows)(rows);
  if (decoded.length !== 1 || decoded[0]?.id !== "parent" || decoded[0].value !== 11) {
    return yield* new ProbeAssertion({
      invariant: "A caught child failure rolls back the child but commits its parent",
    });
  }
  return { rows: decoded };
});

// Independent requests race this conditional update. Returning the SQL change
// count lets the driver prove exactly one reservation wins after restart.
const reserveJournal = Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient;
  return yield* sql.withTransaction(Effect.gen(function*() {
    yield* sql`UPDATE probe_entries SET value = value + 1 WHERE id = 'persisted' AND value = 7`;
    const result = yield* sql<{ total: unknown }>`SELECT changes() AS total`;
    return { changed: (yield* Schema.decodeUnknownEffect(Counter)(result))[0].total };
  }));
});

const initializeD1 = Effect.gen(function*() {
  const sql = yield* D1Client.D1Client;
  yield* sql`CREATE TABLE IF NOT EXISTS probe_history (id TEXT PRIMARY KEY, value INTEGER NOT NULL)`;
  yield* sql`INSERT OR IGNORE INTO probe_history (id, value) VALUES ('persisted', 13)`;
  return { initialized: true };
});

const readD1 = Effect.gen(function*() {
  const sql = yield* D1Client.D1Client;
  const rows = yield* sql<{ id: unknown; value: unknown }>`SELECT id, value FROM probe_history ORDER BY id`;
  return { rows: yield* Schema.decodeUnknownEffect(Rows)(rows) };
});

const probeD1Batch = Effect.gen(function*() {
  const sql = yield* D1Client.D1Client;
  const result = yield* sql.batch([
    sql`INSERT INTO probe_history (id, value) VALUES ('batch-must-rollback', 99)`,
    sql`INSERT INTO probe_history (id, value) VALUES ('persisted', 27)`,
  ]).pipe(Effect.exit);
  const rows = yield* sql<
    { id: unknown; value: unknown }
  >`SELECT id, value FROM probe_history WHERE id = 'batch-must-rollback'`;
  const batchError = Exit.isFailure(result) ? Cause.pretty(result.cause) : "none";
  if (!batchError.includes("UNIQUE constraint failed: probe_history.id") || rows.length !== 0) {
    return yield* new ProbeAssertion({ invariant: "A D1 batch uniqueness failure rolls back the entire batch" });
  }
  const unsupported = yield* sql.withTransaction(Effect.void).pipe(Effect.exit);
  return {
    batchFailureObserved: true,
    batchError,
    rolledBackRows: rows.length,
    interactiveTransactionSupported: Exit.isSuccess(unsupported),
    interactiveTransactionError: Exit.isFailure(unsupported) ? Cause.pretty(unsupported.cause) : "none",
  };
});

const migrateD1 = Effect.gen(function*() {
  const sql = yield* D1Client.D1Client;
  yield* sql`CREATE TABLE IF NOT EXISTS probe_history_versions (version INTEGER PRIMARY KEY)`;
  const versions = yield* sql<
    { total: unknown }
  >`SELECT COALESCE(MAX(version), 0) AS total FROM probe_history_versions`;
  const fromVersion = (yield* Schema.decodeUnknownEffect(Counter)(versions))[0].total;
  // D1 has atomic batches, not interactive transactions. This single-runner
  // migration demonstrates that primitive; it is not a production migration coordinator.
  if (fromVersion === 0) {
    yield* sql.batch([
      sql`CREATE TABLE IF NOT EXISTS probe_history (id TEXT PRIMARY KEY, value INTEGER NOT NULL)`,
      sql`INSERT OR IGNORE INTO probe_history (id, value) VALUES ('persisted', 13)`,
      sql`INSERT INTO probe_history_versions (version) VALUES (1)`,
    ]);
  }
  if (fromVersion < 2) {
    yield* sql.batch([
      sql`ALTER TABLE probe_history ADD COLUMN marker TEXT NOT NULL DEFAULT 'v2'`,
      sql`INSERT INTO probe_history_versions (version) VALUES (2)`,
    ]);
  }
  const rows = yield* sql<
    { id: unknown; value: unknown; marker: unknown }
  >`SELECT id, value, marker FROM probe_history ORDER BY id`;
  const decoded = yield* Schema.decodeUnknownEffect(
    Schema.Array(Schema.Struct({ id: Schema.String, value: Schema.Int, marker: Schema.String })),
  )(rows);
  if (decoded.length !== 1 || decoded[0]?.value !== 13 || decoded[0].marker !== "v2") {
    return yield* new ProbeAssertion({ invariant: "The D1 schema upgrade preserves its original row" });
  }
  return { fromVersion, toVersion: 2, repeatedWithoutChanges: fromVersion === 2, rows: decoded };
});

// Capture driver services inside these boundaries so no unstable SQL types
// become part of the Worker's application-facing service contract.
export class Journal extends Context.Service<Journal, {
  readonly read: Effect.Effect<Effect.Success<typeof readJournal>, ProbeError>;
  readonly rollback: Effect.Effect<Effect.Success<typeof probeJournalRollback>, ProbeError>;
  readonly nested: Effect.Effect<Effect.Success<typeof probeNestedRollback>, ProbeError>;
  readonly reserve: Effect.Effect<Effect.Success<typeof reserveJournal>, ProbeError>;
}>()("floor/spikes/Journal") {
  static readonly layer = (storage: DurableObjectStorage): Layer.Layer<Journal, ProbeError> =>
    Layer.effect(
      Journal,
      Effect.gen(function*() {
        const sql = yield* SqlClient.SqlClient;
        const bind = <A, E>(operation: string, effect: Effect.Effect<A, E, SqlClient.SqlClient>) =>
          effect.pipe(
            Effect.provideService(SqlClient.SqlClient, sql),
            Effect.mapError((cause) => new ProbeError({ operation, cause })),
          );
        return Journal.of({
          read: bind("journal.read", readJournal),
          rollback: bind("journal.rollback", probeJournalRollback),
          nested: bind("journal.nested", probeNestedRollback),
          reserve: bind("journal.reserve", reserveJournal),
        });
      }),
    ).pipe(
      Layer.provide(journalLayer(storage)),
      Layer.catch((cause) =>
        Layer.effect(Journal, Effect.fail(new ProbeError({ operation: "journal.initialize", cause })))
      ),
    );
}

export class History extends Context.Service<History, {
  readonly initialize: Effect.Effect<Effect.Success<typeof initializeD1>, ProbeError>;
  readonly read: Effect.Effect<Effect.Success<typeof readD1>, ProbeError>;
  readonly batch: Effect.Effect<Effect.Success<typeof probeD1Batch>, ProbeError>;
  readonly migrate: Effect.Effect<Effect.Success<typeof migrateD1>, ProbeError>;
}>()("floor/spikes/History") {
  static readonly layer = (db: D1Database): Layer.Layer<History, ProbeError> =>
    Layer.effect(
      History,
      Effect.gen(function*() {
        const sql = yield* D1Client.D1Client;
        const bind = <A, E>(operation: string, effect: Effect.Effect<A, E, D1Client.D1Client>) =>
          effect.pipe(
            Effect.provideService(D1Client.D1Client, sql),
            Effect.mapError((cause) => new ProbeError({ operation, cause })),
          );
        return History.of({
          initialize: bind("history.initialize", initializeD1),
          read: bind("history.read", readD1),
          batch: bind("history.batch", probeD1Batch),
          migrate: bind("history.migrate", migrateD1),
        });
      }),
    ).pipe(
      Layer.provide(D1Client.layer({ db })),
      Layer.catch((cause) =>
        Layer.effect(History, Effect.fail(new ProbeError({ operation: "history.initialize", cause })))
      ),
    );
}
