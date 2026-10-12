import {
  airlockAbi,
  CHAIN_IDS,
  DopplerSDK,
  getAddresses,
  MulticurveBuilder,
} from "@whetstone-research/doppler-sdk/evm";
import { Context, Effect, Layer, Schema } from "effect";
import { createPublicClient, custom, encodeFunctionData, getAddress, hexToBytes } from "viem";
import { base } from "viem/chains";
import { ConstructionError, UnsupportedConstruction } from "../error";

export { ConstructionError, UnsupportedConstruction } from "../error";

export interface DopplerLaunchInput {
  readonly chainId: 8453;
  readonly owner: string;
  readonly salt: `0x${string}`;
  readonly token: { readonly name: string; readonly symbol: string; readonly tokenURI: string };
  readonly initialSupply: bigint;
  readonly numTokensToSell: bigint;
  readonly numeraire: string;
  readonly fee: number;
  readonly tickSpacing: number;
  readonly curves: ReadonlyArray<{
    readonly tickLower: number;
    readonly tickUpper: number;
    readonly numPositions: number;
    readonly shares: bigint;
  }>;
}

export interface UnsignedEvmLaunch {
  readonly bytes: Uint8Array;
  readonly destination: string;
  readonly intendedSender: string;
  readonly attachedSignatures: 0;
}

class ConstructionRpcForbidden extends Schema.TaggedError<ConstructionRpcForbidden>()("ConstructionRpcForbidden", {}) {}
const Salt = Schema.TemplateLiteral(["0x", Schema.String]).check(Schema.isPattern(/^0x[\da-fA-F]{64}$/));

export class DopplerLaunch extends Context.Service<DopplerLaunch, {
  readonly construct: (
    input: DopplerLaunchInput,
  ) => Effect.Effect<UnsignedEvmLaunch, ConstructionError | UnsupportedConstruction>;
}>()("@floor/chains/DopplerLaunch") {
  static readonly layer = Layer.effect(
    DopplerLaunch,
    Effect.try({
      try: () => {
        // No wallet client exists at this construction edge. The hard rejection
        // prevents an SDK update from turning encoding into a hidden RPC request.
        const publicClient = createPublicClient({
          chain: base,
          transport: custom({
            request: () => {
              // oxlint-disable-next-line effect/noNewPromise -- Viem requires a Promise-returning EIP-1193 callback; it must always reject here.
              return Promise.reject(new ConstructionRpcForbidden());
            },
          }, { retryCount: 0 }),
        });
        const sdk = new DopplerSDK<typeof CHAIN_IDS.BASE>({ publicClient, chainId: CHAIN_IDS.BASE });
        const construct = Effect.fn("DopplerLaunch.construct")(function*(input: DopplerLaunchInput) {
          if (input.chainId !== CHAIN_IDS.BASE || input.initialSupply <= 0n || input.numTokensToSell <= 0n) {
            return yield* new UnsupportedConstruction({
              invariant: "The tested Base multicurve path requires positive sale amounts",
            });
          }
          const salt = yield* Schema.decodeEffect(Salt)(input.salt).pipe(
            Effect.mapError((cause) => new ConstructionError({ operation: "Doppler.decodeSalt", cause })),
          );
          return yield* Effect.try({
            try: (): UnsignedEvmLaunch => {
              const owner = getAddress(input.owner);
              const params = new MulticurveBuilder(CHAIN_IDS.BASE)
                .tokenConfig(input.token)
                .saleConfig({
                  initialSupply: input.initialSupply,
                  numTokensToSell: input.numTokensToSell,
                  numeraire: getAddress(input.numeraire),
                })
                .poolConfig({ fee: input.fee, tickSpacing: input.tickSpacing, curves: [...input.curves] })
                .withGovernance({ type: "default" })
                .withMigration({ type: "uniswapV2" })
                .withUserAddress(owner)
                .withSalt(salt)
                .build();
              const parameters = sdk.factory.encodeCreateMulticurveParams(params);
              const data = encodeFunctionData({ abi: airlockAbi, functionName: "create", args: [parameters] });
              return {
                bytes: hexToBytes(data),
                destination: getAddresses(CHAIN_IDS.BASE).airlock,
                intendedSender: owner,
                attachedSignatures: 0,
              };
            },
            catch: (cause) => new ConstructionError({ operation: "Doppler.encodeCreateMulticurveParams", cause }),
          });
        });
        return DopplerLaunch.of({ construct });
      },
      catch: (cause) => new ConstructionError({ operation: "Doppler.initialize", cause }),
    }),
  );
}
