import { BunHttpServer } from "@effect/platform-bun";
import { assert, it } from "@effect/vitest";
import { Agent, defaultPolicy, researchNote, withoutTransaction } from "@floor/contract";
import { GateReview, LaunchGate } from "@floor/gate";
import { scopedAccountsLayer, Signing, TransactionExecutor } from "@floor/signing";
import { AtlasSnapshot, FloorApi, OwnerAuthorization } from "@floor/surfaces";
import { Array, ConfigProvider, DateTime, Effect, Exit, Layer, Option, Redacted, Stream } from "effect";
import { FetchHttpClient, HttpClientRequest } from "effect/http";
import { HttpApiMiddleware, HttpApiTest } from "effect/http-api";
import { RateLimiter } from "effect/persistence";
import { recordedGateEdges } from "../../gate/src/testing";
import { AccountContext, unverifiedContext } from "../src/account-context";
import { ServerAgentRunner } from "../src/agent-runner";
import { ApiHandlers, Workspaces } from "../src/application";
import { Atlas } from "../src/atlas";
import { Auth } from "../src/auth";
import { Community } from "../src/community";
import { ServerConfig } from "../src/config";
import { TokenHolders } from "../src/holder-evidence";
import { LaunchReviewEvidence, LaunchReviews } from "../src/launch-reviews";
import { PlateRenderer } from "../src/plate-renderer";
import { Proposals } from "../src/proposals";
import { SigningJournalLive } from "../src/signing-journal";
import { databaseLayer } from "../src/sqlite-store";
import { FloorDatabase } from "../src/store";
import { seedPublicResearch } from "./_fixtures/public-research";

const recorded = AtlasSnapshot.make({
  market: {
    chainId: 8453,
    blockNumber: 1,
    blockHash: "recorded-block",
    blockTimestamp: "2026-01-01T00:00:00.000Z",
    observedAt: "2026-01-01T00:00:00.000Z",
    source: "recording",
    markets: [],
    status: { mode: "recording", message: "Test record" },
  },
  // oxlint-disable-next-line effect/noNullish -- This transport fixture contains no market and therefore no active market ID.
  activeMarketId: null,
  slots: [],
  adoptedDesigns: [],
  tiers: [],
  historyBlocks: [],
  replay: false,
});
// Only external research and market delivery are substituted; owner authority and persistence use their production implementations.
const externalServices = Layer.mergeAll(
  Layer.succeed(
    Atlas,
    Atlas.of({ snapshot: () => Effect.succeed(recorded), changes: Stream.empty, refresh: Effect.void }),
  ),
  Layer.succeed(
    ServerAgentRunner,
    ServerAgentRunner.of({
      run: () => Effect.succeed("Research disabled in this test."),
      pause: () => Effect.void,
      status: Effect.succeed([]),
    }),
  ),
);
const workspaceHandlers = ApiHandlers.pipe(
  Layer.provideMerge(Workspaces.layer),
  Layer.provide(Community.layer.pipe(Layer.provide(TokenHolders.unavailable))),
  Layer.provide(PlateRenderer.unavailable),
  Layer.provideMerge(Auth.layer),
  Layer.provide(
    Proposals.layer.pipe(
      Layer.provideMerge(
        Signing.layer.pipe(Layer.provide(SigningJournalLive), Layer.provide(TransactionExecutor.unavailable)),
      ),
    ),
  ),
  Layer.provide(LaunchReviews.layer),
  Layer.provide(LaunchGate.layer),
  Layer.provide(GateReview.layer.pipe(Layer.provide(recordedGateEdges(0.95)))),
);
const application = workspaceHandlers.pipe(
  Layer.provideMerge(AccountContext.layer),
  Layer.provide(LaunchReviewEvidence.layer),
  Layer.provide(
    scopedAccountsLayer.pipe(
      Layer.provide(FetchHttpClient.layer),
      Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({}))),
    ),
  ),
  Layer.provide(externalServices),
  Layer.provideMerge(databaseLayer(":memory:")),
  Layer.provide(ServerConfig.layer),
  Layer.provide(RateLimiter.layer.pipe(Layer.provide(RateLimiter.layerStoreMemory))),
  Layer.provideMerge(BunHttpServer.layerHttpServices),
);
// The remote account/quote is the only substituted authority; SQL, policy, proposal review, approval and reservation are real.
const configuredApplication = workspaceHandlers.pipe(
  Layer.provide(Layer.effect(
    AccountContext,
    Effect.gen(function*() {
      const launchEvidence = yield* LaunchReviewEvidence;
      return AccountContext.of({
        status: { configured: true, detail: "Independent account fixture" },
        load: Effect.fn("WorkspaceTest.account")(function*(agent, owner, proposal) {
          const now = yield* DateTime.now;
          return {
            ...unverifiedContext(agent, owner, now),
            walletAddress: Option.some("0x0000000000000000000000000000000000000003"),
            walletUsd: 10000,
            resultingPositionUsd: 20,
            quotedValueUsd: Option.some(20),
            quoteExpiresAt: Option.some(DateTime.formatIso(DateTime.add(now, { minutes: 5 }))),
            sourceEvidenceVerified: true,
            launchGateApproved: Option.isSome(proposal) && proposal.value.action === "launch"
              ? yield* launchEvidence.accepted(proposal.value)
              : false,
          };
        }),
      });
    }),
  )),
  Layer.provide(LaunchReviewEvidence.layer),
  Layer.provide(externalServices),
  Layer.provideMerge(databaseLayer(":memory:")),
  Layer.provide(ServerConfig.layer),
  Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({
    FLOOR_FOUNDRY_ADDRESS: "0x0000000000000000000000000000000000000004",
    FLOOR_FOUNDRY_TOKEN_SUPPLY: "1000000",
    FLOOR_FOUNDRY_LAUNCH_FEE_WEI: "1000000000000000",
    FLOOR_FOUNDRY_GRADUATION_WEI: "1000000000000000000",
    FLOOR_FOUNDRY_VIRTUAL_LIQUIDITY_WEI: "1000000000000000000",
  }))),
  Layer.provide(RateLimiter.layer.pipe(Layer.provide(RateLimiter.layerStoreMemory))),
  Layer.provideMerge(BunHttpServer.layerHttpServices),
);
const clientAuthorization = (token: Option.Option<Redacted.Redacted>) =>
  HttpApiMiddleware.layerClient(
    OwnerAuthorization,
    ({ next, request }) =>
      next(Option.match(token, {
        onNone: () => request,
        onSome: value => HttpClientRequest.setHeader(request, "cookie", `floor_session=${Redacted.value(value)}`),
      })),
  );
