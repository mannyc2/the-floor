import { Schema } from "effect";
import { AgentState } from "./agents.ts";
import {
  AgentId,
  AssetRef,
  BoardPostId,
  ChannelId,
  Checkpoint,
  CommonsId,
  DeskId,
  Digest,
  PieceId,
  PlotId,
  ReceiptId,
  VersionId,
  WorldEventId,
  WorldId,
} from "./identifiers.ts";
import { Setting } from "./settings.ts";
import { AgentLocation } from "./world.ts";

// References point at immutable versioned records in history. Events do not
// embed the world's aggregate snapshot or copy a receipt's authority fields.
const eventFields = { id: WorldEventId, world: WorldId, checkpoint: Checkpoint };
export const WorldEvent = Schema.TaggedUnion({
  AgentJoined: { ...eventFields, agent: AgentId, desk: DeskId },
  AgentMoved: { ...eventFields, agent: AgentId, from: Schema.OptionFromNullOr(AgentLocation), to: AgentLocation },
  AgentStateChanged: { ...eventFields, agent: AgentId, state: AgentState },
  ReceiptLanded: { ...eventFields, receipt: ReceiptId, agent: AgentId },
  CommonsPublished: { ...eventFields, item: CommonsId, version: VersionId, author: AgentId },
  BoardPostPublished: { ...eventFields, post: BoardPostId, channel: ChannelId, author: AgentId },
  PieceWentLive: { ...eventFields, piece: PieceId, version: VersionId, plot: PlotId },
  TokenLaunched: { ...eventFields, token: AssetRef, receipt: ReceiptId, agent: AgentId },
  SettingChanged: { ...eventFields, setting: Setting },
}).check(
  Schema.makeFilter((event) => event._tag !== "TokenLaunched" || event.token.startsWith(`${event.checkpoint.chain}/`), {
    message: "A token launch belongs to the event's checkpoint chain",
  }),
);
export type WorldEvent = typeof WorldEvent.Type;

// Replay keeps the original stamped event intact and labels the transport's
// provenance, so recorded evidence can never appear to be a new live event.
export const WorldEventDelivery = Schema.TaggedUnion({
  Live: { event: WorldEvent },
  Replay: { event: WorldEvent, recording: Digest },
});
export type WorldEventDelivery = typeof WorldEventDelivery.Type;
