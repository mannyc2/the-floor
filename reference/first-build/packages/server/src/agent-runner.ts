import { Researchers, type ResearchRunResult } from "@floor/agents";
import { Agent, type FloorEvent } from "@floor/contract";
import type { MarketSnapshot } from "@floor/markets/schema";
import { AgentActivity, Owner, type ServiceStatus } from "@floor/surfaces";
import { Context, Crypto, DateTime, Effect, Fiber, FiberMap, Layer, Option, Redacted, Ref, Schema } from "effect";
import { type CheckedPosition, NotePositions, stampPosition } from "./note-positions";
import { Proposals } from "./proposals";
import { FloorDatabase } from "./store";

export class AgentRunError extends Schema.TaggedError<AgentRunError>()("AgentRunError", { message: Schema.String }) {}
interface Reservation {
  readonly amount: number;
  readonly day: string;
}
const briefVisibility = (notes: ResearchRunResult["notes"], visibility: Agent["visibility"]): Agent["visibility"] =>
  notes.length > 0 && notes.every(note => note.visibility === "public") ? visibility : "private";
const makeRunner = Effect.gen(function*() {
  const db = yield* FloorDatabase;
  const researchers = yield* Researchers;
  const proposalsService = yield* Proposals;
  const positions = yield* NotePositions;
  const crypto = yield* Crypto.Crypto;
  const active = yield* FiberMap.make<string, string, AgentRunError>();
  const findAgent = (id: string) =>
    db.agents.findById(id).pipe(
      Effect.flatMap(Schema.decodeEffect(Agent)),
      Effect.asSome,
      Effect.catchTag("NoSuchElementError", () => Effect.succeedNone),
    );
  const event = Effect.fn("AgentRunner.event")(
    function*(agent: Agent, blockNumber: number, type: string, payload: FloorEvent["payload"]) {
      return {
        id: yield* crypto.randomUUIDv4,
        type,
        blockNumber,
        createdAt: DateTime.formatIso(yield* DateTime.now),
        actor: agent.owner,
        entityId: agent.id,
        payload,
      } satisfies FloorEvent;
    },
  );
  const setActivity = Effect.fn("AgentRunner.activity")(
    function*(
      agentId: string,
      state: AgentActivity["state"],
      message: string,
      liveView: Option.Option<Redacted.Redacted>,
      untrusted: boolean,
    ) {
      const capturedAt = DateTime.formatIso(yield* DateTime.now);
      // This owner-only persistence boundary is the sole place where the provider's redacted viewing capability becomes transport text.
      yield* db.activity.upsert(
        AgentActivity.make({
          agentId,
          state,
          message,
          // oxlint-disable-next-line effect/noNullish -- Activity is a JSON DTO; no page URL has been observed at the session boundary.
          browserUrl: null,
          liveViewUrl: Option.getOrNull(Option.map(liveView, Redacted.value)),
          untrusted,
          updatedAt: capturedAt,
        }),
      );
    },
  );
  const commitResult = Effect.fn("AgentRunner.commitResult")(
    function*(
      agent: Agent,
      markets: MarketSnapshot,
      result: ResearchRunResult,
      start: FloorEvent,
      reservation: Option.Option<Reservation>,
      checkedPositions: ReadonlyMap<string, CheckedPosition>,
    ) {
      const current = yield* findAgent(agent.id);
      if (Option.isNone(current) || current.value.owner !== agent.owner) {
        return { message: "Agent removed before research completed. Results were discarded.", proposals: [] };
      }
      const latest = current.value;
      const events = yield* db.events.listByAgent(agent.id);
      const startIndex = events.findIndex(item => item.id === start.id);
      const paused = latest.paused
        || events.slice(startIndex + 1).some(item => item.type === "agent-paused");
      const changedPolicy = latest.policy.version !== agent.policy.version;
      const completed = result.status === "completed" && !paused;
      const notes = completed
        ? result.notes.map(note =>
          stampPosition(
            note,
            latest.visibility,
            changedPolicy || latest.walletAddress !== agent.walletAddress
              ? Option.some({
                status: "unavailable",
                reason: "The account binding changed while research was running.",
              })
              : Option.fromUndefinedOr(checkedPositions.get(note.marketId)),
          )
        )
        : [];
      const proposals = completed && !changedPolicy ? result.proposals : [];
      const spend = Option.match(reservation, {
        onNone: () => latest.budget.spentUsd,
        onSome: reserved =>
          latest.budget.day === reserved.day
            ? Math.max(0, latest.budget.spentUsd - reserved.amount + result.usage.chargedUsd)
            : latest.budget.spentUsd,
      });
      const state = proposals.length > 0 ? "deciding" : "asleep";
      yield* db.agents.update({ ...latest, state, budget: { ...latest.budget, spentUsd: spend } });
      yield* Effect.forEach(notes, note => db.notes.insert(note), { concurrency: 1, discard: true });
      if (completed) {
        yield* Effect.forEach(result.theses, thesis => db.theses.insert(thesis), { concurrency: 1, discard: true });
        if (Option.isSome(result.brief)) {
          yield* db.briefs.insert({
            ...result.brief.value,
            visibility: briefVisibility(notes, latest.visibility),
          });
        }
      }
      yield* Effect.forEach(proposals, proposal => db.proposals.insert(proposal), { concurrency: 1, discard: true });
      const message = paused
        ? "Agent paused. In-flight research and proposal drafts were discarded."
        : changedPolicy
        ? "Research saved. Proposal drafts were discarded because the confirmed policy changed."
        : result.message;
      yield* db.events.insert(
        yield* event(
          agent,
          markets.blockNumber,
          paused ? "agent-run-cancelled" : completed ? "agent-run-completed" : "agent-run-stopped",
          {
            runId: start.id,
            status: result.status,
            notes: notes.length,
            proposals: proposals.length,
            usage: result.usage,
            warnings: result.warnings,
          },
        ),
      );
      const activityMessage = result.warnings.length > 0 ? `${message} ${result.warnings.join(" ")}` : message;
      yield* setActivity(agent.id, state, activityMessage, Option.none(), result.warnings.length > 0);
      return { message, proposals };
    },
    db.sql.withTransaction,
  );
  const stop = Effect.fn("AgentRunner.stop")(function*(agent: Agent, markets: MarketSnapshot, start: FloorEvent) {
    const current = yield* findAgent(agent.id);
    if (Option.isNone(current) || current.value.owner !== agent.owner) return;
    yield* db.agents.update({ ...current.value, state: "asleep" });
    yield* db.events.insert(yield* event(agent, markets.blockNumber, "agent-run-stopped", { runId: start.id }));
    yield* setActivity(
      agent.id,
      "asleep",
      "Research stopped. Any uncertain provider spend remains reserved; inspect receipts for proposal outcomes.",
      Option.none(),
      false,
    );
  }, db.sql.withTransaction);
  const execute = Effect.fn("AgentRunner.execute")(
    function*(agent: Agent, markets: MarketSnapshot, message: Option.Option<string>) {
      const start = yield* event(agent, markets.blockNumber, "agent-run-started", {});
      const reservation = yield* Ref.make(Option.none<Reservation>());
      const begin = Effect.fn("AgentRunner.begin")(function*() {
        const current = yield* findAgent(agent.id);
        if (Option.isNone(current) || current.value.owner !== agent.owner) {
          return yield* new AgentRunError({ message: "Agent no longer belongs to this workspace." });
        }
        if (current.value.paused) {
          return yield* new AgentRunError({ message: "Resume the agent before running research." });
        }
        const starting = { ...current.value, state: "researching" as const };
        yield* db.agents.update(starting);
        yield* db.events.insert(start);
        yield* setActivity(
          agent.id,
          "researching",
          "Starting bounded research with canonical chain readings.",
          Option.none(),
          false,
        );
        return starting;
      }, db.sql.withTransaction);
      const currentAgent = yield* begin();
      const reserveBudget = Effect.fn("AgentRunner.reserveBudget")(function*(amount: number) {
        const current = yield* findAgent(agent.id);
        if (Option.isNone(current) || current.value.owner !== agent.owner || current.value.paused) {
          return Option.none<Reservation>();
        }
        const latest = current.value;
        const day = DateTime.formatIso(yield* DateTime.now).slice(0, 10);
        const spent = latest.budget.day === day ? latest.budget.spentUsd : 0;
        if (spent + amount > latest.budget.dailyUsd) return Option.none<Reservation>();
        yield* db.agents.update({ ...latest, budget: { ...latest.budget, day, spentUsd: spent + amount } });
        yield* db.events.insert(
          yield* event(agent, markets.blockNumber, "inference-budget-reserved", { usd: amount, day, runId: start.id }),
        );
        return Option.some({ amount, day });
      }, db.sql.withTransaction);
      const reserve = Effect.fn("AgentRunner.reserve")(function*(amount: number) {
        const accepted = yield* reserveBudget(amount);
        yield* Ref.set(reservation, accepted);
        return Option.isSome(accepted);
      }, Effect.uninterruptible);
      const onBrowser = Effect.fn("AgentRunner.onBrowser")(
        function*(session: Parameters<Parameters<typeof researchers.run>[0]["onBrowser"]>[0]) {
          const current = yield* findAgent(agent.id);
          if (Option.isNone(current) || (session.status === "running" && current.value.paused)) return;
          const text = session.status === "running"
            ? "Reading public pages. Page content is untrusted."
            : session.status === "closed"
            ? "Cloud browser session closed."
            : "Browser release unconfirmed; its provider timeout remains active.";
          yield* setActivity(
            agent.id,
            session.status === "running" ? "inspecting" : "researching",
            text,
            session.liveViewUrl,
            true,
          );
        },
        db.sql.withTransaction,
      );
      const researchAgent = Option.match(message, {
        onNone: () => currentAgent,
        onSome: request => ({
          ...currentAgent,
          mandate: `${currentAgent.mandate}\n\nOwner's current research request: ${request.slice(0, 12_000)}`,
        }),
      });
      const perform = Effect.fn("AgentRunner.perform")(function*() {
        const publicNotes = yield* db.notes.listPublic();
        const result = yield* researchers.run({
          agent: researchAgent,
          snapshot: markets,
          publicNotes,
          reserveBudget: reserve,
          onBrowser,
        });
        // Read holdings after inference, immediately before persistence. A historic market snapshot is never a current account balance.
        const researchedMarkets = new Set(result.notes.map(note => note.marketId));
        const checkedPositions = result.status === "completed"
          ? yield* positions.read(
            currentAgent,
            markets.markets.filter(market => researchedMarkets.has(market.id)).map(market => ({
              marketId: market.id,
              chainId: market.reading.provenance.chainId,
              tokenAddress: market.token.address,
            })),
          )
          : new Map<string, CheckedPosition>();
        const committed = yield* commitResult(
          currentAgent,
          markets,
          result,
          start,
          yield* Ref.get(reservation),
          checkedPositions,
        );
        if (committed.proposals.length > 0) {
          const owner = yield* db.owners.findById(currentAgent.owner).pipe(Effect.flatMap(Schema.decodeEffect(Owner)));
          // Research commits before the independent policy boundary reviews it; a pause or new policy is read afresh there.
          for (const proposal of committed.proposals) yield* proposalsService.submit(owner, proposal);
          yield* db.sql.withTransaction(Effect.gen(function*() {
            const latest = yield* findAgent(currentAgent.id);
            if (Option.isSome(latest)) yield* db.agents.update({ ...latest.value, state: "asleep" });
            yield* setActivity(
              currentAgent.id,
              "asleep",
              result.warnings.length > 0
                ? `${committed.message} ${result.warnings.join(" ")}`
                : committed.message,
              Option.none(),
              result.warnings.length > 0,
            );
          }));
        }
        return committed.message;
      });
      const work = perform().pipe(
        Effect.onError(() =>
          stop(agent, markets, start).pipe(
            Effect.catch(() => Effect.logError("Research cleanup could not be persisted.")),
          )
        ),
      );
      return yield* work;
    },
    Effect.mapError(() =>
      new AgentRunError({ message: "Research or proposal review stopped. Inspect durable receipts before retrying." })
    ),
  );
  const run = Effect.fn("AgentRunner.run")(
    function*(agent: Agent, markets: MarketSnapshot, message: Option.Option<string>) {
      if (!researchers.status.inference.configured) return researchers.status.inference.message;
      if (markets.markets.length === 0) return "Research needs a recorded or live chain reading first.";
      if (yield* FiberMap.has(active, agent.id)) return "This agent already has a research run in progress.";
      // Register ownership before provider work can publish activity, so an immediate pause always finds the fiber.
      const fiber = yield* FiberMap.run(active, agent.id, execute(agent, markets, message), {
        onlyIfMissing: true,
        startImmediately: false,
      });
      return yield* Fiber.join(fiber);
    },
  );
  const status: readonly ServiceStatus[] = [
    {
      name: "Agent inference",
      configured: researchers.status.inference.configured,
      detail: researchers.status.inference.message,
    },
    {
      name: "Research browser",
      configured: researchers.status.browser.configured,
      detail: researchers.status.browser.message,
    },
  ];
  return { run, pause: (id: string) => FiberMap.remove(active, id), status: Effect.succeed(status) };
});
/** @stability unstable */
export class ServerAgentRunner
  extends Context.Service<ServerAgentRunner, Effect.Success<typeof makeRunner>>()("floor/ServerAgentRunner")
{
  static readonly layer = Layer.effect(ServerAgentRunner, makeRunner);
}
