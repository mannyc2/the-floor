import { Agent } from "@yielded/agent";
import * as ThreadObject from "@yielded/agent-platform-alchemy-cloudflare/thread-object";
import { ThreadObjectIdentity } from "@yielded/agent-platform-cloudflare/cloudflare-host-bindings";
import { encodeReceipt, SubmitRequest } from "@yielded/agent-platform-cloudflare/cloudflare-thread-client-host";
import { digestDefinitions } from "@yielded/agent/digest";
import { DefinitionDigestInput, PersistedJson } from "@yielded/agent/records";
import { IdempotencyKey, Principal } from "@yielded/agent/submission-ledger";
import { ThreadRead, ThreadStore } from "@yielded/agent/thread-store";
import { makeCallback } from "alchemy/Callback";
import { DurableObject } from "alchemy/Cloudflare/Workers/DurableObject";
import { DurableObjectState } from "alchemy/Cloudflare/Workers/DurableObjectState";
import type { Worker } from "alchemy/Cloudflare/Workers/Worker";
import type { RuntimeContext } from "alchemy/RuntimeContext";
import { Clock, Context, DateTime, Effect, Layer, Schema, Stream } from "effect";
import { Model, Toolkit } from "effect/ai";
import { Decisions, type PredicateRequest } from "./decisions";
import { AgentModel } from "./models";

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
    return records.map(({ record, sequence }) => ({
      sequence,
      kind: record.payload._tag,
      createdAt: DateTime.toEpochMillis(record.createdAt),
      output: record.payload._tag === "RunCompleted" ? record.payload.output : { absent: true },
      settlement: record.payload._tag === "SubmissionSettled" ? record.payload.outcome : "none",
    }));
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

export const CallbackStatus = Schema.Struct({ acceptedAt: Schema.Finite, completedAt: Schema.Finite });
interface MailboxRpc {
  readonly enqueue: (key: string, threadName: string, question: string) => Effect.Effect<number, never, RuntimeContext>;
  readonly snapshot: (key: string) => Effect.Effect<typeof CallbackStatus.Type>;
}
class FloorMailboxes extends DurableObject<FloorMailboxes, MailboxRpc>()("FLOOR_MAILBOXES") {}
const MailboxesLive = FloorMailboxes.make(Effect.map(FloorThreads, (threads) =>
  Effect.gen(function*() {
    const state = yield* DurableObjectState;
    const complete = yield* makeCallback("floor-agent-admission", (payload: {
      readonly key: string;
      readonly threadName: string;
      readonly question: string;
    }) =>
      Effect.gen(function*() {
        yield* threads.getByName(payload.threadName).submitQuestion(payload.key, payload.question);
        const completedAt = yield* Clock.currentTimeMillis;
        state.raw.storage.sql.exec("UPDATE admissions SET completed_at = ? WHERE id = ?", completedAt, payload.key);
      }));
    state.raw.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS admissions (id TEXT PRIMARY KEY, accepted_at INTEGER NOT NULL, completed_at INTEGER NOT NULL)",
    );
    return {
      enqueue: (key: string, threadName: string, question: string) =>
        state.storage.transaction(Effect.gen(function*() {
          const acceptedAt = yield* Clock.currentTimeMillis;
          state.raw.storage.sql.exec(
            "INSERT INTO admissions VALUES (?, ?, 0) ON CONFLICT(id) DO UPDATE SET accepted_at = excluded.accepted_at, completed_at = 0",
            key,
            acceptedAt,
          );
          yield* complete.schedule(key, { after: "250 millis", payload: { key, threadName, question } });
          return acceptedAt;
        })).pipe(Effect.orDie),
      snapshot: (key: string) =>
        Schema.decodeUnknownEffect(CallbackStatus)(
          state.raw.storage.sql.exec(
            "SELECT accepted_at AS acceptedAt, completed_at AS completedAt FROM admissions WHERE id = ?",
            key,
          ).one(),
        ).pipe(Effect.orDie),
    };
  })));

export const AgentRecord = Schema.Struct({
  sequence: Schema.Natural,
  kind: Schema.String,
  createdAt: Schema.Finite,
  output: Schema.Json,
  settlement: Schema.String,
});
/** @effect-expect-leaking RuntimeContext The callback must schedule against the current native invocation. */
export class Agents extends Context.Service<Agents, {
  readonly enqueue: (thread: string, key: string, question: string) => Effect.Effect<number, never, RuntimeContext>;
  readonly snapshot: (thread: string, key: string) => Effect.Effect<
    {
      readonly callback: typeof CallbackStatus.Type;
      readonly records: ReadonlyArray<typeof AgentRecord.Type>;
    },
    never,
    RuntimeContext
  >;
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
          return {
            callback: yield* mailboxes.getByName(thread).snapshot(key),
            records: yield* threads.getByName(thread).snapshot(),
          };
        }, Effect.scoped),
      });
    }),
  ).pipe(Layer.provide(Layer.provideMerge(MailboxesLive, makeThreadsLayer(models))), Layer.orDie);

export const AgentRuntimeLive: Layer.Layer<Agents, never, Worker> = makeAgentRuntime(AgentModel.layer);
