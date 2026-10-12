import { BunServices } from "@effect/platform-bun";
import { assert, it } from "@effect/vitest";
import { assignTiers } from "@floor/districts";
import { evaluateDesignGate, lilyPondDesign } from "@floor/gate";
import { MarketHistory, recordingJson } from "@floor/markets";
import { createLayout } from "@floor/renderer/layout";
import { atlasMarket } from "@floor/renderer/market-view";
import type { AtlasSnapshot, Owner } from "@floor/surfaces";
import { DateTime, Effect, Exit, FileSystem, Layer, Option, Schema } from "effect";
import { TestClock } from "effect/testing";
import { Community } from "../src/community";
import { TokenHolders } from "../src/holder-evidence";
import { databaseLayer } from "../src/sqlite-store";
import { FloorDatabase } from "../src/store";

const supporter: Owner = {
  id: "holder-support",
  walletAddress: "0x0000000000000000000000000000000000000001",
  mode: "wallet",
};
const opponent: Owner = {
  id: "holder-oppose",
  walletAddress: "0x0000000000000000000000000000000000000002",
  mode: "wallet",
};
const smallHolder: Owner = {
  id: "holder-small",
  walletAddress: "0x0000000000000000000000000000000000000003",
  mode: "wallet",
};
const outsider: Owner = { id: "outsider", walletAddress: "0x0000000000000000000000000000000000000004", mode: "wallet" };
// Only the external balance RPC is recorded; vote weights, timing, persistence, quorum and replay use production services.
const balances = new Map([[supporter.walletAddress, 600_000n], [opponent.walletAddress, 300_000n], [
  smallHolder.walletAddress,
  1001n,
]]);
const holders = Layer.succeed(
  TokenHolders,
  TokenHolders.of({
    at: request => Effect.succeed({ balance: balances.get(request.wallet) ?? 0n, supply: 1_000_000n }),
  }),
);
const dependencies = Community.layer.pipe(
  Layer.provide(holders),
  Layer.provideMerge(databaseLayer(":memory:")),
  Layer.provideMerge(BunServices.layer),
);
const setup = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const recording = yield* Schema.decodeEffect(recordingJson)(
    yield* fs.readFileString("testing/recordings/base-day.json"),
  );
  const source = yield* Effect.fromOption(Option.fromUndefinedOr(recording.snapshots.at(-1)));
  yield* TestClock.setTime(DateTime.toEpochMillis(DateTime.makeUnsafe(source.blockTimestamp)));
  const history = yield* MarketHistory;
  yield* history.importRecording(recording);
  // This ballot fixture supplies a complete activity observation; the bundled short flow windows alone cannot imply a day's trades.
  const tiers = assignTiers(
    source.markets.map(market => ({
      marketId: market.id,
      districtId: market.districtId,
      liquidityUsd: Option.fromNullOr(market.liquidityUsd),
      activity: { lowerBound: 500, complete: true },
    })),
    [],
  );
  const db = yield* FloorDatabase;
  for (const owner of [supporter, opponent, smallHolder, outsider]) yield* db.owners.insert(owner);
  yield* db.marketSlots.ensure(source.markets.map(market => market.id));
  const slots = yield* db.marketSlots.list();
  const layout = createLayout(source.markets.map(atlasMarket), {
    lens: "flow",
    moorings: new Set(),
    explodedId: Option.none(),
    activeMarketId: Option.none(),
    slots,
    tiers,
  });
  const site = yield* Effect.fromOption(
    Option.fromUndefinedOr(
      layout.markets.find(item => item.market.kind === "constant-product" && item.tier === "works"),
    ),
  );
  const design = { ...lilyPondDesign, tokenId: site.market.id };
  // This is an explicit recorded review edge; the separate gate flow renders and inspects its real Chromium image.
  const gate = evaluateDesignGate(
    design,
    Option.some({
      rendered: true,
      imageUrl: Option.some("https://fixture.invalid/accepted-lily.png"),
      legibility: { reserve0: 0.95, reserve1: 0.95, price: 0.95, trades: 0.95, history: 0.95 },
      judgment: {
        "no-impersonation": 0.95,
        "no-copyrighted-characters": 0.95,
        "no-slurs": 0.95,
        "no-scam-links": 0.95,
      },
    }),
    Option.some({ plinthAvailable: true, maxWidth: 20, maxDepth: 20, overlapsMachine: false }),
  );
  assert.strictEqual(gate.status, "accepted");
  yield* db.designs.insert({
    id: "accepted-lily",
    owner: supporter.id,
    design,
    status: gate.status,
    checks: gate.checks,
    createdAt: source.blockTimestamp,
  });
  yield* db.designs.insert({
    id: "pending-lily",
    owner: supporter.id,
    design,
    status: "review",
    checks: [{ name: "Render", status: "review", detail: "No verified image" }],
    createdAt: source.blockTimestamp,
  });
  const snapshot: AtlasSnapshot = {
    market: { ...source, source: "chain", status: { mode: "live", message: "Recorded live RPC edge" } },
    slots,
    adoptedDesigns: [],
    tiers,
    // oxlint-disable-next-line effect/noNullish -- This recorded transport fixture has no chosen orange market.
    activeMarketId: null,
    historyBlocks: [],
    replay: false,
  };
  return { snapshot, marketId: site.market.id };
});

