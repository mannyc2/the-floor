// config service?
import { defaults, type FloorEvent, type Setting } from "@floor/contract";
import { Context, Effect, Layer, Option, Result, Schema } from "effect";
export type SettingKey = keyof typeof defaults;
export interface SettingChange {
  readonly key: SettingKey;
  readonly value: string | number | boolean;
  readonly scope: Setting["scope"];
  readonly scopeId: string;
}
export interface SettingAuthority {
  readonly principal: string;
  readonly admin: boolean;
  readonly ownedAgentIds: readonly string[];
}
export interface SettingScope {
  readonly scope: Setting["scope"];
  readonly scopeId: string;
}
export interface SettingChangeResult {
  readonly setting: Setting;
  readonly event: FloorEvent;
}
export class SettingDenied extends Schema.TaggedError<SettingDenied>()("SettingDenied", { message: Schema.String }) {}
interface SettingCodecs extends Readonly<Record<SettingKey, Schema.Decoder<string | number | boolean>>> {}
const positive = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0));
const probability = positive.check(Schema.isLessThanOrEqualTo(1));
const settingCodecs: SettingCodecs = {
  theme: Schema.Literals(["day", "night"]),
  visibility: Schema.Literals(["public", "private"]),
  publishMandate: Schema.Boolean,
  sound: Schema.Boolean,
  seaState: Schema.Boolean,
  seaTide: Schema.Literal(false),
  testnetOnly: Schema.Literal(true),
  maxUpdatesPerSecond: positive.check(Schema.isLessThanOrEqualTo(4)),
  worksLiquidityUsd: positive,
  worksTradesPerDay: positive,
  towerPercentile: probability,
  tierHysteresis: probability,
  layoutWidthsPerHour: positive,
  gatePass: probability,
  gateReject: probability,
  launchCoolingOffSeconds: positive.check(Schema.isGreaterThanOrEqualTo(604800)),
  agentLaunchesPerDay: positive.check(Schema.isLessThanOrEqualTo(1)),
  ownerLaunchesPerWeek: positive.check(Schema.isLessThanOrEqualTo(3)),
  voteHours: positive,
  quorumSupplyPercent: positive.check(Schema.isLessThanOrEqualTo(100)),
};
export function resolveSetting(
  key: SettingKey,
  settings: readonly Setting[],
  scopes: readonly SettingScope[] = [],
): string | number | boolean {
  let value: string | number | boolean = defaults[key];
  const floor: SettingScope = { scope: "floor", scopeId: "floor" };
  for (const scope of [floor, ...scopes]) {
    const entry = Option.fromUndefinedOr(
      settings.findLast((setting) =>
        setting.key === key && setting.scope === scope.scope && setting.scopeId === scope.scopeId
      ),
    );
    if (Option.isSome(entry)) value = entry.value.value;
  }
  return value;
}
export function changeSetting(
  change: SettingChange,
  authority: SettingAuthority,
  eventId: string,
  blockNumber: Option.Option<number>,
  now: string,
): Result.Result<SettingChangeResult, SettingDenied> {
  const ownerScoped = change.scope === "agent" && authority.ownedAgentIds.includes(change.scopeId);
  if (!authority.admin && !ownerScoped) {
    return Result.fail(
      new SettingDenied({ message: "Setting change requires administrator or agent owner authority" }),
    );
  }
  if (!authority.admin && !["theme", "publishMandate", "visibility", "sound"].includes(change.key)) {
    return Result.fail(
      new SettingDenied({ message: "Only personal presentation and privacy defaults are owner-scoped" }),
    );
  }
  const parsed = Schema.decodeResult(settingCodecs[change.key])(change.value);
  if (Result.isFailure(parsed)) return Result.fail(new SettingDenied({ message: parsed.failure.message }));
  return Result.succeed({
    setting: { ...change, value: parsed.success, changedByEvent: eventId },
    event: {
      id: eventId,
      type: "setting.changed",
      blockNumber: Option.getOrNull(blockNumber),
      createdAt: now,
      actor: authority.principal,
      entityId: change.scopeId,
      payload: { key: change.key, scope: change.scope, value: parsed.success },
    },
  });
}
export class Settings
  extends Context.Service<Settings, { get(key: SettingKey): Effect.Effect<string | number | boolean> }>()(
    "@floor/settings/Settings",
  )
{
  static layer = (settings: readonly Setting[]) =>
    Layer.succeed(Settings, Settings.of({ get: (key) => Effect.succeed(resolveSetting(key, settings)) }));
}
