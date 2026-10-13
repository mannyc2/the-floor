import { Schema } from "effect";
import { PositiveUsd } from "./agents.ts";
import { AgentId, ChainRef, FloorId, OwnerId, Timestamp } from "./identifiers.ts";

export const SettingScope = Schema.TaggedUnion({
  World: {},
  Chain: { chain: ChainRef },
  Floor: { floor: FloorId },
  Owner: { owner: OwnerId },
  Agent: { agent: AgentId },
});
export type SettingScope = typeof SettingScope.Type;
const fields = { scope: SettingScope, changedAt: Timestamp, changedBy: OwnerId };
export const StationsPerPost = Schema.Int.check(Schema.isBetween({ minimum: 8, maximum: 12 }));
export const PostsPerFloor = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 128 }));
export const MonitorsPerPost = Schema.Int.check(Schema.isBetween({ minimum: 6, maximum: 8 }));
export const LobbyPlots = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 32 }));
export const defaultWorldLayout = Object.freeze({
  stationsPerPost: 10,
  postsPerFloor: 40,
  monitorsPerPost: 7,
  lobbyPlots: 8,
});
// Keys select both the value's schema and its recorded default. A free-form
// key/value dictionary could accept a boolean for a capacity or erase its unit.
export const Setting = Schema.TaggedUnion({
  StationsPerPost: { ...fields, value: StationsPerPost, default: Schema.Literal(defaultWorldLayout.stationsPerPost) },
  PostsPerFloor: { ...fields, value: PostsPerFloor, default: Schema.Literal(defaultWorldLayout.postsPerFloor) },
  MonitorsPerPost: { ...fields, value: MonitorsPerPost, default: Schema.Literal(defaultWorldLayout.monitorsPerPost) },
  LobbyPlots: { ...fields, value: LobbyPlots, default: Schema.Literal(defaultWorldLayout.lobbyPlots) },
  QuarterTurnRotation: { ...fields, value: Schema.Boolean, default: Schema.Literal(true) },
  GasPayer: { ...fields, value: Schema.Literal("agent"), default: Schema.Literal("agent") },
  MoneyMode: { ...fields, value: Schema.Literal("fork"), default: Schema.Literal("fork") },
  AgentAdmission: { ...fields, value: Schema.Literal("floorOwned"), default: Schema.Literal("floorOwned") },
  ReplayOrigin: { ...fields, value: Schema.Literal("recordingStart"), default: Schema.Literal("recordingStart") },
  LargeTradeDollars: { ...fields, value: PositiveUsd, default: Schema.OptionFromNullOr(Schema.Never) },
});
export type Setting = typeof Setting.Type;
