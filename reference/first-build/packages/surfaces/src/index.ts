import {
  AdoptedDesign,
  Agent,
  Brief,
  Design,
  DesignElection,
  Emblem,
  FloorEvent,
  Note,
  Plate,
  Policy,
  Proposal,
  PublicAgent,
  PublicReceipt,
  ScribedLine,
  Thesis,
  Thread,
  TokenAmount,
} from "@floor/contract";
import { MarketSlot, MarketTier } from "@floor/districts";
import { MarketSnapshot } from "@floor/markets/schema";
import { Context, Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiMiddleware } from "effect/http-api";
import { Rpc, RpcGroup } from "effect/rpc";

export const Owner = Schema.Struct({
  id: Schema.String,
  walletAddress: Schema.NullOr(Schema.String),
  mode: Schema.Literals(["local", "wallet"]),
});
export type Owner = typeof Owner.Type;
export const ServiceStatus = Schema.Struct({ name: Schema.String, configured: Schema.Boolean, detail: Schema.String });
export type ServiceStatus = typeof ServiceStatus.Type;
export const GateCheck = Schema.Struct({
  name: Schema.String,
  status: Schema.Literals(["pass", "fail", "review", "unavailable"]),
  detail: Schema.String,
});
export const DesignSubmission = Schema.Struct({
  id: Schema.String,
  owner: Schema.String,
  design: Design,
  status: Schema.Literals(["accepted", "rejected", "review", "pending"]),
  checks: Schema.Array(GateCheck),
  createdAt: Schema.String,
});
export type DesignSubmission = typeof DesignSubmission.Type;
export const LaunchDraft = Schema.Struct({
  id: Schema.String,
  owner: Schema.String,
  agentId: Schema.String,
  name: Schema.String,
  symbol: Schema.String,
  thesis: Schema.String,
  allocationPercent: Schema.Finite,
  createdAt: Schema.String,
  status: Schema.Literals(["draft", "submitted", "graduated"]),
  receiptId: Schema.NullOr(Schema.String),
});
export type LaunchDraft = typeof LaunchDraft.Type;
export const AgentActivity = Schema.Struct({
  agentId: Schema.String,
  state: Schema.String,
  message: Schema.String,
  browserUrl: Schema.NullOr(Schema.String),
  liveViewUrl: Schema.NullOr(Schema.String),
  untrusted: Schema.Boolean,
  updatedAt: Schema.String,
});
export type AgentActivity = typeof AgentActivity.Type;
export const Workspace = Schema.Struct({
  owner: Owner,
  agents: Schema.Array(Agent),
  publicAgents: Schema.Array(PublicAgent),
  notes: Schema.Array(Note),
  theses: Schema.Array(Thesis),
  threads: Schema.Array(Thread),
  briefs: Schema.Array(Brief),
  receipts: Schema.Array(PublicReceipt),
  proposals: Schema.Array(Proposal),
  moorings: Schema.Array(Schema.String),
  alerts: Schema.Array(ScribedLine),
  plates: Schema.Array(Plate),
  designs: Schema.Array(DesignSubmission),
  designElections: Schema.Array(DesignElection),
  launches: Schema.Array(LaunchDraft),
  activity: Schema.Array(AgentActivity),
  events: Schema.Array(FloorEvent),
  services: Schema.Array(ServiceStatus),
});
export type Workspace = typeof Workspace.Type;
export const AtlasSnapshot = Schema.Struct({
  market: MarketSnapshot,
  slots: Schema.Array(MarketSlot),
  adoptedDesigns: Schema.Array(AdoptedDesign),
  tiers: Schema.Array(MarketTier),
  activeMarketId: Schema.NullOr(Schema.String),
  historyBlocks: Schema.Array(Schema.Struct({ blockNumber: Schema.Int, timestamp: Schema.String })),
  replay: Schema.Boolean,
});
export type AtlasSnapshot = typeof AtlasSnapshot.Type;
export const Action = Schema.Union([
  Schema.Struct({
    tag: Schema.Literal("propose-design-vote"),
    designId: Schema.NonEmptyString,
    marketId: Schema.NonEmptyString,
  }),
  Schema.Struct({ tag: Schema.Literal("vote-design"), id: Schema.NonEmptyString, support: Schema.Boolean }),
  Schema.Struct({ tag: Schema.Literal("finalize-design-vote"), id: Schema.NonEmptyString }),
  Schema.Struct({ tag: Schema.Literal("moor"), marketId: Schema.String }),
  Schema.Struct({
    tag: Schema.Literal("alert"),
    marketId: Schema.String,
    price: Schema.Finite.check(Schema.isGreaterThan(0)),
    direction: Schema.Literals(["above", "below"]),
  }),
  Schema.Struct({ tag: Schema.Literal("delete-alert"), id: Schema.String }),
  Schema.Struct({
    tag: Schema.Literal("create-agent"),
    name: Schema.NonEmptyString,
    mandate: Schema.NonEmptyString,
    policy: Policy,
    visibility: Schema.Literals(["public", "private"]),
    emblem: Emblem,
    dailyBudget: Schema.Finite.check(Schema.isGreaterThan(0)),
  }),
  Schema.Struct({
    tag: Schema.Literal("update-agent"),
    id: Schema.String,
    name: Schema.NonEmptyString,
    mandate: Schema.String,
    policy: Policy,
    visibility: Schema.Literals(["public", "private"]),
    publishMandate: Schema.Boolean,
    dailyBudget: Schema.Finite.check(Schema.isGreaterThan(0)),
  }),
  Schema.Struct({ tag: Schema.Literal("pause-agent"), id: Schema.String, paused: Schema.Boolean }),
  Schema.Struct({ tag: Schema.Literal("run-agent"), id: Schema.String }),
  Schema.Struct({ tag: Schema.Literal("message-agent"), id: Schema.String, message: Schema.NonEmptyString }),
  Schema.Struct({
    tag: Schema.Literal("approve"),
    id: Schema.String,
    decision: Schema.Literals(["approve", "decline"]),
  }),
  Schema.Struct({ tag: Schema.Literal("submit-design"), design: Design }),
  Schema.Struct({
    tag: Schema.Literal("plate"),
    blockNumber: Schema.Int,
    title: Schema.NonEmptyString,
    marketId: Schema.String,
    view: Schema.Literals(["archipelago", "island", "district", "works", "machine"]),
  }),
  Schema.Struct({ tag: Schema.Literal("ask"), question: Schema.NonEmptyString }),
  Schema.Struct({
    tag: Schema.Literal("launch-draft"),
    agentId: Schema.String,
    name: Schema.NonEmptyString,
    symbol: Schema.NonEmptyString,
    thesis: Schema.NonEmptyString,
    allocationPercent: Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 100 })),
  }),
  Schema.Struct({ tag: Schema.Literal("propose"), proposal: Proposal }),
  Schema.Struct({
    tag: Schema.Literal("withdraw"),
    agentId: Schema.NonEmptyString,
    amount: TokenAmount.check(Schema.isPattern(/[1-9]/)),
  }),
  Schema.Struct({ tag: Schema.Literal("submit-launch"), id: Schema.String, thesisId: Schema.NonEmptyString }),
]);
export type Action = typeof Action.Type;
export const ActionResult = Schema.Struct({
  message: Schema.String,
  id: Schema.NullOr(Schema.String),
  focusMarketId: Schema.NullOr(Schema.String),
});
export type ActionResult = typeof ActionResult.Type;
export class ApiError
  extends Schema.TaggedError<ApiError>()("ApiError", { message: Schema.String }, { httpApiStatus: 400 })
{}
export class Unauthorized
  extends Schema.TaggedError<Unauthorized>()("Unauthorized", { message: Schema.String }, { httpApiStatus: 401 })
{}
export class CurrentOwner extends Context.Service<CurrentOwner, Owner>()("@floor/surfaces/CurrentOwner") {}
/** @stability unstable */
export class OwnerAuthorization extends HttpApiMiddleware.Service<OwnerAuthorization, { provides: CurrentOwner }>()(
  "@floor/surfaces/OwnerAuthorization",
  { error: Unauthorized },
) {}
/** @stability unstable */
export const PublicApi = HttpApiGroup.make("atlas").add(
  HttpApiEndpoint.get("snapshot", "/atlas", {
    query: { block: Schema.optional(Schema.String) },
    success: AtlasSnapshot,
    error: ApiError,
  }),
  HttpApiEndpoint.get("health", "/health", { success: Schema.Struct({ ok: Schema.Boolean, version: Schema.String }) }),
);
/** @stability unstable */
export const OwnerApi = HttpApiGroup.make("workspace").add(
  HttpApiEndpoint.get("get", "/workspace", { success: Workspace, error: ApiError }),
  HttpApiEndpoint.post("act", "/action", {
    payload: Schema.Struct({ action: Action }),
    success: ActionResult,
    error: ApiError,
  }),
).middleware(OwnerAuthorization);
export const WalletChallenge = Schema.Struct({ nonce: Schema.String, message: Schema.String });
export const WalletProof = Schema.Struct({
  address: Schema.TemplateLiteral(["0x", Schema.String]).check(Schema.isPattern(/^0x[0-9a-fA-F]{40}$/)),
  signature: Schema.TemplateLiteral(["0x", Schema.String]).check(Schema.isPattern(/^0x[0-9a-fA-F]+$/)),
  nonce: Schema.String,
});
export const SessionInfo = Owner;
/** @stability unstable */
export const SessionApi = HttpApiGroup.make("session").add(
  HttpApiEndpoint.post("start", "/session", { success: SessionInfo, error: ApiError }),
  HttpApiEndpoint.post("challenge", "/auth/challenge", { success: WalletChallenge, error: ApiError }),
  HttpApiEndpoint.post("verify", "/auth/verify", { payload: WalletProof, success: SessionInfo, error: ApiError }),
);
/** @stability unstable */
export class FloorApi extends HttpApi.make("floor").add(PublicApi, OwnerApi, SessionApi).prefix("/api") {}
/** A streaming call lets RPC own backpressure, cancellation and wire validation. */
/** @stability unstable */
export class AtlasRpc extends RpcGroup.make(Rpc.make("watch", { success: AtlasSnapshot, stream: true })) {}
