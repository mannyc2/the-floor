import { BrowserCrypto } from "@effect/platform-browser";
import type { ThreadObjectRpc } from "@yielded/agent-platform-cloudflare/cloudflare-bindings";
import { CloudflareThreadClient } from "@yielded/agent-platform-cloudflare/cloudflare-thread-client";
import * as ThreadObject from "@yielded/agent-platform-cloudflare/thread-object";
import * as Agent from "@yielded/agent/agent";
import { compileBindingContracts } from "@yielded/agent/agent-registration";
import { ThreadId } from "@yielded/agent/identifiers";
import * as Output from "@yielded/agent/output";
import { IdempotencyKey, Principal, Receipt } from "@yielded/agent/receipt";
import { DefinitionDigestInput } from "@yielded/agent/records";
import { DateTime, Effect, Layer, Option, Schema, Stream } from "effect";
import { DurableObjectAlarm } from "effect-cf";
import { LanguageModel, Model, Toolkit } from "effect/ai";
import type { Response } from "effect/ai";
import { ProbeError } from "./errors";

const outputText = "synthetic-alarm-completion-v1";
const responseParts: ReadonlyArray<Response.StreamPartEncoded> = [
  { type: "text-start", id: "synthetic-text" },
  { type: "text-delta", id: "synthetic-text", delta: outputText },
  { type: "text-end", id: "synthetic-text" },
  { type: "finish", reason: "stop", usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } } },
];

// This model is a deterministic local fixture. The delay permits a separate
// restart experiment while an accepted attempt is running; it performs no inference.
const syntheticModel = Model.make(
  "synthetic-spike",
  "fixed-response-v1",
  Layer.effect(
    LanguageModel.LanguageModel,
    LanguageModel.make({
      generateText: () =>
        Effect.succeed([
          { type: "text", text: outputText },
          { type: "finish", reason: "stop", usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } } },
        ]),
      streamText: () => Stream.unwrap(Effect.sleep("1500 millis").pipe(Effect.as(Stream.fromIterable(responseParts)))),
    }),
  ),
);

const definition = Agent.make("floor-local-alarm-probe-v1", {
  input: Schema.Struct({ message: Schema.Literal("run synthetic alarm probe") }),
  output: Output.text(Schema.Literal(outputText)),
  instructions: "This is a local deterministic adapter fixture with no external provider.",
  toolkit: Toolkit.empty,
  policy: { maxTurns: 1, maxToolCalls: 1, maxDuration: "20 seconds", onExhaustion: "fail" },
});
const agent = Agent.withModel(definition, syntheticModel);
const definitions = DefinitionDigestInput.make({
  agent: { name: "floor-local-alarm-probe", version: 1 },
  model: { kind: "synthetic", response: outputText, delayMillis: 1500 },
  tools: [],
});

const application = ThreadObject.layer([{ agent, definitions }]).pipe(
  // Test-only: force the native alarm to drive accepted work, making the request-free interval observable.
  Layer.provideMerge(Layer.succeed(DurableObjectAlarm.ScheduleConfiguration, { dispatchAfterEvent: false })),
);
// Match Yielded’s global Worker types; mixing the module-scoped duplicate interfaces
// caused the native compiler to stall on their structural comparison.
interface NativeAgentInstance extends ThreadObjectRpc {
  alarm(alarmInfo?: AlarmInvocationInfo): Promise<void> | void;
}

// Expose only native RPC/lifecycle methods. The framework's effectContext helper
// carries internal runtime services that this Worker must not publish as its API.
const NativeAgentProbe: new(state: DurableObjectState, environment: Cloudflare.Env) => NativeAgentInstance =
  ThreadObject.make(application, {
    namespaceBinding: "AGENT",
    deploymentId: "local-platform-spike-v1",
    producerPrefix: "spike",
  });
type NativeState = ConstructorParameters<typeof NativeAgentProbe>[0];

const AlarmEvidence = Schema.Struct({
  invocations: Schema.Natural,
  startedAtMillis: Schema.Array(Schema.Finite),
  completedAtMillis: Schema.Array(Schema.Finite),
});

const readAlarms = Effect.fn("AgentProbe.readAlarms")(function*(state: NativeState) {
  const stored = yield* Effect.tryPromise({
    try: () => state.storage.get("spike:alarm-evidence"),
    catch: (cause) => new ProbeError({ operation: "AgentProbe.readAlarms", cause }),
  });
  return yield* Option.match(Option.fromNullishOr(stored), {
    onNone: () => Effect.succeed({ invocations: 0, startedAtMillis: [], completedAtMillis: [] }),
    onSome: (value) => Schema.decodeUnknownEffect(AlarmEvidence)(value),
  });
});

export class AgentProbe extends NativeAgentProbe {
  private readonly probeState: NativeState;

  constructor(...args: ConstructorParameters<typeof NativeAgentProbe>) {
    super(...args);
    this.probeState = args[0];
  }

