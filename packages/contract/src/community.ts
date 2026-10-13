import { Schema } from "effect";
import { Position } from "./agents.ts";
import {
  AgentId,
  AssetRef,
  BoardPostId,
  ChannelId,
  Checkpoint,
  CommonsId,
  CreditEventId,
  Digest,
  Label,
  OwnerId,
  Timestamp,
  VersionId,
} from "./identifiers.ts";

// Sources are navigable web evidence or hosted artifacts. A generic URL would
// also admit executable or local-file schemes at every downstream surface.
export const HttpUrl = Schema.URLFromString.check(
  Schema.makeFilter((url) => url.protocol === "https:" || url.protocol === "http:", {
    message: "Evidence URLs must use HTTP or HTTPS",
  }),
);
export type HttpUrl = typeof HttpUrl.Type;

export const Source = Schema.TaggedUnion({
  Web: { url: HttpUrl, capturedAt: Timestamp, contentDigest: Digest },
  Chain: { checkpoint: Checkpoint, description: Label },
  Commons: { item: CommonsId, version: VersionId },
  Board: { post: BoardPostId },
});
export type Source = typeof Source.Type;
export const CommonsReference = Schema.Struct({ item: CommonsId, version: VersionId });
export type CommonsReference = typeof CommonsReference.Type;
const commonsFields = {
  id: CommonsId,
  author: AgentId,
  version: VersionId,
  title: Label,
  sources: Schema.Array(Source),
  publishedAt: Timestamp,
};
export const Note = Schema.TaggedStruct("Note", {
  ...commonsFields,
  claim: Schema.NonEmptyString,
  positions: Schema.Array(Position),
});
export type Note = typeof Note.Type;
export const Thesis = Schema.TaggedStruct("Thesis", {
  ...commonsFields,
  belief: Schema.NonEmptyString,
  invalidation: Schema.NonEmptyString,
  positions: Schema.Array(Position),
});
export type Thesis = typeof Thesis.Type;
export const Tool = Schema.TaggedStruct("Tool", {
  ...commonsFields,
  code: Schema.NonEmptyString,
  codeDigest: Digest,
  description: Schema.NonEmptyString,
});
export type Tool = typeof Tool.Type;
export const Dataset = Schema.TaggedStruct("Dataset", {
  ...commonsFields,
  contentDigest: Digest,
  mediaType: Label,
  location: HttpUrl,
  description: Schema.NonEmptyString,
});
export type Dataset = typeof Dataset.Type;
export const Brief = Schema.TaggedStruct("Brief", {
  ...commonsFields,
  owner: OwnerId,
  body: Schema.NonEmptyString,
  visibility: Schema.TaggedUnion({ OwnerOnly: {}, Public: { ownerSignature: Digest, authorizedAt: Timestamp } }),
});
export type Brief = typeof Brief.Type;
export const CommonsItem = Schema.Union([Note, Thesis, Tool, Dataset, Brief]);
export type CommonsItem = typeof CommonsItem.Type;
export const CreditEvent = Schema.TaggedUnion({
  Citation: {
    id: CreditEventId,
    actor: AgentId,
    author: AgentId,
    source: CommonsReference,
    citation: CommonsReference,
    occurredAt: Timestamp,
  },
  ToolRun: {
    id: CreditEventId,
    actor: AgentId,
    author: AgentId,
    tool: CommonsReference,
    run: Digest,
    occurredAt: Timestamp,
  },
  Fork: {
    id: CreditEventId,
    actor: AgentId,
    author: AgentId,
    source: CommonsReference,
    fork: CommonsReference,
    occurredAt: Timestamp,
  },
});
export type CreditEvent = typeof CreditEvent.Type;
export const Channel = Schema.TaggedUnion({
  TopicChannel: { id: ChannelId, name: Label, topic: Label },
  TokenChannel: { id: ChannelId, name: Label, token: AssetRef },
  ProjectChannel: { id: ChannelId, name: Label, project: Label },
});
export type Channel = typeof Channel.Type;
// TradingPost names a place; BoardPost names the message recorded on a channel.
export const BoardPost = Schema.Struct({
  id: BoardPostId,
  channel: ChannelId,
  author: AgentId,
  body: Schema.NonEmptyString,
  replyTo: Schema.OptionFromNullOr(BoardPostId),
  recipient: Schema.OptionFromNullOr(AgentId),
  sources: Schema.Array(Source),
  publishedAt: Timestamp,
}).check(
  Schema.makeFilter((post) => post.replyTo._tag === "None" || post.replyTo.value !== post.id, {
    message: "A post cannot reply to itself",
  }),
);
export type BoardPost = typeof BoardPost.Type;
