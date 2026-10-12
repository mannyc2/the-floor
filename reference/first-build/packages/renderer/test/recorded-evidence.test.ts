import { BunFileSystem } from "@effect/platform-bun";
import { expect, it } from "@effect/vitest";
import { PublicAgent, PublicReceipt, researchNote, undisclosedPosition } from "@floor/contract";
import { type MarketRecording, Markets, recordingJson } from "@floor/markets";
import { Array, Context, Effect, FileSystem, Layer, Option, Schema } from "effect";
import { recordedMarkets } from "../../markets/src/testing";
import { eligibleEvidence } from "../src/evidence";
import { createLayout } from "../src/layout";
import { atlasMarket } from "../src/market-view";
import { AtlasEvidence } from "../src/types";

class RecordedDay extends Context.Service<RecordedDay, MarketRecording>()("renderer/test/RecordedDay") {}
const recording = Layer.effect(
  RecordedDay,
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem;
    return yield* Schema.decodeEffect(recordingJson)(yield* fs.readFileString("data/base-day.json"));
  }),
).pipe(Layer.provide(BunFileSystem.layer));
const runtime = Layer.unwrap(Effect.map(RecordedDay, recordedMarkets)).pipe(Layer.provideMerge(recording));
const options = {
  lens: "flow" as const,
  moorings: new Set<string>(),
  explodedId: Option.none<string>(),
  activeMarketId: Option.none<string>(),
};
// This is the explicit absence representation on the public JSON contracts.
// oxlint-disable-next-line effect/noNullish -- Public receipt expiry and note verification are nullable transport fields.
const absent = null;
const floats = (layout: ReturnType<typeof createLayout>) =>
  layout.parts.filter(part => part.material === "brass" && part.size[1] === 0.14 * 0.85);

