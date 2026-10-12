import { BunServices } from "@effect/platform-bun";
import { expect, it } from "@effect/vitest";
import { Researchers, ResearchProviderError, type ResearchRunInput, type ResearchRunResult } from "@floor/agents";
import { Agent, defaultPolicy, Proposal, researchNote, undisclosedPosition } from "@floor/contract";
import { MarketRecording, type MarketSnapshot } from "@floor/markets/schema";
import {
  Array,
  Cause,
  Context,
  DateTime,
  Deferred,
  Effect,
  Exit,
  Fiber,
  FileSystem,
  Layer,
  Option,
  Redacted,
  Ref,
  Schema,
} from "effect";
import { ServerAgentRunner } from "../src/agent-runner";
import { databaseLayer } from "../src/sqlite-store";
import { FloorDatabase } from "../src/store";
import { unconfiguredProposals } from "../src/testing/proposals";

const agent = Agent.make({
  id: "runner-agent",
  owner: "runner-owner",
  name: "Reader",
  emblem: { shape: "circle", modifier: "dot" },
  walletAddress: "0x1111111111111111111111111111111111111111",
  mandate: "Read only.",
  policy: defaultPolicy,
  visibility: "public",
  publishMandate: false,
  state: "asleep",
  paused: false,
  budget: { dailyUsd: 10, spentUsd: 0, day: "1970-01-01" },
  districtId: "base-harbour",
  createdAt: "1970-01-01T00:00:00Z",
});
const scenario = Effect.fn("RunnerTest.scenario")(function*(mode: "complete" | "fail" | "wait") {
  return {
    mode,
    entered: yield* Deferred.make<void>(),
    release: yield* Deferred.make<void>(),
    finalized: yield* Ref.make(false),
  };
});
class Scenario
  extends Context.Service<Scenario, Ref.Ref<Effect.Success<ReturnType<typeof scenario>>>>()("test/RunnerScenario")
{}
class RecordedSnapshot extends Context.Service<RecordedSnapshot, MarketSnapshot>()("test/RunnerSnapshot") {}
const resultFor = (input: ResearchRunInput): ResearchRunResult => ({
  status: "completed",
  message: "Fixture research completed.",
  usage: { inputTokens: 10, outputTokens: 10, chargedUsd: 0.1, pricing: "estimated" },
  warnings: [],
  theses: [],
  brief: Option.none(),
  notes: [researchNote({
    id: "runner-note",
    agentId: agent.id,
    marketId: "fixture-market",
    claim: "Fixture interpretation.",
    sources: [],
    position: undisclosedPosition,
    status: "pending",
    visibility: "public",
    createdAt: "1970-01-01T00:00:00Z",
    blockNumber: input.snapshot.blockNumber,
    verification: "Test interpretation.",
  })],
  proposals: [Proposal.make({
    id: "runner-proposal",
    agentId: agent.id,
    owner: agent.owner,
    action: "trade",
    chainId: 84532,
    protocol: "fixture",
    contract: agent.walletAddress ?? "0x1111111111111111111111111111111111111111",
    method: "swap",
    recipient: agent.walletAddress ?? "0x1111111111111111111111111111111111111111",
    marketId: "fixture-market",
    amount: "1",
    symbol: "TEST",
    valueUsd: 1,
    slippageBps: 10,
    thesisId: "",
    sourceIds: [],
    createdAt: "1970-01-01T00:00:00Z",
  })],
});
const externalResearch = Layer.effectContext(Effect.gen(function*() {
  const control = yield* Ref.make(yield* scenario("complete"));
  const run = Effect.fn("RunnerTest.externalResearch")(function*<E, R>(input: ResearchRunInput<E, R>) {
    const current = yield* Ref.get(control);
    const reserved = yield* input.reserveBudget(0.5);
    if (!reserved) {
      return yield* new ResearchProviderError({ operation: "inference", message: "Fixture reservation was rejected." });
    }
    const provider = Effect.gen(function*() {
      yield* input.onBrowser({
        sessionId: "fixture-session",
        liveViewUrl: Option.some(Redacted.make("https://browser.fixture/private-view")),
        status: "running",
        capturedAt: DateTime.formatIso(yield* DateTime.now),
      });
      yield* Deferred.succeed(current.entered, void 0);
      if (current.mode === "fail") {
        return yield* new ResearchProviderError({
          operation: "inference",
          message: "Fixture provider failed after reservation.",
        });
      }
      if (current.mode === "wait") yield* Deferred.await(current.release);
      return resultFor({ ...input, reserveBudget: () => Effect.succeed(true), onBrowser: () => Effect.void });
    });
    return yield* provider.pipe(Effect.ensuring(Ref.set(current.finalized, true)));
  });
  const service = Researchers.of({
    run,
    status: {
      inference: { configured: true, provider: "Fixture", model: "fixture", message: "Fixture inference." },
      browser: { configured: true, provider: "Fixture", message: "Fixture browser." },
    },
  });
  return Context.make(Researchers, service).pipe(Context.add(Scenario, control));
}));
const fixture = Layer.effect(
  RecordedSnapshot,
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem;
    const recording = yield* Schema.decodeEffect(Schema.fromJsonString(MarketRecording))(
      yield* fs.readFileString("testing/recordings/base-day.json"),
    );
    return yield* Effect.fromOption(Array.last(recording.snapshots));
  }),
);
const runnerLayer = Layer.mergeAll(ServerAgentRunner.layer, fixture).pipe(
  Layer.provide(unconfiguredProposals),
  Layer.provideMerge(databaseLayer(":memory:")),
  Layer.provideMerge(externalResearch),
  Layer.provide(BunServices.layer),
);
const prepare = Effect.fn("RunnerTest.prepare")(function*(mode: "complete" | "fail" | "wait") {
  const db = yield* FloorDatabase;
  const control = yield* Scenario;
  yield* db.sql`DELETE FROM receipts`;
  yield* db.sql`DELETE FROM proposals`;
  yield* db.sql`DELETE FROM notes`;
  yield* db.sql`DELETE FROM events`;
  yield* db.sql`DELETE FROM activity`;
  yield* db.sql`DELETE FROM agents`;
  yield* db.sql`DELETE FROM owners`;
  yield* db.owners.insert({ id: agent.owner, walletAddress: agent.walletAddress, mode: "local" });
  yield* db.agents.insert(agent);
  const next = yield* scenario(mode);
  yield* Ref.set(control, next);
  return next;
});
const persistedAgent = Effect.gen(function*() {
  const db = yield* FloorDatabase;
  return yield* db.agents.findById(agent.id).pipe(Effect.flatMap(Schema.decodeEffect(Agent)));
});
it.layer(runnerLayer, { concurrent: false })("durable agent runner", test => {
  test.effect("commits the reservation before provider work and reconciles known usage", () =>
    Effect.gen(function*() {
      const current = yield* prepare("wait");
      const runner = yield* ServerAgentRunner;
      const snapshot = yield* RecordedSnapshot;
      const db = yield* FloorDatabase;
      const fiber = yield* runner.run(agent, snapshot, Option.none()).pipe(Effect.forkChild);
      yield* Effect.raceFirst(
        Deferred.await(current.entered),
        Fiber.join(fiber).pipe(
          Effect.flatMap(message => new ResearchProviderError({ operation: "inference", message })),
        ),
      );
      expect((yield* persistedAgent).budget.spentUsd).toBe(0.5);
      expect((yield* db.events.listByAgent(agent.id)).map(event => event.type)).toContain("inference-budget-reserved");
      yield* Deferred.succeed(current.release, void 0);
      expect(yield* Fiber.join(fiber)).toBe("Fixture research completed.");
      expect((yield* persistedAgent).budget.spentUsd).toBeCloseTo(0.1);
      expect((yield* persistedAgent).state).toBe("asleep");
      expect(yield* db.notes.list()).toHaveLength(1);
      expect((yield* db.proposals.findById("runner-proposal")).id).toBe("runner-proposal");
      expect(Option.isNone(Option.fromNullishOr((yield* db.activity.findById(agent.id)).liveViewUrl))).toBe(true);
    }));
  test.effect("retains uncertain spend and clears provider capabilities after failure", () =>
    Effect.gen(function*() {
      const current = yield* prepare("fail");
      const runner = yield* ServerAgentRunner;
      const db = yield* FloorDatabase;
      expect(Exit.isFailure(yield* Effect.exit(runner.run(agent, yield* RecordedSnapshot, Option.none())))).toBe(true);
      expect(yield* Ref.get(current.finalized)).toBe(true);
      expect((yield* persistedAgent).budget.spentUsd).toBe(0.5);
      expect((yield* persistedAgent).state).toBe("asleep");
      expect(yield* db.notes.list()).toHaveLength(0);
      expect(Option.isNone(Option.fromNullishOr((yield* db.activity.findById(agent.id)).liveViewUrl))).toBe(true);
    }));
  test.effect("pause waits for finalization and discards in-flight output", () =>
    Effect.gen(function*() {
      const current = yield* prepare("wait");
      const runner = yield* ServerAgentRunner;
      const db = yield* FloorDatabase;
      const fiber = yield* runner.run(agent, yield* RecordedSnapshot, Option.none()).pipe(Effect.forkChild);
      yield* Effect.raceFirst(
        Deferred.await(current.entered),
        Fiber.join(fiber).pipe(
          Effect.flatMap(message => new ResearchProviderError({ operation: "inference", message })),
        ),
      );
      expect((yield* db.activity.findById(agent.id)).liveViewUrl).toBe("https://browser.fixture/private-view");
      yield* runner.pause(agent.id);
      const exit = yield* Fiber.await(fiber);
      expect(Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)).toBe(true);
      expect(yield* Ref.get(current.finalized)).toBe(true);
      expect((yield* persistedAgent).budget.spentUsd).toBe(0.5);
      expect((yield* persistedAgent).state).toBe("asleep");
      expect(yield* db.notes.list()).toHaveLength(0);
      expect(Option.isNone(Option.fromNullishOr((yield* db.activity.findById(agent.id)).liveViewUrl))).toBe(true);
    }));
  test.effect("rejects stale proposals after a policy change while retaining research", () =>
    Effect.gen(function*() {
      const current = yield* prepare("wait");
      const runner = yield* ServerAgentRunner;
      const db = yield* FloorDatabase;
      const fiber = yield* runner.run(agent, yield* RecordedSnapshot, Option.none()).pipe(Effect.forkChild);
      yield* Effect.raceFirst(
        Deferred.await(current.entered),
        Fiber.join(fiber).pipe(
          Effect.flatMap(message => new ResearchProviderError({ operation: "inference", message })),
        ),
      );
      const latest = yield* persistedAgent;
      yield* db.agents.update({ ...latest, policy: { ...latest.policy, version: latest.policy.version + 1 } });
      yield* Deferred.succeed(current.release, void 0);
      expect(yield* Fiber.join(fiber)).toContain("policy changed");
      expect(yield* db.notes.list()).toHaveLength(1);
      expect(yield* db.sql`SELECT id FROM proposals`).toHaveLength(0);
    }));
  test.effect("discards a completed result when pause was durably committed first", () =>
    Effect.gen(function*() {
      const current = yield* prepare("wait");
      const runner = yield* ServerAgentRunner;
      const db = yield* FloorDatabase;
      const fiber = yield* runner.run(agent, yield* RecordedSnapshot, Option.none()).pipe(Effect.forkChild);
      yield* Effect.raceFirst(
        Deferred.await(current.entered),
        Fiber.join(fiber).pipe(
          Effect.flatMap(message => new ResearchProviderError({ operation: "inference", message })),
        ),
      );
      yield* db.agents.update({ ...yield* persistedAgent, state: "asleep", paused: true });
      yield* Deferred.succeed(current.release, void 0);
      expect(yield* Fiber.join(fiber)).toContain("discarded");
      expect(yield* db.notes.list()).toHaveLength(0);
      expect(yield* db.sql`SELECT id FROM proposals`).toHaveLength(0);
    }));
});
