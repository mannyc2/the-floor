import { SqliteClient } from "@effect/sql-sqlite-do";
import { Agent } from "@yielded/agent";
import * as ThreadObject from "@yielded/agent-platform-alchemy-cloudflare/thread-object";
import { ThreadObjectIdentity } from "@yielded/agent-platform-cloudflare/cloudflare-host-bindings";
import { encodeReceipt, SubmitRequest } from "@yielded/agent-platform-cloudflare/cloudflare-thread-client-host";
import { digestDefinitions } from "@yielded/agent/digest";
import {
  CanonicalRecordPayload,
  DefinitionDigestInput,
  PersistedJson,
  SettlementOutcome,
} from "@yielded/agent/records";
import { IdempotencyKey, Principal } from "@yielded/agent/submission-ledger";
import { ThreadRead, ThreadStore } from "@yielded/agent/thread-store";
import { makeCallback } from "alchemy/Callback";
import { DurableObject } from "alchemy/Cloudflare/Workers/DurableObject";
import { DurableObjectState } from "alchemy/Cloudflare/Workers/DurableObjectState";
import { SqlMigrations } from "alchemy/Cloudflare/Workers/SqlMigrations";
import type { Worker } from "alchemy/Cloudflare/Workers/Worker";
import type { RuntimeContext } from "alchemy/RuntimeContext";
import { Clock, Context, Effect, Layer, Option, Schema, Stream } from "effect";
import { Model, Toolkit } from "effect/ai";
import { SqlSchema } from "effect/sql";
import { Decisions, type PredicateRequest } from "./decisions";
import { AgentModel } from "./models";

export class AgentStorageError extends Schema.TaggedError<AgentStorageError>()("AgentStorageError", {
  operation: Schema.Literals(["admit", "read"]),
  cause: Schema.Defect(),
}) {}

const CallbackStatus = Schema.Struct({
  acceptedAt: Schema.DateTimeUtcFromMillis,
  completedAt: Schema.OptionFromNullOr(Schema.DateTimeUtcFromMillis),
});
const AgentRecords = Schema.Array(Schema.Struct({
  sequence: Schema.Natural,
  // Follows Yielded's installed payload union; toTaggedUnion annotates its input in place, so it gets a copy.
  kind: Schema.Literals(Schema.Union(CanonicalRecordPayload.members).pipe(Schema.toTaggedUnion("_tag")).discriminants),
  createdAt: Schema.DateTimeUtc,
  output: Schema.Option(Schema.Json),
  settlement: Schema.Option(SettlementOutcome),
}));
export const AgentSnapshot = Schema.Struct({ callback: CallbackStatus, records: AgentRecords });
// Durable Object RPC does not carry Option or DateTime prototypes, so those values cross it as canonical JSON.
const CallbackJson = Schema.toCodecJson(CallbackStatus);
const RecordsJson = Schema.toCodecJson(AgentRecords);
const SnapshotJson = Schema.toCodecJson(AgentSnapshot);

const agent = Agent.make("floor-agent", {
  input: Schema.Struct({ question: Schema.NonEmptyString }),
  output: Schema.Struct({ answer: Schema.NonEmptyString }),
  instructions:
    "Answer the supplied question from the evidence in the conversation. Return a JSON object with an answer. Do not claim actions were executed.",
  toolkit: Toolkit.empty,
  policy: { maxTurns: 1, maxToolCalls: 1, maxDuration: "20 seconds" },
});
const definitions = (provider: string, name: string) =>
  DefinitionDigestInput.make({
    agent: { id: agent.id, revision: 1 },
    model: { provider, name },
    tools: [],
  });
const handlers = {
  evaluatePredicates: Effect.fn("FloorThreads.evaluatePredicates")(function*(request: PredicateRequest) {
    return yield* (yield* Decisions).evaluate(request);
  }),
  submitQuestion: Effect.fn("FloorThreads.submitQuestion")(function*(key: string, question: string) {
    const { threadId } = yield* ThreadObjectIdentity;
    const model = yield* AgentModel;
    const input = yield* Schema.decodeEffect(agent.input)({ question });
    const hashes = yield* digestDefinitions(definitions(model.provider, model.name));
    return yield* ThreadObject.submit(
      threadId,
      SubmitRequest.make({
        agentId: agent.id,
        principal: Principal.make("floor-internal"),
        idempotencyKey: IdempotencyKey.make(key),
        definitions: hashes,
        inputPayload: PersistedJson.make(input),
      }),
    ).pipe(Effect.flatMap(encodeReceipt));
  }),
  snapshot: Effect.fn("FloorThreads.snapshot")(function*() {
    const { threadId } = yield* ThreadObjectIdentity;
    const store = yield* ThreadStore;
    const records = yield* Stream.runCollect(store.read(ThreadRead.make({ threadId, limit: 100 })));
    return yield* Schema.encodeEffect(RecordsJson)(records.map(({ record, sequence }) => ({
      sequence,
      kind: record.payload._tag,
      createdAt: record.createdAt,
      output: record.payload._tag === "RunCompleted" ? Option.some(record.payload.output) : Option.none(),
      settlement: record.payload._tag === "SubmissionSettled" ? Option.some(record.payload.outcome) : Option.none(),
    })));
  }),
};

