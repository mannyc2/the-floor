import {
  Address,
  Agent,
  type Emblem,
  type FloorEvent,
  Note,
  type Proposal,
  publicAgent,
  publicReceipt,
  Thesis,
} from "@floor/contract";
import { allocationFromPercent, launchProposal } from "@floor/foundry";
import { GateReview } from "@floor/gate";
import { MarketHistory } from "@floor/markets";
import { eligibleEvidence } from "@floor/renderer/evidence";
import { createLayout, designFit } from "@floor/renderer/layout";
import { atlasMarket } from "@floor/renderer/market-view";
import { authorizeReceipt, Signing, updatePolicy } from "@floor/signing";
import {
  Action,
  type ActionResult,
  ApiError,
  AtlasRpc,
  CurrentOwner,
  FloorApi,
  LaunchDraft,
  type Owner,
  type ServiceStatus,
  type Workspace,
} from "@floor/surfaces";
import { Array, Context, Crypto, DateTime, Effect, Layer, Match, Option, Schema } from "effect";
import { Hex } from "effect/encoding";
import { HttpApiBuilder } from "effect/http-api";
import { RateLimiter } from "effect/persistence";
import { RpcSerialization, RpcServer } from "effect/rpc";
import { AccountContext } from "./account-context";
import { ServerAgentRunner } from "./agent-runner";
import { Atlas } from "./atlas";
import { Auth, AuthorizationLive } from "./auth";
import { Community } from "./community";
import { ServerConfig } from "./config";
import { PlateRenderer } from "./plate-renderer";
import { Proposals } from "./proposals";
import { FloorDatabase } from "./store";

// Null is confined to these HTTP DTO projections; domain absence uses Option.
const result = (message: string, id = Option.none<string>(), focusMarketId = Option.none<string>()): ActionResult => ({
  message,
  id: Option.getOrNull(id),
  focusMarketId: Option.getOrNull(focusMarketId),
});
const apiError = (error: { readonly _tag: string }): ApiError =>
  Schema.is(ApiError)(error)
    ? error
    : new ApiError({ message: "The request could not be completed. Please check its values and try again." });
type StoredAction = Exclude<
  Action,
  {
    readonly tag:
      | "run-agent"
      | "message-agent"
      | "pause-agent"
      | "ask"
      | "submit-design"
      | "submit-launch"
      | "propose"
      | "plate"
      | "propose-design-vote"
      | "vote-design"
      | "finalize-design-vote"
      | "withdraw";
  }
>;