// Each client owns its authentication boundary; the real server still resolves the issued session.
const workspaceClient = (token: Option.Option<Redacted.Redacted>) =>
  HttpApiTest.groups(FloorApi, ["workspace"]).pipe(
    // oxlint-disable-next-line effecttsgo/strict-effect-provide -- Client construction is a composition boundary for its outgoing middleware.
    Effect.provide(clientAuthorization(token)),
  );

const withdrawalAgent = (owner: string, now: string): Agent =>
  Agent.make({
    id: "withdrawal-desk",
    owner,
    name: "Paused owner desk",
    emblem: { shape: "triangle", modifier: "dot" },
    walletAddress: "0x0000000000000000000000000000000000000003",
    mandate: "Remain paused",
    policy: { ...defaultPolicy, confirmedAt: now },
    visibility: "private",
    publishMandate: false,
    paused: true,
    state: "asleep",
    budget: { dailyUsd: 1, spentUsd: 0, day: now.slice(0, 10) },
    districtId: "base-harbour",
    createdAt: now,
  });

it.effect("workspace HTTP rejects missing sessions and omits private agent authority", () =>
  Effect.gen(function*() {
    const db = yield* FloorDatabase;
    const auth = yield* Auth;
    const owner = yield* db.owners.insert({
      id: "owner",
      walletAddress: "0x0000000000000000000000000000000000000001",
      mode: "wallet",
    });
    const viewer = yield* db.owners.insert({
      id: "viewer",
      walletAddress: "0x0000000000000000000000000000000000000002",
      mode: "wallet",
    });
    const agent = Agent.make({
      id: "public-desk",
      owner: owner.id,
      name: "Public desk",
      emblem: { shape: "circle", modifier: "dot" },
      walletAddress: "0x0000000000000000000000000000000000000003",
      mandate: "Private mandate",
      policy: defaultPolicy,
      visibility: "public",
      publishMandate: false,
      state: "asleep",
      paused: false,
      budget: { dailyUsd: 1, spentUsd: 0, day: "2026-01-01" },
      districtId: "base-harbour",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    yield* db.agents.insert(agent);
    yield* db.agents.insert({
      ...agent,
      id: "private-desk",
      name: "Private desk",
      visibility: "private",
      emblem: { shape: "square", modifier: "dot" },
    });
    const research = yield* seedPublicResearch(agent, "recorded-market");
    yield* db.receipts.insert({
      data: withoutTransaction({
        id: "public-receipt",
        proposalId: "private-proposal",
        proposalFingerprint: "private-identity-fingerprint",
        agentId: agent.id,
        owner: owner.id,
        marketId: "recorded-market",
        chainId: 84532,
        action: "refusal",
        amount: "1",
        symbol: "ETH",
        valueUsd: 1,
        thesisId: "thesis",
        sourceIds: [],
        policyVersion: 1,
        checks: [{ rule: "owner", passed: true, actual: owner.id, limit: "private-wallet-limit" }],
        reason: "No signing account connected",
        createdAt: agent.createdAt,
        updatedAt: agent.createdAt,
        expiresAt: agent.createdAt,
        status: "refused",
      }),
    });
    yield* db.proposals.insert({
      id: "private-proposal",
      agentId: agent.id,
      owner: owner.id,
      action: "trade",
      chainId: 84532,
      protocol: "owner-private-protocol",
      contract: "0x0000000000000000000000000000000000000004",
      method: "swap",
      recipient: "0x0000000000000000000000000000000000000003",
      marketId: "recorded-market",
      amount: "1",
      symbol: "ETH",
      valueUsd: 1,
      slippageBps: 10,
      thesisId: "thesis",
      sourceIds: ["private-source"],
      createdAt: agent.createdAt,
    });
    const token = yield* auth.issue(viewer);
    const anonymous = yield* workspaceClient(Option.none());
    const missing = yield* Effect.exit(anonymous.workspace.get());
    assert.isTrue(Option.exists(Exit.findErrorOption(missing), error => error._tag === "Unauthorized"));
    const authenticated = yield* workspaceClient(Option.some(token));
    const workspace = yield* authenticated.workspace.get();
    assert.deepStrictEqual(workspace.agents, []);
    assert.deepStrictEqual(workspace.proposals, []);
    assert.deepStrictEqual(workspace.notes.map(note => note.id), [research.published.id]);
    assert.deepStrictEqual(workspace.theses.map(thesis => thesis.id), [research.supported.id]);
    assert.isEmpty(workspace.threads);
    assert.deepStrictEqual(workspace.briefs.map(brief => brief.id), ["published-brief"]);
    assert.strictEqual(workspace.publicAgents.length, 1);
    const publicDesk = yield* Effect.fromOption(Array.head(workspace.publicAgents));
    assert.deepStrictEqual(Object.keys(publicDesk).toSorted(), [
      "createdAt",
      "districtId",
      "emblem",
      "id",
      "name",
      "publishedMandate",
      "state",
    ]);
    assert.isTrue(Option.isNone(publicDesk.publishedMandate));
    const receipt = yield* Effect.fromOption(Array.head(workspace.receipts));
    assert.isFalse("owner" in receipt);
    assert.isFalse("proposalFingerprint" in receipt);
    assert.deepStrictEqual(receipt.checks, [{ rule: "owner", passed: true }]);
    const ownerClient = yield* workspaceClient(Option.some(yield* auth.issue(owner)));
    const ownedWorkspace = yield* ownerClient.workspace.get();
    assert.strictEqual(ownedWorkspace.proposals.length, 1);
    assert.lengthOf(ownedWorkspace.notes, 3);
    assert.lengthOf(ownedWorkspace.theses, 5);
    assert.lengthOf(ownedWorkspace.threads, 1);
    assert.lengthOf(ownedWorkspace.briefs, 2);
    assert.isTrue(ownedWorkspace.notes.some(note =>
      note.id === research.pending.id && note.publicationReason?.includes("Holdings are not verified") === true
    ));
    const unauthorizedPause = yield* Effect.exit(
      authenticated.workspace.act({ payload: { action: { tag: "pause-agent", id: agent.id, paused: true } } }),
    );
    assert.isTrue(Exit.isFailure(unauthorizedPause));
    assert.isFalse((yield* db.agents.findById(agent.id)).paused);
    yield* ownerClient.workspace.act({
      payload: {
        action: {
          tag: "update-agent",
          id: agent.id,
          name: agent.name,
          mandate: agent.mandate,
          policy: agent.policy,
          visibility: "private",
          publishMandate: false,
          dailyBudget: agent.budget.dailyUsd,
        },
      },
    });
    const afterPrivacyChange = yield* authenticated.workspace.get();
    assert.isEmpty(afterPrivacyChange.notes);
    assert.isEmpty(afterPrivacyChange.theses);
    assert.isEmpty(afterPrivacyChange.briefs);
    assert.isEmpty(afterPrivacyChange.publicAgents);
    assert.lengthOf((yield* ownerClient.workspace.get()).notes, 3);
    const created = yield* authenticated.workspace.act({
      payload: {
        action: {
          tag: "create-agent",
          name: "Viewer desk",
          mandate: "Observe only",
          policy: defaultPolicy,
          visibility: "private",
          emblem: { shape: "triangle", modifier: "dot" },
          dailyBudget: 1,
        },
      },
    });
    assert.isTrue(Option.isSome(Option.fromNullishOr(created.id)));
    const updated = yield* authenticated.workspace.get();
    const desk = yield* Effect.fromOption(Array.head(updated.agents));
    assert.strictEqual(desk.owner, viewer.id);
    assert.strictEqual(desk.name, "Viewer desk");
    assert.strictEqual(desk.policy.version, 1);
    assert.isTrue(Option.isSome(Option.fromNullishOr(desk.policy.confirmedAt)));
    for (const name of ["First circle", "Second circle", "Third circle"]) {
      yield* authenticated.workspace.act({
        payload: {
          action: {
            tag: "create-agent",
            name,
            mandate: "Observe only",
            policy: defaultPolicy,
            visibility: "private",
            // oxlint-disable-next-line effect/noNullish -- The wire contract represents a plain emblem with a null modifier.
            emblem: { shape: "circle", modifier: null },
            dailyBudget: 1,
          },
        },
      });
    }
    const allocated = (yield* authenticated.workspace.get()).agents.filter(value =>
      value.emblem.shape === "circle"
    );
    assert.strictEqual(new Set(allocated.map(value => value.emblem.modifier)).size, 3);
    const exhausted = yield* Effect.exit(authenticated.workspace.act({
      payload: {
        action: {
          tag: "create-agent",
          name: "Fourth circle",
          mandate: "Observe only",
          policy: defaultPolicy,
          visibility: "private",
          // oxlint-disable-next-line effect/noNullish -- The requested plain modifier is a transport fixture.
          emblem: { shape: "circle", modifier: null },
          dailyBudget: 1,
        },
      },
    }));
    assert.isTrue(Option.exists(Exit.findErrorOption(exhausted), error =>
      error._tag === "ApiError" && error.message.includes("Choose another shape")));
    // oxlint-disable-next-line effecttsgo/strict-effect-provide -- The test entry point constructs a fresh real database and handler scope.
  }).pipe(Effect.provide(application)));

it.effect("workspace casting binds sourced terms and keeps approval subject to explicit owner pause", () =>
  Effect.gen(function*() {
    const db = yield* FloorDatabase;
    const auth = yield* Auth;
    const now = DateTime.formatIso(yield* DateTime.now);
    const owner = yield* db.owners.insert({
      id: "caster",
      walletAddress: "0x0000000000000000000000000000000000000001",
      mode: "wallet",
    });
    const agent = Agent.make({
      id: "casting-desk",
      owner: owner.id,
      name: "Casting desk",
      emblem: { shape: "circle", modifier: "ring" },
      walletAddress: "0x0000000000000000000000000000000000000003",
      mandate: "Cast only from sourced theses",
      policy: {
        ...defaultPolicy,
        confirmedAt: now,
        allowedContracts: ["0x0000000000000000000000000000000000000004"],
        allowedMethods: ["launch"],
        allowedProtocols: ["floor-foundry"],
        launchAllowed: true,
        launchBudgetUsd: 100,
        approvalThresholdUsd: 10,
      },
      visibility: "private",
      publishMandate: false,
      paused: false,
      state: "asleep",
      budget: { dailyUsd: 1, spentUsd: 0, day: now.slice(0, 10) },
      districtId: "base-harbour",
      createdAt: now,
    });
    yield* db.agents.insert(agent);
    yield* db.notes.insert(researchNote({
      id: "casting-note",
      agentId: agent.id,
      marketId: "research-market",
      claim: "The observed market has a sourced use case",
      sources: [{
        id: "casting-source",
        kind: "chain",
        label: "Confirmed source",
        url: "https://sepolia.basescan.org/block/1",
        blockNumber: 1,
      }],
      position: { disclosure: "undisclosed" },
      status: "verified",
      visibility: "private",
      createdAt: now,
      blockNumber: 1,
      verification: "Checked on chain",
    }));
    yield* db.theses.insert({
      id: "casting-thesis",
      agentId: agent.id,
      marketId: "research-market",
      belief: "A small test launch can evaluate the sourced use case",
      invalidation: "Stop if evidence changes",
      noteIds: ["casting-note"],
      createdAt: now,
    });
    const client = yield* workspaceClient(Option.some(yield* auth.issue(owner)));
    const saved = yield* client.workspace.act({
      payload: {
        action: {
          tag: "launch-draft",
          agentId: agent.id,
          name: "Sourced Tide",
          symbol: "TIDE",
          thesis: "Test the sourced use case",
          allocationPercent: 10,
        },
      },
    });
    const draftId = yield* Effect.fromOption(Option.fromNullishOr(saved.id));
    const submitted = yield* client.workspace.act({
      payload: { action: { tag: "submit-launch", id: draftId, thesisId: "casting-thesis" } },
    });
    const receiptId = yield* Effect.fromOption(Option.fromNullishOr(submitted.id));
    const proposal = yield* db.proposals.findById(`launch:${draftId}`);
    assert.strictEqual(proposal.action, "launch");
    const launch = yield* Effect.fromOption(
      proposal.action === "launch" ? Option.some(proposal.launch) : Option.none(),
    );
    assert.strictEqual(launch.supply, "1000000");
    assert.strictEqual(launch.allocation, "100000");
    assert.strictEqual(launch.launchFeeWei, "1000000000000000");
    assert.match(launch.thesisHash, /^0x[0-9a-f]{64}$/);
    assert.match(launch.launchId, /^0x[0-9a-f]{64}$/);
    assert.deepStrictEqual(proposal.sourceIds, ["casting-source"]);
    assert.strictEqual(proposal.valueUsd, 20);
    const pending = (yield* db.receipts.findById(receiptId)).data;
    assert.strictEqual(pending.status, "awaiting-approval");
    assert.isTrue(Option.isNone(Option.fromNullishOr(pending.transactionHash)));
    assert.strictEqual((yield* db.launches.findById(draftId)).receiptId, receiptId);
    yield* client.workspace.act({
      payload: { action: { tag: "submit-launch", id: draftId, thesisId: "casting-thesis" } },
    });
    assert.strictEqual((yield* db.receipts.list()).length, 1);
    const altered = yield* Effect.exit(client.workspace.act({
      payload: { action: { tag: "propose", proposal: { ...proposal, valueUsd: 21 } } },
    }));
    assert.isTrue(Option.exists(Exit.findErrorOption(altered), error => error._tag === "ApiError"));
    assert.strictEqual((yield* db.proposals.findById(proposal.id)).valueUsd, 20);
    yield* client.workspace.act({ payload: { action: { tag: "pause-agent", id: agent.id, paused: true } } });
    assert.isTrue((yield* db.agents.findById(agent.id)).paused);
    yield* client.workspace.act({ payload: { action: { tag: "approve", id: receiptId, decision: "approve" } } });
    const refused = (yield* db.receipts.findById(receiptId)).data;
    assert.strictEqual(refused.status, "refused");
    assert.isTrue(refused.checks.some(check => check.rule === "Owner permission active" && !check.passed));
    assert.isTrue(Option.isNone(Option.fromNullishOr(refused.transactionHash)));
    yield* client.workspace.act({ payload: { action: { tag: "pause-agent", id: agent.id, paused: false } } });
    const resumed = yield* db.agents.findById(agent.id);
    assert.isFalse(resumed.paused);
    assert.strictEqual(resumed.state, "asleep");
    // oxlint-disable-next-line effecttsgo/strict-effect-provide -- This native HTTP test owns the full application scope and substitutes only independent account evidence.
  }).pipe(Effect.provide(configuredApplication)));

it.effect("workspace withdrawals fix the recipient to the authenticated owner and require approval while paused", () =>
  Effect.gen(function*() {
    const db = yield* FloorDatabase;
    const auth = yield* Auth;
    const now = DateTime.formatIso(yield* DateTime.now);
    const owner = yield* db.owners.insert({
      id: "withdrawal-owner",
      walletAddress: "0x0000000000000000000000000000000000000001",
      mode: "wallet",
    });
    const outsider = yield* db.owners.insert({
      id: "outsider",
      walletAddress: "0x0000000000000000000000000000000000000002",
      mode: "wallet",
    });
    const agent = withdrawalAgent(owner.id, now);
    yield* db.agents.insert(agent);
    const client = yield* workspaceClient(Option.some(yield* auth.issue(owner)));
    const amount = "0.123456789012345678";
    const response = yield* client.workspace.act({
      payload: { action: { tag: "withdraw", agentId: agent.id, amount } },
    });
    const receiptId = yield* Effect.fromOption(Option.fromNullishOr(response.id));
    const receipt = (yield* db.receipts.findById(receiptId)).data;
    const proposal = yield* db.proposals.findById(receipt.proposalId);
    assert.strictEqual(receipt.status, "awaiting-approval");
    assert.isTrue(Option.isNone(Option.fromNullishOr(receipt.transactionHash)));
    assert.strictEqual(proposal.action, "withdraw");
    assert.strictEqual(proposal.chainId, 84532);
    assert.strictEqual(proposal.contract, agent.walletAddress);
    assert.strictEqual(proposal.recipient, owner.walletAddress);
    assert.strictEqual(proposal.protocol, "owner-withdrawal");
    assert.strictEqual(proposal.method, "withdrawToOwner");
    assert.strictEqual(proposal.amount, amount);
    assert.strictEqual(proposal.symbol, "ETH");
    assert.strictEqual(proposal.valueUsd, 0);
    assert.deepStrictEqual(proposal.sourceIds, []);
    assert.isTrue(receipt.checks.every(check => check.passed));
    const unauthorized = yield* workspaceClient(Option.some(yield* auth.issue(outsider)));
    const refused = yield* Effect.exit(
      unauthorized.workspace.act({ payload: { action: { tag: "withdraw", agentId: agent.id, amount: "1" } } }),
    );
    assert.isTrue(
      Option.exists(
        Exit.findErrorOption(refused),
        error => error._tag === "ApiError" && error.message.includes("does not belong"),
      ),
    );
    for (const invalid of ["0", "0.000", "-1", "0.0000000000000000001"]) {
      const rejected = yield* Effect.exit(
        client.workspace.act({ payload: { action: { tag: "withdraw", agentId: agent.id, amount: invalid } } }),
      );
      assert.isTrue(Exit.isFailure(rejected));
    }
    assert.strictEqual((yield* db.receipts.list()).length, 1);
    // oxlint-disable-next-line effecttsgo/strict-effect-provide -- The native HTTP test owns its real authentication, database and proposal review scope.
  }).pipe(Effect.provide(configuredApplication)));

it.effect("workspace withdrawals reject an unlinked account without creating financial authority", () =>
  Effect.gen(function*() {
    const db = yield* FloorDatabase;
    const auth = yield* Auth;
    const owner = yield* db.owners.insert({
      id: "unlinked-owner",
      walletAddress: "0x0000000000000000000000000000000000000001",
      mode: "wallet",
    });
    const agent = withdrawalAgent(owner.id, DateTime.formatIso(yield* DateTime.now));
    yield* db.agents.insert(agent);
    const client = yield* workspaceClient(Option.some(yield* auth.issue(owner)));
    const unavailable = yield* Effect.exit(
      client.workspace.act({ payload: { action: { tag: "withdraw", agentId: agent.id, amount: "1" } } }),
    );
    assert.isTrue(
      Option.exists(
        Exit.findErrorOption(unavailable),
        error => error._tag === "ApiError" && error.message.includes("verify its scoped Base Sepolia account"),
      ),
    );
    assert.strictEqual((yield* db.receipts.list()).length, 0);
    assert.strictEqual((yield* db.proposals.listByAgent(agent.id)).length, 0);
    // oxlint-disable-next-line effecttsgo/strict-effect-provide -- This entry point proves fail-closed behavior with a real unconfigured account service and SQL store.
  }).pipe(Effect.provide(application)));
