import { Address, type Agent, PositionEvidence, researchNote, Thesis, undisclosedPosition } from "@floor/contract";
import { Effect, Option, Schema } from "effect";
import { stampPosition } from "../../src/note-positions";
import { FloorDatabase } from "../../src/store";

// Recorded publication evidence exercises filtering; the trade flow independently proves real RPC holdings acquisition.
/** @internal */
export const seedPublicResearch = Effect.fn("PublicResearchTest.seed")(function*(agent: Agent, marketId: string) {
  const db = yield* FloorDatabase;
  const account = yield* Schema.decodeUnknownEffect(Address)(agent.walletAddress);
  const evidence = PositionEvidence.make({
    account,
    chainId: 84532,
    tokenAddress: "0x2222222222222222222222222222222222222222",
    balanceBaseUnits: "2500000000000000000",
    supplyBaseUnits: "1000000000000000000000",
    decimals: 18,
    symbol: "TEST",
    blockNumber: 7,
    blockHash: `0x${"7".repeat(64)}`,
    observedAt: agent.createdAt,
    sourceUrl: "https://sepolia.basescan.org/block/7",
  });
  const note = researchNote({
    id: "published-note",
    agentId: agent.id,
    marketId,
    claim: "A published exact measurement.",
    sources: [{
      id: "source:7",
      kind: "chain",
      label: "Recorded fixture source",
      url: evidence.sourceUrl,
      blockNumber: 7,
    }],
    position: undisclosedPosition,
    status: "verified",
    visibility: "public",
    createdAt: agent.createdAt,
    blockNumber: 7,
    verification: "Recorded publication evidence.",
  });
  const published = stampPosition(
    note,
    "public",
    Option.some({
      status: "verified",
      position: { disclosure: "disclosed", amount: "2.5", symbol: "TEST", supplyPercent: 0.25 },
      evidence,
    }),
  );
  const pending = stampPosition(
    { ...note, id: "pending-note", claim: "PRIVATE PENDING RESEARCH" },
    "public",
    Option.some({ status: "unavailable", reason: "Holdings are not verified." }),
  );
  const invalidPublic = {
    ...pending,
    id: "unverified-public-note",
    claim: "UNVERIFIED PUBLIC FLAG",
    visibility: "public" as const,
  };
  yield* Effect.forEach([published, pending, invalidPublic], value => db.notes.insert(value), { discard: true });
  const supported = Thesis.make({
    id: "supported-thesis",
    agentId: agent.id,
    marketId,
    belief: "Public evidence supports this thesis.",
    invalidation: "A conflicting source.",
    noteIds: [published.id],
    createdAt: agent.createdAt,
  });
  const theses = [
    supported,
    { ...supported, id: "mixed-thesis", belief: "PRIVATE THESIS CONTENT", noteIds: [published.id, pending.id] },
    { ...supported, id: "unverified-thesis", noteIds: [invalidPublic.id] },
    { ...supported, id: "unsupported-thesis", noteIds: [] },
    { ...supported, id: "wrong-market-thesis", marketId: "different-market" },
  ];
  yield* Effect.forEach(theses, thesis => db.theses.insert(thesis), { discard: true });
  yield* db.threads.insert({
    id: "private-research-thread",
    agentId: agent.id,
    question: "PRIVATE LONG-RUN QUESTION",
    marketIds: [marketId],
    finding: "PRIVATE THREAD FINDING",
    createdAt: agent.createdAt,
  });
  for (
    const value of [{ id: "published-brief", noteIds: [published.id] }, {
      id: "unsupported-public-brief",
      noteIds: [published.id, pending.id],
    }]
  ) {
    yield* db.briefs.insert({
      ...value,
      agentId: agent.id,
      date: agent.createdAt.slice(0, 10),
      text: value.id,
      receiptIds: [],
      visibility: "public",
    });
  }
  return { published, pending, invalidPublic, supported, theses };
});
