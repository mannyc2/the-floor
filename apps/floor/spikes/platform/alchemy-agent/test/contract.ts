import { Schema } from "effect";

export const CallbackStatus = Schema.Struct({ acceptedAt: Schema.Finite, completedAt: Schema.Finite });
export const Record = Schema.Struct({
  sequence: Schema.Natural,
  kind: Schema.String,
  createdAt: Schema.Finite,
  settlement: Schema.String,
  output: Schema.Json,
});
export const Snapshot = Schema.Struct({ callback: CallbackStatus, records: Schema.Array(Record) });
export const StorageSnapshot = Schema.Struct({
  rows: Schema.Array(Schema.Struct({
    id: Schema.String,
    version: Schema.Natural,
    value: Schema.String,
    marker: Schema.String,
  })),
  migrations: Schema.Array(Schema.Struct({ name: Schema.String, hash: Schema.String })),
});
export const StorageRun = Schema.Struct({
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
export const AdmissionReport = Schema.Struct({
  ...Snapshot.fields,
  quietStartedAt: Schema.Finite,
  observedAt: Schema.Finite,
  localUrl: Schema.String,
  threadName: Schema.String,
  storage: StorageReport,
});
export const RestartReport = Schema.Struct({
  threadName: Schema.String,
  afterRestart: Snapshot,
  afterDuplicate: Snapshot,
  quietStartedAt: Schema.Finite,
  observedAt: Schema.Finite,
  storage: StorageRestart,
});
