import { Address, BaseUnitAmount, TokenAmount } from "@floor/contract";
import { Config, Context, Effect, Layer } from "effect";

const load = Effect.gen(function*() {
  const port = yield* Config.Int("PORT").pipe(Config.withDefault(8787));
  const hostname = yield* Config.String("FLOOR_HOST").pipe(Config.withDefault("127.0.0.1"));
  const local = yield* Config.Boolean("FLOOR_LOCAL").pipe(Config.withDefault(true));
  const origin = yield* Config.String("FLOOR_ORIGIN").pipe(Config.withDefault(`http://127.0.0.1:${port}`));
  // Incomplete declarations disable casting; malformed values fail startup instead of inventing curve terms.
  const foundry = yield* Config.all({
    contract: Config.schema(Address, "FLOOR_FOUNDRY_ADDRESS"),
    supply: Config.schema(TokenAmount, "FLOOR_FOUNDRY_TOKEN_SUPPLY"),
    launchFeeWei: Config.schema(BaseUnitAmount, "FLOOR_FOUNDRY_LAUNCH_FEE_WEI"),
    graduationThresholdWei: Config.schema(BaseUnitAmount, "FLOOR_FOUNDRY_GRADUATION_WEI"),
    virtualLiquidityWei: Config.schema(BaseUnitAmount, "FLOOR_FOUNDRY_VIRTUAL_LIQUIDITY_WEI"),
  }).pipe(Config.option);
  return { port, hostname, local, origin, foundry };
});

export class ServerConfig extends Context.Service<ServerConfig, Effect.Success<typeof load>>()("floor/ServerConfig") {
  static readonly layer = Layer.effect(ServerConfig, load);
}