  override alarm(...args: Parameters<InstanceType<typeof NativeAgentProbe>["alarm"]>): Promise<void> {
    const state = this.probeState;
    const dispatch = () => super.alarm(...args);
    return Effect.runPromise(Effect.gen(function*() {
      const previous = yield* readAlarms(state);
      const startedAtMillis = [...previous.startedAtMillis, DateTime.toEpochMillis(yield* DateTime.now)].slice(-16);
      yield* Effect.tryPromise({
        try: () =>
          state.storage.put("spike:alarm-evidence", {
            ...previous,
            invocations: previous.invocations + 1,
            startedAtMillis,
          }),
        catch: (cause) => new ProbeError({ operation: "AgentProbe.recordAlarmStart", cause }),
      });
      yield* Effect.tryPromise({
        // oxlint-disable-next-line effect/noNewPromise -- The native superclass alarm may return void or a Promise; preserve either completion contract.
        try: () => Promise.resolve(dispatch()),
        catch: (cause) => new ProbeError({ operation: "AgentProbe.nativeAlarm", cause }),
      });
      const completedAtMillis = [...previous.completedAtMillis, DateTime.toEpochMillis(yield* DateTime.now)].slice(-16);
      yield* Effect.tryPromise({
        try: () =>
          state.storage.put("spike:alarm-evidence", {
            invocations: previous.invocations + 1,
            startedAtMillis,
            completedAtMillis,
          }),
        catch: (cause) => new ProbeError({ operation: "AgentProbe.recordAlarmCompletion", cause }),
      });
    }));
  }

  probeSnapshot() {
    const state = this.probeState;
    return Effect.runPromise(Effect.gen(function*() {
      const alarms = yield* readAlarms(state);
      const nextAlarm = yield* Effect.tryPromise({
        try: () => state.storage.getAlarm(),
        catch: (cause) => new ProbeError({ operation: "AgentProbe.readAlarm", cause }),
      });
      return {
        ...alarms,
        observedAtMillis: DateTime.toEpochMillis(yield* DateTime.now),
        nativeAlarmPending: Option.isSome(Option.fromNullOr(nextAlarm)),
        model: "synthetic fixture; no inference provider",
        dispatchAfterEvent: false,
      };
    }));
  }
}

const clientLayer = (namespace: DurableObjectNamespace<ThreadObjectRpc>) =>
  Layer.merge(
    CloudflareThreadClient.layerFromBinding({ namespace }),
    BrowserCrypto.layer,
  );

const submit = Effect.fn("AgentProbe.submit")(function*(threadName: string, key: string) {
  const client = yield* CloudflareThreadClient;
  const threadId = yield* Schema.decodeEffect(ThreadId)(threadName);
  const principal = yield* Schema.decodeEffect(Principal)("local-spike");
  const idempotencyKey = yield* Schema.decodeEffect(IdempotencyKey)(key);
  const { digests } = yield* compileBindingContracts(definition, definitions);
  const receipt = yield* client.submit(agent, { message: "run synthetic alarm probe" }, {
    threadId,
    principal,
    idempotencyKey,
    definitions: digests,
  });
  return yield* Schema.encodeEffect(Receipt)(receipt);
});

export const submitAgentProbe = (
  namespace: DurableObjectNamespace<ThreadObjectRpc>,
  threadName: string,
  key: string,
) =>
  submit(threadName, key).pipe(
    Effect.mapError((cause) => new ProbeError({ operation: "AgentProbe.submit", cause })),
    // oxlint-disable-next-line effecttsgo/strict-effect-provide -- This standalone Worker probe entrypoint owns the client layer for one native request.
    Effect.provide(clientLayer(namespace)),
  );

const read = Effect.fn("AgentProbe.read")(function*(threadName: string) {
  const client = yield* CloudflareThreadClient;
  const threadId = yield* Schema.decodeEffect(ThreadId)(threadName);
  const records = yield* client.readAll(threadId);
  return records.map(({ sequence, record }) => ({
    sequence,
    recordId: record.recordId,
    createdAt: DateTime.formatIso(record.createdAt),
    kind: record.payload._tag,
    modelMessages: record.payload._tag === "ModelResponseRecorded"
      ? Option.some(record.payload.messages)
      : Option.none(),
    completionOutput: record.payload._tag === "RunCompleted" ? Option.some(record.payload.output) : Option.none(),
    settlementOutcome: record.payload._tag === "SubmissionSettled"
      ? Option.some(record.payload.outcome)
      : Option.none(),
  }));
});

export const readAgentProbe = (
  namespace: DurableObjectNamespace<ThreadObjectRpc>,
  threadName: string,
) =>
  read(threadName).pipe(
    Effect.mapError((cause) => new ProbeError({ operation: "AgentProbe.read", cause })),
    // oxlint-disable-next-line effecttsgo/strict-effect-provide -- This standalone Worker probe entrypoint owns the client layer for one native request.
    Effect.provide(clientLayer(namespace)),
  );