class FloorThreads extends DurableObject<FloorThreads, ThreadObject.Rpc<typeof handlers>>()("FLOOR_THREADS") {}

const makeThreadsLayer = <E>(models: Layer.Layer<AgentModel, E>) =>
  FloorThreads.make(ThreadObject.make(
    Layer.unwrap(Effect.gen(function*() {
      const configured = yield* AgentModel;
      return ThreadObject.layer([{
        agent,
        definitions: definitions(configured.provider, configured.name),
        model: Model.make(configured.provider, configured.name, configured.layer),
      }]);
    })).pipe(Layer.provideMerge(Layer.merge(models, Decisions.layer))),
    { namespaceBinding: "FLOOR_THREADS", deploymentId: "floor-agent-v1", producerPrefix: "floor" },
    handlers,
  ));

interface MailboxRpc {
  readonly enqueue: (
    key: string,
    threadName: string,
    question: string,
  ) => Effect.Effect<void, AgentStorageError, RuntimeContext>;
  readonly snapshot: (key: string) => Effect.Effect<Schema.Json, AgentStorageError>;
}
class FloorMailboxes
  extends DurableObject<FloorMailboxes, MailboxRpc>()("FLOOR_MAILBOXES", { errors: [AgentStorageError] })
{}
const MailboxesLive = FloorMailboxes.make(Effect.map(
  // The directory is read from where Alchemy runs, the repository root, and embedded in the Worker bundle.
  Effect.all({ threads: FloorThreads, migrations: SqlMigrations("./apps/floor/src/agents/_migrations") }),
  ({ threads, migrations }) =>
    Effect.gen(function*() {
      const state = yield* DurableObjectState;
      yield* migrations.apply().pipe(Effect.orDie);
      // Queries only: Alchemy's storage transaction is the one boundary that commits an admission with its callback.
      const sql = Context.get(
        yield* Layer.build(SqliteClient.layer({ db: state.raw.storage.sql })),
        SqliteClient.SqliteClient,
      );
      const complete = yield* makeCallback("floor-agent-admission", (payload: {
        readonly key: string;
        readonly threadName: string;
        readonly question: string;
      }) =>
        Effect.gen(function*() {
          yield* threads.getByName(payload.threadName).submitQuestion(payload.key, payload.question);
          const completedAt = yield* Clock.currentTimeMillis;
          yield* sql`UPDATE admissions SET completed_at = ${completedAt} WHERE id = ${payload.key}`;
        }));
      const findAdmission = SqlSchema.findOne({
        Request: Schema.String,
        Result: CallbackStatus,
        execute: (key) =>
          sql`SELECT accepted_at AS acceptedAt, completed_at AS completedAt FROM admissions WHERE id = ${key}`,
      });
      return {
        enqueue: (key: string, threadName: string, question: string) =>
          state.storage.transaction(Effect.gen(function*() {
            const acceptedAt = yield* Clock.currentTimeMillis;
            yield* sql`INSERT INTO admissions (id, accepted_at) VALUES (${key}, ${acceptedAt})
              ON CONFLICT(id) DO UPDATE SET accepted_at = excluded.accepted_at, completed_at = NULL`;
            yield* complete.schedule(key, { after: "250 millis", payload: { key, threadName, question } });
          })).pipe(Effect.mapError((cause) => new AgentStorageError({ operation: "admit", cause }))),
        snapshot: (key: string) =>
          findAdmission(key).pipe(
            Effect.flatMap(Schema.encodeEffect(CallbackJson)),
            Effect.mapError((cause) => new AgentStorageError({ operation: "read", cause })),
          ),
      };
    }),
));

/** @effect-expect-leaking RuntimeContext The callback must schedule against the current native invocation. */
export class Agents extends Context.Service<Agents, {
  readonly enqueue: (
    thread: string,
    key: string,
    question: string,
  ) => Effect.Effect<void, AgentStorageError, RuntimeContext>;
  readonly snapshot: (
    thread: string,
    key: string,
  ) => Effect.Effect<typeof AgentSnapshot.Type, AgentStorageError, RuntimeContext>;
}>()("@floor/app-floor/agents/Agents") {}

export const makeAgentRuntime = <E>(models: Layer.Layer<AgentModel, E>): Layer.Layer<Agents, never, Worker> =>
  Layer.effect(
    Agents,
    Effect.gen(function*() {
      const mailboxes = yield* FloorMailboxes;
      const threads = yield* FloorThreads;
      return Agents.of({
        enqueue: (thread, key, question) => mailboxes.getByName(thread).enqueue(key, thread, question),
        snapshot: Effect.fn("Agents.snapshot")(function*(thread, key) {
          const callback = yield* mailboxes.getByName(thread).snapshot(key);
          const records = yield* threads.getByName(thread).snapshot();
          return yield* Schema.decodeEffect(SnapshotJson)({ callback, records }).pipe(
            Effect.mapError((cause) => new AgentStorageError({ operation: "read", cause })),
          );
        }, Effect.scoped),
      });
    }),
  ).pipe(Layer.provide(Layer.provideMerge(MailboxesLive, makeThreadsLayer(models))));

export const AgentRuntimeLive: Layer.Layer<Agents, never, Worker> = makeAgentRuntime(AgentModel.layer);
