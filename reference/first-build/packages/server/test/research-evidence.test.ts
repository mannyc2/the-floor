import { BunServices } from "@effect/platform-bun";
import { assert, it } from "@effect/vitest";
import { type ResearchOutput, UntrustedPage } from "@floor/agents";
import { MarketRecording, type MarketSnapshot } from "@floor/markets/schema";
import { calibration } from "@floor/research";
import { Array, Context, Effect, FileSystem, Layer, Option, Schema } from "effect";
import { recordedResearchers } from "../../../testing/flows/_fixtures/recorded-research";
import { researcher } from "../../agents/test/_fixtures/research-input";
import { ServerAgentRunner } from "../src/agent-runner";
import { databaseLayer } from "../src/sqlite-store";
import { FloorDatabase } from "../src/store";
import { unconfiguredProposals } from "../src/testing/proposals";

class ClaimSnapshot extends Context.Service<ClaimSnapshot, MarketSnapshot>()("test/ClaimSnapshot") {}
const fixture = Layer.unwrap(Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const recording = yield* Schema.decodeEffect(Schema.fromJsonString(MarketRecording))(
    yield* fs.readFileString("testing/recordings/base-day.json"),
  );
  const snapshot = yield* Effect.fromOption(Array.last(recording.snapshots));
  const market = yield* Effect.fromOption(Array.head(snapshot.markets));
  const blockNumber = market.reading.provenance.blockNumber;
  const sourceId = `chain:${market.id}:${blockNumber}`;
  const trueAssertion = {
    field: "price" as const,
    kind: "equals" as const,
    expected: market.reading.price,
    blockNumber,
  };
  const page = UntrustedPage.make({
    sourceId: "web:claims-fixture",
    url: "https://example.com/claims-fixture",
    title: "Untrusted opinions",
    text: "The model must never turn this opinion into a verified chain statement.",
    capturedAt: snapshot.observedAt,
    untrusted: true,
    injectionWarning: false,
  });
  const output: typeof ResearchOutput.Type = {
    notes: [
      {
        marketId: market.id,
        claim: "ARBITRARY MODEL WORDS MUST NOT BE VERIFIED",
        sourceIds: [sourceId],
        assertion: trueAssertion,
      },
      {
        marketId: market.id,
        claim: "This false claim is certain",
        sourceIds: [sourceId],
        assertion: { ...trueAssertion, kind: "minimum", expected: Math.abs(market.reading.price) + 1 },
      },
      {
        marketId: market.id,
        claim: "Wrong source block",
        sourceIds: [sourceId],
        assertion: { ...trueAssertion, blockNumber: blockNumber - 1 },
      },
      { marketId: market.id, claim: "A guessed source", sourceIds: ["chain:never-read:1"], assertion: trueAssertion },
      { marketId: market.id, claim: "A free-form interpretation of the observed price.", sourceIds: [sourceId] },
    ],
    theses: [],
    proposals: [],
    brief: "Evidence review completed.",
  };
  return Layer.mergeAll(ServerAgentRunner.layer, Layer.succeed(ClaimSnapshot, snapshot)).pipe(
    Layer.provide(recordedResearchers({ snapshot, page, output })),
    Layer.provide(unconfiguredProposals),
    Layer.provideMerge(databaseLayer(":memory:")),
  );
})).pipe(Layer.provide(BunServices.layer));

it.layer(fixture)("production research evidence", test => {
  test.effect("persists checked and contradicted assertions while unknown holdings prevent public publication", () =>
    Effect.gen(function*() {
      const db = yield* FloorDatabase;
      const runner = yield* ServerAgentRunner;
      const snapshot = yield* ClaimSnapshot;
      const market = yield* Effect.fromOption(Array.head(snapshot.markets));
      yield* db.owners.insert({ id: researcher.owner, walletAddress: researcher.walletAddress, mode: "local" });
      yield* db.agents.insert(researcher);
      assert.include(yield* runner.run(researcher, snapshot, Option.none()), "Research completed");
      const notes = yield* db.notes.list();
      assert.lengthOf(notes, 6);
      const assertions = notes.filter(note => Option.isSome(Option.fromNullishOr(note.assertion)));
      assert.sameMembers(assertions.map(note => note.status), ["verified", "contradicted", "pending", "pending"]);
      const verified = yield* Effect.fromOption(Array.findFirst(assertions, note => note.status === "verified"));
      assert.notInclude(verified.claim, "ARBITRARY MODEL WORDS");
      assert.include(verified.claim, `price = ${market.reading.price}`);
      assert.deepStrictEqual(verified.assertionEvidence, {
        actual: market.reading.price,
        source: "recording",
        sourceId: `chain:${market.id}:${market.reading.provenance.blockNumber}`,
        chainId: 8453,
        blockNumber: market.reading.provenance.blockNumber,
        blockHash: market.reading.provenance.blockHash,
      });
      const interpretation = yield* Effect.fromOption(
        Array.findFirst(notes, note => note.claim.startsWith("A free-form")),
      );
      assert.strictEqual(interpretation.status, "sourced");
      assert.isTrue(notes.every(note => note.visibility === "private" && note.position.disclosure === "undisclosed"));
      assert.isTrue(notes.every(note => note.publicationReason?.includes("No owner-authorized account") === true));
      assert.isEmpty(yield* db.notes.listPublic());
      assert.strictEqual((yield* Effect.fromOption(Array.head(yield* db.briefs.list()))).visibility, "private");
      assert.deepStrictEqual(calibration(notes), {
        checked: 3,
        verified: 2,
        contradicted: 1,
        rate: Option.some(2 / 3),
      });
    }));
});
