import { BunServices } from "@effect/platform-bun";
import { type ResearchOutput, UntrustedPage } from "@floor/agents";
import { researchNote, Thesis, undisclosedPosition } from "@floor/contract";
import { GateReview, LaunchGate } from "@floor/gate";
import { recordingJson } from "@floor/markets";
import { scopedAccountsLayer, scopedTransactionExecutorLayer, Signing } from "@floor/signing";
import { Array, ConfigProvider, DateTime, Effect, FileSystem, Layer, Schema } from "effect";
import { TestClock } from "effect/testing";
import { recordedGateEdges } from "../../../packages/gate/src/testing";
import { AccountContext } from "../../../packages/server/src/account-context";
import { ServerAgentRunner } from "../../../packages/server/src/agent-runner";
import { LaunchReviewEvidence, LaunchReviews } from "../../../packages/server/src/launch-reviews";
import { NotePositions, PositionChain } from "../../../packages/server/src/note-positions";
import { Proposals } from "../../../packages/server/src/proposals";
import { SigningJournalLive } from "../../../packages/server/src/signing-journal";
import { FloorDatabase } from "../../../packages/server/src/store";
import { FinancialChain, makeFinancialChain } from "./financial-chain";
import { CapturedDay, recordedFloor } from "./recorded-floor";
import { recordedResearchers } from "./recorded-research";
import { scopedSignerEdge } from "./scoped-signer-edge";

const accounts = scopedAccountsLayer.pipe(
  Layer.provideMerge(scopedSignerEdge),
  Layer.provide(
    ConfigProvider.layer(
      ConfigProvider.fromUnknown({
        FLOOR_SIGNER_URL: "https://isolated-signer.example",
        FLOOR_SIGNER_TOKEN: "isolated-fixture-token",
      }),
    ),
  ),
);
const signing = Signing.layer.pipe(
  Layer.provideMerge(SigningJournalLive),
  Layer.provide(scopedTransactionExecutorLayer),
  Layer.provideMerge(AccountContext.layer),
  Layer.provideMerge(accounts),
);
const positionChain = Layer.unwrap(
  Effect.map(FinancialChain, node =>
    PositionChain.layer.pipe(
      Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ BASE_SEPOLIA_RPC_URL: node.url }))),
    )),
);
/** @stability unstable */
export const financialFloorCore = Layer.mergeAll(Proposals.layer, NotePositions.layer).pipe(
  Layer.provideMerge(positionChain),
  Layer.provideMerge(signing),
  Layer.provideMerge(LaunchReviews.layer),
  Layer.provide(LaunchGate.layer),
  Layer.provideMerge(LaunchReviewEvidence.layer),
  Layer.provideMerge(recordedFloor),
  Layer.provideMerge(Layer.effect(FinancialChain, makeFinancialChain)),
  Layer.provide(BunServices.layer),
);
/** @stability unstable */
export const financialFloor = financialFloorCore.pipe(
  Layer.provide(GateReview.layer.pipe(Layer.provide(recordedGateEdges(0.95)))),
);

/** @stability unstable */
export const insertFinancialEvidence = Effect.gen(function*() {
  const db = yield* FloorDatabase;
  const node = yield* FinancialChain;
  const now = DateTime.formatIso(yield* DateTime.now);
  yield* db.owners.insert(node.ownerIdentity);
  yield* db.agents.insert(node.agent);
  yield* db.notes.insert(researchNote({
    id: "financial-note",
    agentId: node.agent.id,
    marketId: node.proposal.marketId,
    claim: "The recorded market exposes a real source block.",
    sources: [{
      id: "financial-source",
      kind: "chain",
      label: "Local Anvil evidence",
      url: "https://example.com/local-proof",
      blockNumber: 1,
    }],
    position: undisclosedPosition,
    status: "verified",
    visibility: "public",
    createdAt: now,
    blockNumber: 1,
    verification: "Exact captured source block",
  }));
  yield* db.theses.insert(Thesis.make({
    id: node.proposal.thesisId,
    agentId: node.agent.id,
    marketId: node.proposal.marketId,
    belief: "Inspect the source before a bounded testnet action.",
    invalidation: "Any conflicting source or failed policy check.",
    noteIds: ["financial-note"],
    createdAt: now,
  }));
});

const safeModel = Layer.unwrap(Effect.gen(function*() {
  const node = yield* FinancialChain;
  const recording = yield* CapturedDay;
  const snapshot = yield* Effect.fromOption(Array.last(recording.snapshots));
  const market = yield* Effect.fromOption(Array.head(snapshot.markets));
  const page = UntrustedPage.make({
    sourceId: "web:financial-page",
    url: "https://example.com/financial-research",
    title: "Bounded market research",
    untrusted: true,
    injectionWarning: false,
    text: "This page describes a token. Check chain data before acting.",
    capturedAt: snapshot.observedAt,
  });
  const output: typeof ResearchOutput.Type = {
    notes: [{
      marketId: market.id,
      claim: "The public page describes the token; its claims still need chain checks.",
      sourceIds: [page.sourceId],
    }],
    theses: [{
      marketId: market.id,
      belief: "A small testnet purchase can be inspected against persisted evidence.",
      invalidation: "Any changed owner limit or conflicting source.",
    }],
    proposals: [{ ...node.proposal, marketId: market.id, sourceIds: [page.sourceId] }],
    brief: "Source-linked research completed within the confirmed testnet limits.",
  };
  return recordedResearchers({ snapshot, page, output });
}));
/** @stability unstable */
export const financialResearch = Layer.unwrap(Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const recording = yield* Schema.decodeEffect(recordingJson)(
    yield* fs.readFileString("testing/recordings/base-day.json"),
  );
  const captured = yield* Effect.fromOption(Array.last(recording.snapshots));
  // Start the native test clock before polling fibers exist, aligned to an actual captured source block without inventing price samples.
  yield* TestClock.setTime(DateTime.toEpochMillis(yield* Effect.fromOption(DateTime.make(captured.blockTimestamp))));
  return ServerAgentRunner.layer.pipe(Layer.provideMerge(safeModel), Layer.provideMerge(financialFloor));
})).pipe(Layer.provide(BunServices.layer));
