import { DateTime, Option, Schema } from "effect";

// CAIP validates the shared envelope; namespace-specific checks and canonicalization
// belong to chain adapters, so this contract never guesses an address format.
export const ChainRef = Schema.String.check(
  Schema.isPattern(/^[-a-z0-9]{3,8}:[-_a-zA-Z0-9]{1,32}$/),
).pipe(
  Schema.brand("ChainRef"),
);
export type ChainRef = typeof ChainRef.Type;
export const AccountRef = Schema.String.check(
  Schema.isPattern(/^[-a-z0-9]{3,8}:[-_a-zA-Z0-9]{1,32}:[-.%a-zA-Z0-9]{1,128}$/),
).pipe(Schema.brand("AccountRef"));
export type AccountRef = typeof AccountRef.Type;
export const AssetRef = Schema.String.check(
  Schema.isPattern(
    /^[-a-z0-9]{3,8}:[-_a-zA-Z0-9]{1,32}\/[-a-z0-9]{3,8}:[-.%a-zA-Z0-9]{1,128}(\/[-.%a-zA-Z0-9]{1,78})?$/,
  ),
).pipe(Schema.brand("AssetRef"));
export type AssetRef = typeof AssetRef.Type;
export const TokenId = AssetRef;
export type TokenId = AssetRef;

const Identifier = Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9_-]{1,128}$/));
export const WorldId = Identifier.pipe(Schema.brand("WorldId"));
export type WorldId = typeof WorldId.Type;
export const FloorId = Identifier.pipe(Schema.brand("FloorId"));
export type FloorId = typeof FloorId.Type;
export const TradingPostId = Identifier.pipe(Schema.brand("TradingPostId"));
export type TradingPostId = typeof TradingPostId.Type;
export const StationId = Identifier.pipe(Schema.brand("StationId"));
export type StationId = typeof StationId.Type;
export const DeskId = Identifier.pipe(Schema.brand("DeskId"));
export type DeskId = typeof DeskId.Type;
export const PlotId = Identifier.pipe(Schema.brand("PlotId"));
export type PlotId = typeof PlotId.Type;
export const PieceId = Identifier.pipe(Schema.brand("PieceId"));
export type PieceId = typeof PieceId.Type;
export const VersionId = Schema.Int.check(Schema.isGreaterThan(0)).pipe(Schema.brand("VersionId"));
export type VersionId = typeof VersionId.Type;
export const AgentId = Identifier.pipe(Schema.brand("AgentId"));
export type AgentId = typeof AgentId.Type;
export const OwnerId = Identifier.pipe(Schema.brand("OwnerId"));
export type OwnerId = typeof OwnerId.Type;
export const PolicyId = Identifier.pipe(Schema.brand("PolicyId"));
export type PolicyId = typeof PolicyId.Type;
export const ReceiptId = Identifier.pipe(Schema.brand("ReceiptId"));
export type ReceiptId = typeof ReceiptId.Type;
export const IntentId = Identifier.pipe(Schema.brand("IntentId"));
export type IntentId = typeof IntentId.Type;
export const CommonsId = Identifier.pipe(Schema.brand("CommonsId"));
export type CommonsId = typeof CommonsId.Type;
export const BoardPostId = Identifier.pipe(Schema.brand("BoardPostId"));
export type BoardPostId = typeof BoardPostId.Type;
export const ChannelId = Identifier.pipe(Schema.brand("ChannelId"));
export type ChannelId = typeof ChannelId.Type;
export const CreditEventId = Identifier.pipe(Schema.brand("CreditEventId"));
export type CreditEventId = typeof CreditEventId.Type;
export const WorldEventId = Identifier.pipe(Schema.brand("WorldEventId"));
export type WorldEventId = typeof WorldEventId.Type;
export const WalletId = Identifier.pipe(Schema.brand("WalletId"));
export type WalletId = typeof WalletId.Type;
export const DestinationId = Identifier.pipe(Schema.brand("DestinationId"));
export type DestinationId = typeof DestinationId.Type;
export const SignerId = Identifier.pipe(Schema.brand("SignerId"));
export type SignerId = typeof SignerId.Type;

export const Label = Schema.NonEmptyString.check(Schema.isMaxLength(256));
export type Label = typeof Label.Type;
// Check the wire before DateTime's permissive parser can interpret a locale-
// dependent string or normalize an impossible calendar date into another day.
const IsoTimestamp = Schema.String.check(
  Schema.isPattern(/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/),
  Schema.makeFilter((text) => Option.exists(DateTime.make(text), (time) => DateTime.formatIso(time) === text), {
    message: "Timestamps must be real UTC ISO dates with millisecond precision",
  }),
);
const timestampRange = Schema.makeIsBetween({ order: DateTime.Order, formatter: DateTime.formatIso })({
  minimum: DateTime.makeUnsafe("0000-01-01T00:00:00.000Z"),
  maximum: DateTime.makeUnsafe("9999-12-31T23:59:59.999Z"),
});
export const Timestamp = IsoTimestamp.pipe(Schema.decodeTo(Schema.DateTimeUtcFromString)).check(timestampRange);
export type Timestamp = typeof Timestamp.Type;
export const Digest = Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9_.:+/-]+={0,2}$/), Schema.isMaxLength(256)).pipe(
  Schema.brand("Digest"),
);
export type Digest = typeof Digest.Type;
export const Height = Schema.String.check(Schema.isPattern(/^(0|[1-9][0-9]{0,77})$/)).pipe(
  Schema.brand("Height"),
);
export type Height = typeof Height.Type;
export const TransactionRef = Schema.Struct({ chain: ChainRef, hash: Digest }).pipe(Schema.brand("TransactionRef"));
export type TransactionRef = typeof TransactionRef.Type;
export const Checkpoint = Schema.Struct({ chain: ChainRef, height: Height, hash: Digest, time: Timestamp }).pipe(
  Schema.brand("Checkpoint"),
);
export type Checkpoint = typeof Checkpoint.Type;