it.effect("holders adopt only reviewed designs after a snapshot-weighted 72-hour ballot", () =>
  Effect.gen(function*() {
    const { snapshot, marketId } = yield* setup;
    const community = yield* Community;
    assert.isTrue(Exit.isFailure(yield* Effect.exit(community.propose(outsider, "accepted-lily", marketId, snapshot))));
    assert.isTrue(Exit.isFailure(yield* Effect.exit(community.propose(supporter, "pending-lily", marketId, snapshot))));
    assert.isTrue(
      Exit.isFailure(
        yield* Effect.exit(community.propose(supporter, "accepted-lily", marketId, { ...snapshot, replay: true })),
      ),
    );
    const election = yield* community.propose(supporter, "accepted-lily", marketId, snapshot);
    assert.strictEqual(election.quorumRaw, "10000");
    assert.isTrue(
      Exit.isFailure(yield* Effect.exit(community.propose(supporter, "accepted-lily", marketId, snapshot))),
    );
    yield* community.vote(supporter, election.id, true);
    const opposed = yield* community.vote(opponent, election.id, false);
    assert.strictEqual(opposed.supportRaw, "600000");
    assert.strictEqual(opposed.opposeRaw, "300000");
    // A second session with the same wallet changes the existing ballot rather than multiplying its weight.
    const changed = yield* community.vote({ ...supporter, id: "second-session" }, election.id, false);
    assert.strictEqual(changed.supportRaw, "0");
    assert.strictEqual(changed.opposeRaw, "900000");
    yield* community.vote(supporter, election.id, true);
    assert.isTrue(Exit.isFailure(yield* Effect.exit(community.finalize(supporter, election.id))));
    yield* TestClock.adjust("72 hours");
    assert.isTrue(Exit.isFailure(yield* Effect.exit(community.vote(opponent, election.id, true))));
    const finalized = yield* community.finalize(supporter, election.id);
    assert.strictEqual(finalized.status, "adopted");
    assert.deepStrictEqual(yield* community.adoptedAt(snapshot.market.blockTimestamp), []);
    const adopted = yield* community.adoptedAt(DateTime.formatIso(yield* DateTime.now));
    assert.strictEqual(adopted.length, 1);
    assert.strictEqual(adopted[0]?.marketId, marketId);
    assert.strictEqual(adopted[0]?.design.id, lilyPondDesign.id);
    assert.deepStrictEqual(yield* community.finalize(supporter, election.id), finalized);
    // oxlint-disable-next-line effecttsgo/strict-effect-provide -- Each ballot flow owns a real isolated SQLite database and native test clock.
  }).pipe(Effect.provide(dependencies)));

it.effect("a majority without supply quorum leaves the existing form unchanged", () =>
  Effect.gen(function*() {
    const { snapshot, marketId } = yield* setup;
    const community = yield* Community;
    const election = yield* community.propose(smallHolder, "accepted-lily", marketId, snapshot);
    yield* community.vote(smallHolder, election.id, true);
    yield* TestClock.adjust("72 hours");
    assert.strictEqual((yield* community.finalize(smallHolder, election.id)).status, "rejected");
    assert.deepStrictEqual(yield* community.adoptedAt(DateTime.formatIso(yield* DateTime.now)), []);
    // oxlint-disable-next-line effecttsgo/strict-effect-provide -- The failing quorum case must not inherit the successful ballot's persistent rows.
  }).pipe(Effect.provide(dependencies)));