const makeWorkspace = Effect.gen(function*() {
  const db = yield* FloorDatabase;
  const atlas = yield* Atlas;
  const runner = yield* ServerAgentRunner;
  const crypto = yield* Crypto.Crypto;
  const limiter = yield* RateLimiter.RateLimiter;
  const signing = yield* Signing;
  const gate = yield* GateReview;
  const history = yield* MarketHistory;
  const accounts = yield* AccountContext;
  const proposals = yield* Proposals;
  const community = yield* Community;
  const config = yield* ServerConfig;
  const plateRenderer = yield* PlateRenderer;
  const services = Effect.gen(function*() {
    const { market } = yield* atlas.snapshot(Option.none());
    return [
      { name: "Base market data", configured: market.status.mode === "live", detail: market.status.message },
      ...yield* runner.status,
      { name: "Transaction signing", ...accounts.status },
      { name: "Design review", ...gate.status },
      {
        name: "Foundry",
        configured: Option.isSome(config.foundry) && accounts.status.configured,
        detail: Option.isSome(config.foundry)
          ? "Base Sepolia foundry terms are configured. Casting requires your authorized scoped account and sourced thesis."
          : "Drafts are available. Casting requires the deployed Base Sepolia foundry address and exact curve terms.",
      },
    ] satisfies readonly ServiceStatus[];
  });
  const ownerAgent = Effect.fn("Workspace.ownerAgent")(function*(id: string, owner: Owner) {
    const agent = yield* db.agents.findById(id);
    if (agent.owner !== owner.id) {
      return yield* new ApiError({ message: "This agent does not belong to your workspace." });
    }
    return yield* Schema.decodeEffect(Agent)(agent);
  });
  const event = Effect.fn("Workspace.event")(
    function*(type: string, owner: Owner, entityId: string, payload: FloorEvent["payload"] = {}) {
      const { market } = yield* atlas.snapshot(Option.none());
      return yield* db.events.insert({
        id: yield* crypto.randomUUIDv4,
        type,
        blockNumber: Option.getOrNull(market.blockNumber > 0 ? Option.some(market.blockNumber) : Option.none()),
        createdAt: DateTime.formatIso(yield* DateTime.now),
        actor: owner.id,
        entityId,
        payload,
      });
    },
  );
  const get = Effect.fn("Workspace.get")(function*(owner: Owner) {
    const status = yield* services;
    return yield* db.sql.withTransaction(Effect.gen(function*() {
      const agents = yield* db.agents.list();
      const visible = new Set(
        agents.filter(agent => agent.owner === owner.id || agent.visibility === "public").map(agent => agent.id),
      );
      const owned = new Set(agents.filter(agent => agent.owner === owner.id).map(agent => agent.id));
      const publicNotes = yield* db.notes.listPublic();
      const publicTheses = yield* db.theses.listPublic();
      const publicBriefs = yield* db.briefs.listPublic();
      const workspace: Workspace = {
        owner,
        agents: agents.filter(agent => owned.has(agent.id)),
        publicAgents: agents.filter(agent => agent.owner !== owner.id && agent.visibility === "public").map(
          publicAgent,
        ),
        notes: [
          ...(yield* db.notes.list()).filter(note => owned.has(note.agentId)),
          ...publicNotes.filter(note => !owned.has(note.agentId)),
        ],
        theses: [
          ...(yield* db.theses.list()).filter(thesis => owned.has(thesis.agentId)),
          ...publicTheses.filter(thesis => !owned.has(thesis.agentId)),
        ],
        threads: (yield* db.threads.list()).filter(thread => owned.has(thread.agentId)),
        briefs: [
          ...(yield* db.briefs.list()).filter(brief => owned.has(brief.agentId)),
          ...publicBriefs.filter(brief => !owned.has(brief.agentId)),
        ],
        receipts: (yield* db.receipts.list()).map(row => row.data).filter(receipt => visible.has(receipt.agentId)).map(
          publicReceipt,
        ),
        proposals: (yield* Effect.forEach([...owned], id => db.proposals.listByAgent(id))).flat(),
        moorings: (yield* db.moorings.list(owner.id)).map(row => row.marketId),
        alerts: (yield* db.alerts.list()).filter(line => line.owner === owner.id),
        plates: yield* db.plates.list(),
        designs: (yield* db.designs.list()).filter(design => design.owner === owner.id || design.status === "accepted"),
        designElections: yield* community.list,
        launches: (yield* db.launches.list()).filter(launch => launch.owner === owner.id),
        activity: (yield* db.activity.list()).filter(activity => owned.has(activity.agentId)),
        events: yield* db.events.listForOwner(owner.id),
        services: status,
      };
      return workspace;
    }));
  });
  const mutate = Effect.fn("Workspace.mutate")(function*(owner: Owner, pending: StoredAction) {
    const { market } = yield* atlas.snapshot(Option.none());
    const now = DateTime.formatIso(yield* DateTime.now);
    return yield* Match.value(pending).pipe(
      Match.discriminatorsExhaustive("tag")({
        "moor": Effect.fn("Workspace.moor")(function*(action) {
          if (!market.markets.some(item => item.id === action.marketId)) {
            return yield* new ApiError({ message: "Choose a market on this map." });
          }
          const removing = (yield* db.moorings.list(owner.id)).some(row => row.marketId === action.marketId);
          if (removing) yield* db.sql`DELETE FROM moorings WHERE owner = ${owner.id} AND marketId = ${action.marketId}`;
          else yield* db.sql`INSERT INTO moorings(owner, marketId) VALUES (${owner.id}, ${action.marketId})`;
          yield* event(removing ? "unmoored" : "moored", owner, action.marketId);
          return result(removing ? "Mooring released." : "Moored in your harbour.");
        }),
        "alert": Effect.fn("Workspace.alert")(function*(action) {
          if (!market.markets.some(item => item.id === action.marketId)) {
            return yield* new ApiError({ message: "Choose an indexed market for your line." });
          }
          const line = yield* db.alerts.insert({
            id: yield* crypto.randomUUIDv4,
            owner: owner.id,
            marketId: action.marketId,
            price: action.price,
            crossed: false,
            direction: action.direction,
            createdAt: now,
          });
          yield* event("line-scribed", owner, line.id, { marketId: line.marketId, price: line.price });
          return result("Your line is scribed. The flag will rise when the price crosses it.", Option.some(line.id));
        }),
        "delete-alert": Effect.fn("Workspace.delete-alert")(function*(action) {
          yield* db.sql`DELETE FROM alerts WHERE id = ${action.id} AND owner = ${owner.id}`;
          return result("Scribed line removed.");
        }),
        "create-agent": Effect.fn("Workspace.create-agent")(function*(action) {
          if (action.name.length > 60 || action.mandate.length > 12000) {
            return yield* new ApiError({ message: "Use a name under 60 characters and a mandate under 12,000." });
          }
          const emblems = (yield* db.agents.list()).filter(agent => agent.districtId === "base-harbour").map(agent =>
            agent.emblem
          );
          const modifiers: readonly Emblem["modifier"][] = [
            action.emblem.modifier,
            // oxlint-disable-next-line effect/noNullish -- A plain emblem is a nullable modifier in the public contract.
            null,
            "dot",
            "bar",
            "ring",
          ];
          const available = Option.fromUndefinedOr(
            modifiers.find(modifier =>
              !emblems.some(emblem => emblem.shape === action.emblem.shape && emblem.modifier === modifier)
            ),
          );
          if (Option.isNone(available)) {
            return yield* new ApiError({
              message: "All variants of that emblem are in use in this district. Choose another shape.",
            });
          }
          const agent: Agent = {
            id: yield* crypto.randomUUIDv4,
            owner: owner.id,
            name: action.name,
            emblem: { shape: action.emblem.shape, modifier: available.value },
            // oxlint-disable-next-line effect/noNullish -- The Agent wire schema represents an unconnected account with null.
            walletAddress: null,
            mandate: action.mandate,
            policy: { ...action.policy, confirmedAt: now, version: 1 },
            visibility: action.visibility,
            publishMandate: false,
            state: "asleep",
            paused: false,
            budget: { dailyUsd: action.dailyBudget, spentUsd: 0, day: now.slice(0, 10) },
            districtId: "base-harbour",
            createdAt: now,
          };
          yield* db.agents.insert(agent);
          yield* event("agent-created", owner, agent.id);
          return result(
            `${agent.name}'s desk is ready. Its limits are saved; research starts when you run it.`,
            Option.some(agent.id),
          );
        }),
        "update-agent": Effect.fn("Workspace.update-agent")(function*(action) {
          const agent = yield* ownerAgent(action.id, owner);
          const policy = yield* Effect.fromResult(
            updatePolicy(agent.policy, action.policy, owner.id, agent.owner, now),
          );
          yield* db.agents.update({
            ...agent,
            name: action.name,
            mandate: action.mandate,
            visibility: action.visibility,
            publishMandate: action.publishMandate,
            policy,
            budget: { ...agent.budget, dailyUsd: action.dailyBudget },
          });
          yield* event("policy-confirmed", owner, agent.id, { version: policy.version });
          return result("Mandate and confirmed limits saved.", Option.some(agent.id));
        }),
        "approve": Effect.fn("Workspace.approve")(function*(action) {
          const { data: receipt } = yield* db.receipts.findById(action.id);
          const updated = yield* Effect.fromResult(authorizeReceipt(receipt, owner.id, action.decision, now));
          yield* db.receipts.update({ id: updated.id, data: updated });
          yield* event("approval-answered", owner, updated.id, { decision: action.decision });
          return result(updated.reason, Option.some(updated.id));
        }),
        "launch-draft": Effect.fn("Workspace.launch-draft")(function*(action) {
          yield* ownerAgent(action.agentId, owner);
          if (!/^[A-Za-z][A-Za-z0-9]{1,9}$/.test(action.symbol)) {
            return yield* new ApiError({ message: "Use a symbol of 2–10 letters or digits." });
          }
          const launch = yield* db.launches.insert({
            id: yield* crypto.randomUUIDv4,
            owner: owner.id,
            agentId: action.agentId,
            name: action.name.slice(0, 60),
            symbol: action.symbol.toUpperCase(),
            thesis: action.thesis,
            allocationPercent: action.allocationPercent,
            createdAt: now,
            status: "draft",
            // oxlint-disable-next-line effect/noNullish -- A draft has no signing receipt in the transport contract.
            receiptId: null,
          });
          yield* event("launch-drafted", owner, launch.id);
          return result(
            "Launch draft saved. Select a sourced thesis to submit it for policy review.",
            Option.some(launch.id),
          );
        }),
      }),
    );
  });
  const act = Effect.fn("Workspace.act")(function*(owner: Owner, action: Action) {
    yield* limiter.consume({
      key: owner.id,
      limit: 60,
      window: "1 minute",
      algorithm: "fixed-window",
      onExceeded: "fail",
    });
    const observed = yield* atlas.snapshot(Option.none());
    const { market } = observed;
    return yield* Match.value(action).pipe(
      Match.when(
        { tag: "propose-design-vote" },
        Effect.fn("Workspace.proposeDesignVote")(
          function*(request: Extract<Action, { readonly tag: "propose-design-vote" }>) {
            const election = yield* community.propose(owner, request.designId, request.marketId, observed);
            return result(
              "The 72-hour holder vote is open. Its weights are fixed at the source block.",
              Option.some(election.id),
            );
          },
        ),
      ),
      Match.when(
        { tag: "vote-design" },
        Effect.fn("Workspace.voteDesign")(function*(request: Extract<Action, { readonly tag: "vote-design" }>) {
          const election = yield* community.vote(owner, request.id, request.support);
          return result("Your verified holder vote has been recorded.", Option.some(election.id));
        }),
      ),
      Match.when(
        { tag: "finalize-design-vote" },
        Effect.fn("Workspace.finalizeDesignVote")(
          function*(request: Extract<Action, { readonly tag: "finalize-design-vote" }>) {
            const election = yield* community.finalize(owner, request.id);
            yield* atlas.refresh;
            return result(
              election.status === "adopted"
                ? "Holders adopted the design. The atlas will draw its protected readings."
                : "The holder vote did not adopt this design.",
              Option.some(election.id),
            );
          },
        ),
      ),
      Match.when({ tag: "ask" }, (request) => {
        const risk = /thin|risk/i.test(request.question);
        const ranked = market.markets.toSorted((left, right) =>
          risk
            ? (left.liquidityUsd ?? Infinity) - (right.liquidityUsd ?? Infinity)
            : (right.valueMovingUsd ?? 0) - (left.valueMovingUsd ?? 0)
        );
        return Effect.succeed(Option.match(Array.head(ranked), {
          onNone: () => result("No chain readings are available yet."),
          onSome: target =>
            result(
              `${target.symbol}: ${risk ? "indexed liquidity" : "sampled value moving"} ${
                Option.match(Option.fromNullishOr(risk ? target.liquidityUsd : target.valueMovingUsd), {
                  onNone: () => "unavailable",
                  onSome: value => `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`,
                })
              }. These are ${market.source} readings at block ${market.blockNumber.toLocaleString()}, across ${market.markets.length} indexed pools.`,
              Option.none(),
              Option.some(target.id),
            ),
        }));
      }),
      Match.when(
        { tag: Match.is("run-agent", "message-agent") },
        Effect.fn("Workspace.runResearch")(
          function*(request: Extract<Action, { readonly tag: "run-agent" | "message-agent" }>) {
            const agent = yield* db.sql.withTransaction(Effect.gen(function*() {
              const current = yield* ownerAgent(request.id, owner);
              const resumed: Agent = { ...current, paused: false };
              yield* db.agents.update(resumed);
              if (current.paused) yield* event("agent-resumed", owner, current.id);
              return resumed;
            }));
            return result(
              yield* runner.run(
                agent,
                market,
                request.tag === "message-agent" ? Option.some(request.message) : Option.none(),
              ),
              Option.some(agent.id),
            );
          },
        ),
      ),
      Match.when(
        { tag: "pause-agent" },
        Effect.fn("Workspace.pauseResearch")(function*(request: Extract<Action, { readonly tag: "pause-agent" }>) {
          const agent = yield* db.sql.withTransaction(Effect.gen(function*() {
            const current = yield* ownerAgent(request.id, owner);
            yield* db.agents.update({
              ...current,
              state: request.paused ? "asleep" : current.state,
              paused: request.paused,
            });
            yield* event(request.paused ? "agent-paused" : "agent-resumed", owner, current.id);
            return current;
          }));
          if (request.paused) yield* runner.pause(agent.id);
          return result(`${agent.name} is ${request.paused ? "paused" : "ready"}.`, Option.some(agent.id));
        }),
      ),
      Match.when(
        { tag: "plate" },
        Effect.fn("Workspace.plate")(function*(request: Extract<Action, { readonly tag: "plate" }>) {
          const captured = yield* atlas.snapshot(Option.some(request.blockNumber));
          if (
            captured.market.blockNumber !== request.blockNumber
            || !captured.market.markets.some(item => item.id === request.marketId)
          ) return yield* new ApiError({ message: "The plate must reference a retained source block and its market." });
          const evidence = eligibleEvidence({
            agents: (yield* db.agents.list()).filter(agent => agent.visibility === "public").map(publicAgent),
            notes: yield* db.notes.listPublic(),
            receipts: (yield* db.receipts.list()).map(row => publicReceipt(row.data)),
            chainId: captured.market.chainId,
            blockNumber: captured.market.blockNumber,
            observedAt: captured.market.blockTimestamp,
          });
          const title = request.title.slice(0, 180);
          // Rendering never holds a SQL transaction open. The final commit pins exactly the retained source used by Chromium.
          const image = yield* plateRenderer.render({
            snapshot: captured,
            evidence,
            marketId: request.marketId,
            title,
            view: request.view,
          });
          return yield* db.sql.withTransaction(Effect.gen(function*() {
            yield* history.pin(captured.market.blockNumber);
            const plate = yield* db.plates.insert({
              title,
              createdAt: DateTime.formatIso(yield* DateTime.now),
              blockNumber: captured.market.blockNumber,
              marketId: request.marketId,
              receiptIds: evidence.receipts.filter(receipt =>
                receipt.marketId === request.marketId && receipt.status === "confirmed"
              ).map(receipt => receipt.id),
              view: request.view,
              image,
            });
            yield* event("plate-captured", owner, String(plate.number));
            return result(`Plate ${plate.number} is now part of the record.`, Option.some(String(plate.number)));
          }));
        }),
      ),
      Match.when(
        { tag: "withdraw" },
        Effect.fn("Workspace.withdraw")(function*(request: Extract<Action, { readonly tag: "withdraw" }>) {
          const agent = yield* ownerAgent(request.agentId, owner);
          const linked = yield* accounts.load(agent, owner, Option.none());
          const boundOwner = Option.fromNullishOr(owner.walletAddress);
          if (
            owner.mode !== "wallet" || Option.isNone(boundOwner) || Option.isNone(linked.ownerAddress)
            || Option.isNone(linked.walletAddress)
          ) {
            return yield* new ApiError({
              message:
                "Connect your owner wallet and verify its scoped Base Sepolia account before requesting a withdrawal.",
            });
          }
          const contract = yield* Schema.decodeUnknownEffect(Address)(linked.walletAddress.value);
          const recipient = yield* Schema.decodeUnknownEffect(Address)(boundOwner.value);
          const proposal = {
            id: `withdraw:${yield* crypto.randomUUIDv4}`,
            agentId: agent.id,
            owner: owner.id,
            action: "withdraw",
            chainId: 84532,
            protocol: "owner-withdrawal",
            contract,
            method: "withdrawToOwner",
            recipient,
            marketId: "",
            amount: request.amount,
            symbol: "ETH",
            // An owner transfer has no market valuation; zero is the legacy numeric DTO sentinel, not a free trade quote.
            valueUsd: 0,
            slippageBps: 0,
            thesisId: "",
            sourceIds: [],
            createdAt: DateTime.formatIso(yield* DateTime.now),
          } satisfies Proposal;
          const receipt = yield* proposals.submit(owner, proposal);
          return result(
            receipt.status === "awaiting-approval"
              ? "Withdrawal is ready for your explicit approval. ETH can only return to your connected owner wallet."
              : receipt.reason,
            Option.some(receipt.id),
          );
        }),
      ),
      Match.when(
        { tag: "propose" },
        Effect.fn("Workspace.propose")(function*(request: Extract<Action, { readonly tag: "propose" }>) {
          const receipt = yield* proposals.submit(owner, request.proposal);
          return result(receipt.reason, Option.some(receipt.id));
        }),
      ),
      Match.when(
        { tag: "submit-launch" },
        Effect.fn("Workspace.submitLaunch")(function*(request: Extract<Action, { readonly tag: "submit-launch" }>) {
          const draft = yield* Schema.decodeEffect(LaunchDraft)(yield* db.launches.findById(request.id));
          if (draft.owner !== owner.id) {
            return yield* new ApiError({ message: "This launch draft belongs to another workspace." });
          }
          const agent = yield* ownerAgent(draft.agentId, owner);
          const proposalId = `launch:${draft.id}`;
          const existing = yield* db.receipts.findByProposal(proposalId);
          if (Option.isSome(existing)) {
            const receipt = existing.value.data.status === "pending-review"
              ? yield* proposals.submit(owner, yield* db.proposals.findById(proposalId))
              : existing.value.data;
            yield* db.launches.update({ ...draft, receiptId: existing.value.id, status: "submitted" });
            return result(receipt.reason, Option.some(receipt.id));
          }
          if (Option.isNone(config.foundry)) {
            return yield* new ApiError({
              message: "Configure the deployed Base Sepolia foundry and its exact curve terms before casting.",
            });
          }
          const thesis = yield* db.theses.findById(request.thesisId);
          if (thesis.agentId !== agent.id || thesis.noteIds.length === 0) {
            return yield* new ApiError({ message: "Choose this agent's thesis with verified source notes." });
          }
          const notes = yield* Effect.forEach([...new Set(thesis.noteIds)], id => db.notes.findById(id));
          if (
            notes.some(note =>
              note.agentId !== agent.id || note.sources.length === 0
              || (note.status !== "verified" && note.status !== "sourced")
            )
          ) {
            return yield* new ApiError({
              message: "Every thesis note must belong to this agent and contain verified or sourced evidence.",
            });
          }
          const linked = yield* accounts.load(agent, owner, Option.none());
          if (Option.isNone(linked.walletAddress)) {
            return yield* new ApiError({
              message: "Authorize a scoped Base Sepolia account for this owner, desk and policy before casting.",
            });
          }
          const encoded = yield* Schema.encodeEffect(
            Schema.fromJsonString(
              Schema.Struct({ launchThesis: Schema.String, thesis: Thesis, notes: Schema.Array(Note) }),
            ),
          )({ launchThesis: draft.thesis, thesis, notes });
          const launchId: `0x${string}` = `0x${
            Hex.encode(yield* crypto.digest("SHA-256", new TextEncoder().encode(`floor-launch:${draft.id}`)))
          }`;
          const thesisHash: `0x${string}` = `0x${
            Hex.encode(yield* crypto.digest("SHA-256", new TextEncoder().encode(encoded)))
          }`;
          const declaration = {
            ...config.foundry.value,
            id: proposalId,
            agentId: agent.id,
            owner: owner.id,
            launchId,
            name: draft.name,
            symbol: draft.symbol,
            allocation: yield* Effect.fromResult(
              allocationFromPercent(config.foundry.value.supply, draft.allocationPercent),
            ),
            thesisHash,
            thesisId: thesis.id,
            sourceIds: [...new Set(notes.flatMap(note => note.sources.map(source => source.id)))],
            chainId: 84532,
          };
          const now = DateTime.formatIso(yield* DateTime.now);
          const preliminary = yield* Effect.fromResult(
            launchProposal({ ...declaration, budgetUsd: 0 }, agent.policy, linked.walletAddress.value, now),
          );
          const quote = yield* accounts.load(agent, owner, Option.some(preliminary));
          if (Option.isNone(quote.quotedValueUsd)) {
            return yield* new ApiError({
              message: "An independent, current launch valuation is required before policy review.",
            });
          }
          const proposal = yield* Effect.fromResult(
            launchProposal(
              { ...declaration, budgetUsd: quote.quotedValueUsd.value },
              agent.policy,
              linked.walletAddress.value,
              now,
            ),
          );
          const receipt = yield* proposals.submit(owner, proposal);
          yield* db.sql.withTransaction(Effect.gen(function*() {
            yield* db.launches.update({ ...draft, receiptId: receipt.id, status: "submitted" });
            yield* event("launch-submitted", owner, draft.id, { receiptId: receipt.id });
          }));
          return result(receipt.reason, Option.some(receipt.id));
        }),
      ),
      Match.when(
        { tag: "submit-design" },
        Effect.fn("Workspace.submitDesign")(function*(request: Extract<Action, { readonly tag: "submit-design" }>) {
          const indexed = Option.fromUndefinedOr(market.markets.find(item =>
            item.id === request.design.tokenId
            || item.token.address.toLowerCase() === request.design.tokenId.toLowerCase()
          ));
          const layout = createLayout(market.markets.map(atlasMarket), {
            lens: "flow",
            moorings: new Set(),
            explodedId: Option.none(),
            activeMarketId: Option.none(),
            slots: observed.slots,
            tiers: observed.tiers,
          });
          const fit = Option.flatMap(indexed, target => designFit(request.design, target.id, layout.markets));
          const checked = yield* gate.review(request.design, fit);
          const id = yield* crypto.randomUUIDv4;
          yield* db.sql.withTransaction(Effect.gen(function*() {
            yield* db.designs.insert({
              id,
              owner: owner.id,
              design: request.design,
              status: checked.status,
              checks: checked.checks,
              createdAt: DateTime.formatIso(yield* DateTime.now),
            });
            yield* event("design-submitted", owner, id);
          }));
          return result(
            checked.status === "rejected"
              ? "The gate returned this design with named checks."
              : checked.status === "accepted"
              ? "The design passed the gate."
              : "Structural checks finished. Visual review remains pending.",
            Option.some(id),
          );
        }),
      ),
      Match.orElse(
        Effect.fn("Workspace.commitAction")(function*(request: StoredAction) {
          const response = yield* db.sql.withTransaction(mutate(owner, request));
          if (request.tag === "approve") {
            const id = Option.fromNullishOr(response.id);
            if (Option.isSome(id)) {
              const dispatched = yield* signing.dispatchApproved(id.value);
              return result(dispatched.reason, id);
            }
          }
          return response;
        }),
      ),
    );
  });
  return { get, act, services };
});

