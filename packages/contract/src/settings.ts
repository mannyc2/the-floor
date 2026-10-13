import { Option, Schema } from "effect";
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
// Fallbacks are configuration, not historical facts. Changing them cannot make
// a previously recorded SettingChanged event fail its schema.
export const defaultSettingValues = Object.freeze({
  StationsPerPost: defaultWorldLayout.stationsPerPost,
  PostsPerFloor: defaultWorldLayout.postsPerFloor,
  MonitorsPerPost: defaultWorldLayout.monitorsPerPost,
  LobbyPlots: defaultWorldLayout.lobbyPlots,
  QuarterTurnRotation: true,
  GasPayer: "agent",
  MoneyMode: "fork",
  AgentAdmission: "floorOwned",
  ReplayOrigin: "recordingStart",
  LargeTradeDollars: Option.none<PositiveUsd>(),
});
export const Setting = Schema.TaggedUnion({
  StationsPerPost: { ...fields, value: StationsPerPost },
  PostsPerFloor: { ...fields, value: PostsPerFloor },
  MonitorsPerPost: { ...fields, value: MonitorsPerPost },
  LobbyPlots: { ...fields, value: LobbyPlots },
  QuarterTurnRotation: { ...fields, value: Schema.Boolean },
  GasPayer: { ...fields, value: Schema.Literal("agent") },
  MoneyMode: { ...fields, value: Schema.Literal("fork") },
  AgentAdmission: { ...fields, value: Schema.Literal("floorOwned") },
  ReplayOrigin: { ...fields, value: Schema.Literal("recordingStart") },
  LargeTradeDollars: { ...fields, value: PositiveUsd },
});
export type Setting = typeof Setting.Type;
