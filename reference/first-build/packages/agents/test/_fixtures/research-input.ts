import { Agent, defaultPolicy } from "@floor/contract";
import type { MarketSnapshot } from "@floor/markets/schema";
import { Effect } from "effect";
import type { ResearchRunInput } from "../../src";

export const researcher = Agent.make({
  id: "agent-1",
  owner: "owner-1",
  name: "Reader",
  emblem: { shape: "circle", modifier: "dot" },
  walletAddress: "0x1111111111111111111111111111111111111111",
  mandate: "PRIVATE mandate",
  policy: defaultPolicy,
  visibility: "public",
  publishMandate: false,
  state: "asleep",
  paused: false,
  budget: { dailyUsd: 10, spentUsd: 0, day: "2026-10-11" },
  districtId: "base-harbour",
  createdAt: "2026-10-11T00:00:00Z",
});
export const snapshot: MarketSnapshot = {
  chainId: 8453,
  blockNumber: 1,
  blockHash: `0x${"1".repeat(64)}`,
  blockTimestamp: "2026-10-11T00:00:00Z",
  observedAt: "2026-10-11T00:00:00Z",
  source: "chain",
  markets: [],
  status: { mode: "live", message: "Test boundary" },
};
export const researchInput: ResearchRunInput = {
  agent: researcher,
  snapshot,
  publicNotes: [],
  reserveBudget: () => Effect.succeed(true),
  onBrowser: () => Effect.void,
};