/** @stability unstable */
export class Workspaces
  extends Context.Service<Workspaces, Effect.Success<typeof makeWorkspace>>()("floor/Workspaces")
{
  static readonly layer = Layer.effect(Workspaces, makeWorkspace);
}

const PublicHandlers = HttpApiBuilder.group(
  FloorApi,
  "atlas",
  Effect.fn("Http.buildAtlas")(function*(handlers) {
    const atlas = yield* Atlas;
    return handlers.handleAll({
      snapshot: Effect.fn("Http.atlas")(function*({ query }) {
        const requested = Option.fromUndefinedOr(query.block);
        const block = Option.isSome(requested)
          ? Option.some(yield* Schema.decodeEffect(Schema.Int)(Number(requested.value)))
          : Option.none<number>();
        return yield* atlas.snapshot(block);
      }, Effect.mapError(apiError)),
      health: () => Effect.succeed({ ok: true, version: "1.0.0" }),
    });
  }),
);
const OwnerHandlers = HttpApiBuilder.group(
  FloorApi,
  "workspace",
  Effect.fn("Http.buildWorkspace")(function*(handlers) {
    const workspaces = yield* Workspaces;
    return handlers.handleAll({
      get: Effect.fn("Http.workspace")(function*() {
        return yield* workspaces.get(yield* CurrentOwner);
      }, Effect.mapError(apiError)),
      act: Effect.fn("Http.action")(function*({ payload }) {
        return yield* workspaces.act(yield* CurrentOwner, payload.action);
      }, Effect.mapError(apiError)),
    });
  }),
).pipe(Layer.provideMerge(AuthorizationLive));
const SessionHandlers = HttpApiBuilder.group(
  FloorApi,
  "session",
  Effect.fn("Http.buildSession")(function*(handlers) {
    const auth = yield* Auth;
    return handlers.handleAll({
      start: () => auth.start.pipe(Effect.mapError(apiError)),
      challenge: Effect.fn("Http.challenge")(function*() {
        return yield* auth.challenge(yield* auth.resolveRequest);
      }, Effect.mapError(apiError)),
      verify: Effect.fn("Http.verify")(function*({ payload }) {
        return yield* auth.cookie(yield* auth.verify(payload, yield* auth.resolveRequest));
      }, Effect.mapError(apiError)),
    });
  }),
);
/** @stability unstable */
export const ApiHandlers = Layer.mergeAll(PublicHandlers, OwnerHandlers, SessionHandlers);
/** @stability unstable */
export const ApiRoutes = HttpApiBuilder.layer(FloorApi, { openapiPath: "/api/openapi.json" }).pipe(
  Layer.provide(ApiHandlers),
);
const AtlasHandlers = AtlasRpc.toLayer(Effect.gen(function*() {
  const atlas = yield* Atlas;
  return { watch: () => atlas.changes };
}));
/** @stability unstable */
export const AtlasRoutes = RpcServer.layerHttp({
  group: AtlasRpc,
  path: "/stream",
  protocol: "websocket",
  concurrency: 128,
  streamBufferSize: 4,
}).pipe(Layer.provide([AtlasHandlers, RpcSerialization.layerNdjson]));
