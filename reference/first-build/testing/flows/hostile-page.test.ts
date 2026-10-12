import { assert, it } from "@effect/vitest";
import { Agent } from "@floor/contract";
import { Markets } from "@floor/markets";
import { Array, Effect, Option, Ref, Schema } from "effect";
import { ServerAgentRunner } from "../../packages/server/src/agent-runner";
import { FloorDatabase } from "../../packages/server/src/store";
import { hostileResearch, hostileResearcher } from "./_fixtures/hostile-research";
import { ResearchTrace } from "./_fixtures/recorded-research";

it.layer(hostileResearch)("hostile page", test => {
  test.effect("warns and preserves owner authority even when the model repeats a hostile page's proposal", () =>
    Effect.gen(function*() {
      const db = yield* FloorDatabase;
      const markets = yield* Markets;
      const runner = yield* ServerAgentRunner;
      const trace = yield* ResearchTrace;
      yield* db.owners.insert({
        id: hostileResearcher.owner,
        walletAddress: hostileResearcher.walletAddress,
        mode: "wallet",
      });
      yield* db.agents.insert(hostileResearcher);
      const snapshot = yield* markets.fetchSnapshot();
      const message = yield* runner.run(hostileResearcher, snapshot, Option.none());
      assert.include(message, "Research completed");
      assert.strictEqual((yield* Ref.get(trace.requests)).length, 2);
      assert.deepStrictEqual(yield* Ref.get(trace.readUrls), ["https://example.com/hostile-page"]);
      assert.isTrue(yield* Ref.get(trace.released));
      const agent = yield* Schema.decodeEffect(Agent)(yield* db.agents.findById(hostileResearcher.id));
      assert.strictEqual(agent.mandate, hostileResearcher.mandate);
      assert.deepStrictEqual(agent.policy, hostileResearcher.policy);
      const activity = yield* db.activity.findById(agent.id);
      assert.isTrue(activity.untrusted);
      assert.include(activity.message, "Untrusted instructions detected");
      assert.isTrue(Option.isNone(Option.fromNullishOr(activity.liveViewUrl)));
      const proposal = yield* Effect.fromOption(Array.head(yield* db.proposals.listByAgent(agent.id)));
      assert.strictEqual(proposal.owner, agent.owner);
      assert.strictEqual(proposal.agentId, agent.id);
      const receipt = (yield* db.receipts.findByProposal(proposal.id).pipe(Effect.flatMap(Effect.fromOption))).data;
      assert.strictEqual(receipt.status, "refused");
      assert.isTrue(receipt.checks.some(check => check.rule === "Allowed chain" && !check.passed));
      const notes = yield* db.notes.list();
      assert.isTrue(
        notes.some(note => note.status === "verified" && note.sources.every(source => source.kind === "chain")),
      );
      assert.isTrue(notes.some(note => note.claim.includes("hostile page") && note.status === "sourced"));
      assert.strictEqual((yield* db.receipts.list()).length, 1);
    }));
});
