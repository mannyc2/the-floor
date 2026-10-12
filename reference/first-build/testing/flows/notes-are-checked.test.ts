import { assert, it } from "@effect/vitest";
import { Note, researchNote, undisclosedPosition, webResearchSource } from "@floor/contract";
import { Markets } from "@floor/markets";
import { calibration, verifyClaim } from "@floor/research";
import { Array, Effect, Option, Schema } from "effect";
import { researcher } from "../../packages/agents/test/_fixtures/research-input";
import { FloorDatabase } from "../../packages/server/src/store";
import { recordedFloor } from "./_fixtures/recorded-floor";

it.layer(recordedFloor)("notes are checked", test => {
  test.effect("commits verified and contradicted claims only with matching block evidence", () =>
    Effect.gen(function*() {
      const markets = yield* Markets;
      const db = yield* FloorDatabase;
      const snapshot = yield* markets.fetchSnapshot();
      const market = yield* Effect.fromOption(Array.head(snapshot.markets));
      yield* db.owners.insert({ id: researcher.owner, walletAddress: researcher.walletAddress, mode: "wallet" });
      yield* db.agents.insert(researcher);
      const note = researchNote({
        id: "measured-reserve",
        agentId: researcher.id,
        marketId: market.id,
        claim: "The token reserve matches the cited block",
        sources: [{
          id: "base-reading",
          kind: "chain",
          label: `Base block ${snapshot.blockNumber}`,
          url: `https://basescan.org/block/${snapshot.blockNumber}`,
          blockNumber: snapshot.blockNumber,
        }],
        position: undisclosedPosition,
        status: "pending",
        visibility: "public",
        createdAt: snapshot.observedAt,
        blockNumber: snapshot.blockNumber,
        verification: "Awaiting the deterministic claim check",
      });
      const claim = {
        kind: "equals" as const,
        field: "reserve0",
        expected: market.reading.reserve0,
        blockNumber: snapshot.blockNumber,
      };
      const evidence = {
        source: snapshot.source,
        blockNumber: snapshot.blockNumber,
        values: { reserve0: market.reading.reserve0 },
      };
      const checked = [
        verifyClaim(note, Option.some(claim), Option.some(evidence)),
        verifyClaim(
          { ...note, id: "wrong-reserve" },
          Option.some({ ...claim, expected: claim.expected + 1 }),
          Option.some(evidence),
        ),
        verifyClaim(
          { ...note, id: "wrong-block" },
          Option.some({ ...claim, blockNumber: claim.blockNumber - 1 }),
          Option.some(evidence),
        ),
        verifyClaim(
          {
            ...note,
            id: "web-claim",
            sources: [
              webResearchSource({ id: "web", kind: "web", label: "A cited page", url: "https://example.com/claim" }),
            ],
          },
          Option.some(claim),
          Option.some(evidence),
        ),
      ];
      yield* db.sql.withTransaction(Effect.forEach(checked, value => db.notes.insert(value), { discard: true }));
      const persisted = yield* Effect.forEach(yield* db.notes.list(), row => Schema.decodeEffect(Note)(row));
      assert.deepStrictEqual(persisted.map(value => value.status).toSorted(), [
        "contradicted",
        "pending",
        "sourced",
        "verified",
      ]);
      assert.deepStrictEqual(calibration(persisted), {
        checked: 2,
        verified: 1,
        contradicted: 1,
        rate: Option.some(0.5),
      });
    }));
});