it.layer(runtime)("recorded renderer evidence", test => {
  test.effect("draws the same observed instruments for replay and captured live reads", () =>
    Effect.gen(function*() {
      const day = yield* RecordedDay;
      const markets = yield* Markets;
      const last = yield* Effect.fromOption(Array.last(day.snapshots));
      const replay = yield* Effect.fromOption(yield* markets.replay(last.blockNumber));
      const captured = yield* markets.fetchAtBlock(last.blockNumber);
      const replayMarkets = replay.markets.map(atlasMarket);
      const capturedMarkets = captured.markets.map(atlasMarket);
      const active = yield* Effect.fromOption(Array.head(replayMarkets));
      // These declarations exercise full instrument rendering; live district policy supplies its own observed tiers.
      const settings = {
        ...options,
        tiers: replayMarkets.map(market => ({ marketId: market.id, tier: "works" as const })),
        activeMarketId: Option.some(active.id),
      };
      const replayLayout = createLayout(replayMarkets, settings);
      const liveLayout = createLayout(capturedMarkets, settings);
      expect(replayMarkets.every(market => market.source === "recording" && !market.stale)).toBe(true);
      expect(capturedMarkets.every(market => market.source === "chain" && !market.stale)).toBe(true);
      expect(replayMarkets.every(market => (market.priceHistory?.length ?? 0) > 1)).toBe(true);
      expect(replayLayout.parts).toEqual(liveLayout.parts);
      expect(replayLayout.paths).toEqual(liveLayout.paths);
      expect(replayLayout.parts.some(part => part.material === "brass")).toBe(true);
      expect(replayLayout.parts.some(part => part.material === "water")).toBe(true);
      expect(replayLayout.parts.filter(part => part.material === "accent")).toHaveLength(1);
      // A history float follows quote-token prices even if the independent USD conversion is unavailable.
      const noUsd = createLayout(replayMarkets.map(market => ({ ...market, priceUsd: absent })), settings);
      expect(noUsd.paths.filter(path => path.length === day.snapshots.length)).toEqual(
        replayLayout.paths.filter(path => path.length === day.snapshots.length),
      );
      expect(floats(noUsd)).toHaveLength(replayMarkets.length);
      expect(floats(noUsd)).toEqual(floats(replayLayout));
    }));

  test.effect("places real identities once and stamps only observed confirmations inside the trace", () =>
    Effect.gen(function*() {
      const day = yield* RecordedDay;
      const markets = yield* Markets;
      const first = yield* Effect.fromOption(Array.head(day.snapshots));
      const middle = yield* Effect.fromOption(Array.get(day.snapshots, 12));
      const last = yield* Effect.fromOption(Array.last(day.snapshots));
      const snapshot = yield* Effect.fromOption(yield* markets.replay(last.blockNumber));
      const observations = snapshot.markets.map(atlasMarket);
      const instrumentOptions = {
        ...options,
        tiers: observations.map(market => ({ marketId: market.id, tier: "works" as const })),
      };
      const market = yield* Effect.fromOption(Array.head(observations));
      const other = yield* Effect.fromOption(Array.get(observations, 1));
      const agent = PublicAgent.make({
        id: "observed-researcher",
        name: "Observed researcher",
        emblem: { shape: "triangle", modifier: "dot" },
        state: "asleep",
        districtId: "base",
        createdAt: first.blockTimestamp,
        publishedMandate: Option.none(),
      });
      const idle = PublicAgent.make({ ...agent, id: "quay-researcher", emblem: { shape: "circle", modifier: "bar" } });
      const future = PublicAgent.make({ ...agent, id: "future-researcher", createdAt: "2100-01-01T00:00:00.000Z" });
      const receipt = PublicReceipt.make({
        id: "observed-confirmation",
        proposalId: "captured-proposal",
        agentId: agent.id,
        marketId: market.id,
        chainId: 84532,
        action: "trade",
        amount: "1",
        symbol: market.symbol,
        valueUsd: 1,
        thesisId: "observed-thesis",
        sourceIds: ["captured-source"],
        policyVersion: 1,
        checks: [],
        reason: "Confirmed test receipt",
        createdAt: first.blockTimestamp,
        updatedAt: middle.blockTimestamp,
        expiresAt: absent,
        status: "confirmed",
        transactionHash: `0x${"1".repeat(64)}`,
        // A testnet height must never be ordered against the Base mainnet source block.
        blockNumber: last.blockNumber + 1_000_000,
      });
      const evidence = AtlasEvidence.make({
        agents: [future, idle, agent],
        receipts: [
          receipt,
          { ...receipt, id: "future-state", updatedAt: future.createdAt },
          { ...receipt, id: "future-same-chain-block", chainId: 8453 },
          { ...receipt, id: "unknown-identity", agentId: "unknown" },
          { ...receipt, id: "outside-observed-trace", updatedAt: "2020-01-01T00:00:00.000Z" },
        ],
        notes: [researchNote({
          id: "earlier-observed-note",
          agentId: agent.id,
          marketId: other.id,
          claim: "A sourced observation before the confirmation",
          sources: [],
          position: undisclosedPosition,
          status: "sourced",
          visibility: "public",
          createdAt: first.blockTimestamp,
          blockNumber: first.blockNumber,
          verification: absent,
        })],
        observedAt: last.blockTimestamp,
        chainId: 8453,
        blockNumber: last.blockNumber,
      });
      const eligible = eligibleEvidence(evidence);
      expect(eligible.agents.map(identity => identity.id)).toEqual([agent.id, idle.id]);
      expect(eligible.receipts.map(item => item.id)).toEqual(["outside-observed-trace", receipt.id]);
      const layout = createLayout(observations, { ...instrumentOptions, evidence });
      expect(layout.agentPlacements).toHaveLength(2);
      expect(layout.agentPlacements.find(placement => placement.agent.id === agent.id)?.marketId).toEqual(
        Option.some(market.id),
      );
      expect(layout.agentPlacements.find(placement => placement.agent.id === idle.id)?.marketId).toEqual(
        Option.none(),
      );
      expect(layout.receiptStamps.map(stamp => [stamp.receipt.id, stamp.agent.id])).toEqual([[receipt.id, agent.id]]);
      expect(layout.labels.filter(label => label.id.startsWith("agent:")).map(label => label.id)).toEqual([
        `agent:${agent.id}`,
        `agent:${idle.id}`,
      ]);
      const reordered = createLayout(observations.toReversed(), {
        ...instrumentOptions,
        evidence: { ...evidence, agents: evidence.agents.toReversed(), receipts: evidence.receipts.toReversed() },
      });
      expect(reordered.agentPlacements).toEqual(layout.agentPlacements);
      expect(reordered.receiptStamps).toEqual(layout.receiptStamps);
      const beforeConfirmation = createLayout(observations, {
        ...instrumentOptions,
        evidence: { ...evidence, observedAt: first.blockTimestamp, blockNumber: first.blockNumber },
      });
      expect(beforeConfirmation.receiptStamps).toHaveLength(0);
      expect(beforeConfirmation.agentPlacements.find(placement => placement.agent.id === agent.id)?.marketId).toEqual(
        Option.some(other.id),
      );
      const changedEmblem = createLayout(observations, {
        ...instrumentOptions,
        evidence: { ...evidence, agents: [idle, { ...agent, emblem: { shape: "hexagon", modifier: "ring" } }] },
      });
      expect(changedEmblem.paths).not.toEqual(layout.paths);
      expect(createLayout(observations.map(item => ({ ...item, agentCount: 20 })), options).parts).toEqual(
        createLayout(observations, options).parts,
      );
    }));
});
