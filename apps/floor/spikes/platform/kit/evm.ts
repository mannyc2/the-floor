import { BrowserCrypto } from "@effect/platform-browser";
import {
  airlockAbi,
  CHAIN_IDS,
  DopplerSDK,
  getAddresses,
  MulticurveBuilder,
} from "@whetstone-research/doppler-sdk/evm";
import { Context, Crypto, Effect, Exit, Layer, Option, Schema } from "effect";
import { Hex } from "effect/encoding";
import { createPublicClient, custom, encodeFunctionData, hexToBytes, parseEther } from "viem";
import { base } from "viem/chains";
import { ConstructionError } from "./construction";
class ProbeAssertion extends Schema.TaggedError<ProbeAssertion>()("ProbeAssertion", { invariant: Schema.String }) {}
const evmOwner = "0x1111111111111111111111111111111111111111";
const evmSalt = "0x1111111111111111111111111111111111111111111111111111111111111111";
interface TransportCounts {
  readonly requests: number;
  readonly syntheticReads: number;
  readonly rejectedRequests: number;
}

interface UnsignedConstruction {
  readonly bytes: Uint8Array;
  readonly instructionCount: number;
  readonly destinations: ReadonlyArray<string>;
  readonly requiredSigners: Option.Option<ReadonlyArray<string>>;
  readonly intendedSender: string;
  readonly attachedSignatures: number;
}

interface LaunchSdk {
  readonly construct: Effect.Effect<UnsignedConstruction, ConstructionError>;
  readonly rejectControl: Effect.Effect<boolean>;
  readonly counts: Effect.Effect<TransportCounts>;
}

class DopplerLaunchSdk extends Context.Service<DopplerLaunchSdk, LaunchSdk>()(
  "floor/spikes/platform/DopplerLaunchSdk",
) {
  static readonly layer = Layer.effect(
    DopplerLaunchSdk,
    Effect.try({
      try: () => {
        let requests = 0;
        const publicClient = createPublicClient({
          chain: base,
          transport: custom({
            request: () => {
              requests += 1;
              // oxlint-disable-next-line effect/noNewPromise -- Viem's provider callback requires a Promise rejection to prevent any RPC dispatch.
              return Promise.reject(new ProbeAssertion({ invariant: "Doppler RPC is forbidden" }));
            },
          }, { retryCount: 0 }),
        });
        // Only the public client's rejecting transport is supplied; there is no wallet client.
        const sdk = new DopplerSDK<typeof CHAIN_IDS.BASE>({ publicClient, chainId: CHAIN_IDS.BASE });
        const construct = Effect.try({
          try: () => {
            const params = new MulticurveBuilder(CHAIN_IDS.BASE)
              .tokenConfig({ name: "Spike", symbol: "SPK", tokenURI: "https://example.invalid/spike" })
              .saleConfig({
                initialSupply: parseEther("1000000"),
                numTokensToSell: parseEther("900000"),
                numeraire: "0x4200000000000000000000000000000000000006",
              })
              .poolConfig({
                fee: 3000,
                tickSpacing: 60,
                curves: [{ tickLower: 0, tickUpper: 240000, numPositions: 10, shares: parseEther("1") }],
              })
              .withGovernance({ type: "default" })
              .withMigration({ type: "uniswapV2" })
              .withUserAddress(evmOwner)
              .withSalt(evmSalt)
              .build();
            const parameters = sdk.factory.encodeCreateMulticurveParams(params);
            const data = encodeFunctionData({ abi: airlockAbi, functionName: "create", args: [parameters] });
            return {
              bytes: hexToBytes(data),
              instructionCount: 1,
              destinations: [getAddresses(CHAIN_IDS.BASE).airlock],
              requiredSigners: Option.none(),
              intendedSender: evmOwner,
              attachedSignatures: 0,
            };
          },
          catch: (cause) => new ConstructionError({ operation: "Doppler.encodeCreateMulticurveParams", cause }),
        });
        const rejectControl = Effect.tryPromise({
          try: () => publicClient.getChainId(),
          catch: (cause) => new ConstructionError({ operation: "Doppler.rejectionControl", cause }),
        }).pipe(Effect.exit, Effect.map(Exit.isFailure));
        return DopplerLaunchSdk.of({
          construct,
          rejectControl,
          counts: Effect.sync(() => ({ requests, syntheticReads: 0, rejectedRequests: requests })),
        });
      },
      catch: (cause) => new ConstructionError({ operation: "Doppler.initialize", cause }),
    }),
  );
}

const probeSdk = Effect.fn("probeLaunchSdk")(function*(
  sdk: LaunchSdk,
  expectedFixtureReads: number,
  expectedInstructionCount: number,
) {
  const controlRejected = yield* sdk.rejectControl;
  const before = yield* sdk.counts;
  if (!controlRejected || before.requests !== 1 || before.rejectedRequests !== 1 || before.syntheticReads !== 0) {
    return yield* new ProbeAssertion({ invariant: "The negative control reaches and is rejected by its transport" });
  }
  const first = yield* sdk.construct;
  const second = yield* sdk.construct;
  const after = yield* sdk.counts;
  if (after.rejectedRequests !== before.rejectedRequests || after.syntheticReads !== expectedFixtureReads) {
    return yield* new ProbeAssertion({ invariant: "Construction uses only the declared synthetic reads" });
  }
  if (first.bytes.length === 0 || first.instructionCount !== expectedInstructionCount) {
    return yield* new ProbeAssertion({ invariant: "Launch construction contains every expected instruction" });
  }
  if (first.attachedSignatures !== 0 || second.attachedSignatures !== 0) {
    return yield* new ProbeAssertion({ invariant: "Both launch constructions contain no attached signatures" });
  }
  const crypto = yield* Crypto.Crypto;
  const firstDigest = Hex.encode(
    yield* crypto.digest("SHA-256", first.bytes).pipe(
      Effect.mapError((cause) => new ConstructionError({ operation: "Launch.digest.first", cause })),
    ),
  );
  const secondDigest = Hex.encode(
    yield* crypto.digest("SHA-256", second.bytes).pipe(
      Effect.mapError((cause) => new ConstructionError({ operation: "Launch.digest.repeat", cause })),
    ),
  );
  if (firstDigest !== secondDigest) {
    return yield* new ProbeAssertion({ invariant: "Repeated construction with fixed inputs is byte deterministic" });
  }
  return {
    byteLength: first.bytes.length,
    sha256: firstDigest,
    repeatSha256: secondDigest,
    instructionCount: first.instructionCount,
    destinations: first.destinations,
    requiredSigners: first.requiredSigners,
    intendedSender: first.intendedSender,
    attachedSignatures: first.attachedSignatures,
    constructionTransportRequests: after.requests - before.requests,
    syntheticReads: after.syntheticReads,
    rejectedConstructionRequests: after.rejectedRequests - before.rejectedRequests,
    negativeControlRejected: controlRejected,
    negativeControlRequests: before.requests,
  };
});

export const probeEvm = Effect.gen(function*() {
  const sdk = yield* DopplerLaunchSdk;
  return yield* probeSdk(sdk, 0, 1);
  // oxlint-disable-next-line effecttsgo/strict-effect-provide -- This bounded probe owns fresh SDK request counters per invocation.
}).pipe(Effect.provide([DopplerLaunchSdk.layer, BrowserCrypto.layer]));
