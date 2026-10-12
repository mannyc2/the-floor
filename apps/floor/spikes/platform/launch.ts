import { BrowserCrypto } from "@effect/platform-browser";
import {
  ActivationType,
  BaseFeeMode,
  buildCurve,
  CollectFeeMode,
  DynamicBondingCurveClient,
  MigrationFeeOption,
  MigrationOption,
  TokenAuthorityOption,
  TokenDecimal,
  TokenType,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import type { ConfigParameters } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { Connection, PublicKey } from "@solana/web3.js";
import type { FetchFn, Transaction } from "@solana/web3.js";
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
import { ProbeAssertion, ProbeError } from "./errors";

const syntheticEndpoint = "https://synthetic-launch-fixture.invalid";
const quoteMint = "So11111111111111111111111111111111111111112";
const tokenProgram = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const syntheticBlockhash = "11111111111111111111111111111111";
const evmOwner = "0x1111111111111111111111111111111111111111";
const evmSalt = "0x1111111111111111111111111111111111111111111111111111111111111111";

// Only the quote mint's token-program owner is consumed by this SDK path.
// The empty account data and slot zero deliberately do not impersonate a chain snapshot.
const QuoteMintRequest = Schema.fromJsonString(
  Schema.Struct({
    jsonrpc: Schema.Literal("2.0"),
    id: Schema.Union([Schema.String, Schema.Finite]),
    method: Schema.Literal("getAccountInfo"),
    params: Schema.Tuple([
      Schema.Literal(quoteMint),
      Schema.Struct({
        encoding: Schema.Literal("base64"),
        commitment: Schema.Literal("confirmed"),
      }),
    ]),
  }),
);

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
  readonly construct: Effect.Effect<UnsignedConstruction, ProbeError>;
  readonly rejectControl: Effect.Effect<boolean>;
  readonly counts: Effect.Effect<TransportCounts>;
}

const serializeMeteora = (transaction: Transaction, payer: PublicKey): UnsignedConstruction => {
  transaction.feePayer = payer;
  transaction.recentBlockhash = syntheticBlockhash;
  const bytes = transaction.serialize({ requireAllSignatures: false, verifySignatures: false });
  return {
    bytes: new Uint8Array(bytes),
    instructionCount: transaction.instructions.length,
    destinations: transaction.instructions.map((instruction) => instruction.programId.toBase58()),
    requiredSigners: Option.some(transaction.signatures.map((entry) => entry.publicKey.toBase58())),
    intendedSender: payer.toBase58(),
    attachedSignatures:
      transaction.signatures.filter((entry) => Option.isSome(Option.fromNullOr(entry.signature))).length,
  };
};

class MeteoraLaunchSdk extends Context.Service<MeteoraLaunchSdk, LaunchSdk>()(
  "floor/spikes/platform/MeteoraLaunchSdk",
) {
  static readonly layer = Layer.effect(
    MeteoraLaunchSdk,
    Effect.try({
      try: () => {
        let requests = 0;
        let syntheticReads = 0;
        let rejectedRequests = 0;
        const fixtureFetch: FetchFn = (_input, init) => {
          requests += 1;
          return Schema.decodeUnknownPromise(QuoteMintRequest)(init?.body).then(
            (request) => {
              syntheticReads += 1;
              return Response.json({
                jsonrpc: "2.0",
                id: request.id,
                result: {
                  context: { slot: 0 },
                  value: {
                    data: ["", "base64"],
                    executable: false,
                    lamports: 0,
                    owner: tokenProgram,
                    rentEpoch: 0,
                  },
                },
              });
            },
            (cause: unknown) => {
              rejectedRequests += 1;
              // oxlint-disable-next-line effect/noNewPromise -- The SDK fetch callback requires a rejected Promise; it never delegates to network fetch.
              return Promise.reject(new ProbeError({ operation: "Meteora.syntheticRpc.reject", cause }));
            },
          );
        };
        const connection = new Connection(syntheticEndpoint, {
          commitment: "confirmed",
          fetch: fixtureFetch,
          httpAgent: false,
          disableRetryOnRateLimit: true,
        });
        const client = new DynamicBondingCurveClient(connection, "confirmed");
        // Public identifiers alone suffice for unsigned construction; no keypairs are created.
        const payer = new PublicKey(new Uint8Array(32).fill(1));
        const config = new PublicKey(new Uint8Array(32).fill(2));
        const baseMint = new PublicKey(new Uint8Array(32).fill(3));
        const construct = Effect.tryPromise({
          try: () => {
            const curve: ConfigParameters = buildCurve({
              token: {
                tokenType: TokenType.SPLToken,
                tokenBaseDecimal: TokenDecimal.SIX,
                tokenQuoteDecimal: TokenDecimal.NINE,
                tokenAuthorityOption: TokenAuthorityOption.Immutable,
                totalTokenSupply: 1_000_000_000,
                leftover: 0,
              },
              fee: {
                baseFeeParams: {
                  baseFeeMode: BaseFeeMode.FeeSchedulerLinear,
                  feeSchedulerParam: {
                    startingFeeBps: 100,
                    endingFeeBps: 100,
                    numberOfPeriod: 0,
                    totalDuration: 0,
                  },
                },
                dynamicFeeEnabled: false,
                collectFeeMode: CollectFeeMode.QuoteToken,
                creatorTradingFeePercentage: 50,
                poolCreationFee: 0,
                enableFirstSwapWithMinFee: false,
              },
              migration: {
                migrationOption: MigrationOption.MET_DAMM_V2,
                migrationFeeOption: MigrationFeeOption.FixedBps200,
                migrationFee: { feePercentage: 0, creatorFeePercentage: 0 },
              },
              liquidityDistribution: {
                partnerPermanentLockedLiquidityPercentage: 5,
                partnerLiquidityPercentage: 50,
                creatorPermanentLockedLiquidityPercentage: 5,
                creatorLiquidityPercentage: 40,
              },
              lockedVesting: {
                totalLockedVestingAmount: 0,
                numberOfVestingPeriod: 0,
                cliffUnlockAmount: 0,
                totalVestingDuration: 0,
                cliffDurationFromMigrationTime: 0,
              },
              activationType: ActivationType.Timestamp,
              percentageSupplyOnMigration: 20,
              migrationQuoteThreshold: 10,
            });
            return client.partner.createConfigAndPool({
              ...curve,
              payer,
              config,
              feeClaimer: payer,
              leftoverReceiver: payer,
              quoteMint: new PublicKey(quoteMint),
              preCreatePoolParam: {
                name: "Spike",
                symbol: "SPK",
                uri: "https://example.invalid/spike",
                poolCreator: payer,
                baseMint,
              },
            }).then((transaction) => serializeMeteora(transaction, payer));
          },
          catch: (cause) => new ProbeError({ operation: "Meteora.createConfigAndPool", cause }),
        });
        const rejectControl = Effect.tryPromise({
          try: () => connection.getBalance(payer),
          catch: (cause) => new ProbeError({ operation: "Meteora.rejectionControl", cause }),
        }).pipe(Effect.exit, Effect.map(Exit.isFailure));
        return MeteoraLaunchSdk.of({
          construct,
          rejectControl,
          counts: Effect.sync(() => ({ requests, syntheticReads, rejectedRequests })),
        });
      },
      catch: (cause) => new ProbeError({ operation: "Meteora.initialize", cause }),
    }),
  );
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
          catch: (cause) => new ProbeError({ operation: "Doppler.encodeCreateMulticurveParams", cause }),
        });
        const rejectControl = Effect.tryPromise({
          try: () => publicClient.getChainId(),
          catch: (cause) => new ProbeError({ operation: "Doppler.rejectionControl", cause }),
        }).pipe(Effect.exit, Effect.map(Exit.isFailure));
        return DopplerLaunchSdk.of({
          construct,
          rejectControl,
          counts: Effect.sync(() => ({ requests, syntheticReads: 0, rejectedRequests: requests })),
        });
      },
      catch: (cause) => new ProbeError({ operation: "Doppler.initialize", cause }),
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
      Effect.mapError((cause) => new ProbeError({ operation: "Launch.digest.first", cause })),
    ),
  );
  const secondDigest = Hex.encode(
    yield* crypto.digest("SHA-256", second.bytes).pipe(
      Effect.mapError((cause) => new ProbeError({ operation: "Launch.digest.repeat", cause })),
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

export const probeLaunchConstruction = Effect.gen(function*() {
  const meteora = yield* MeteoraLaunchSdk;
  const doppler = yield* DopplerLaunchSdk;
  return {
    scope: "unsigned construction with synthetic inputs; no network, simulation, signing or broadcast",
    meteora: {
      sdkVersion: "1.5.13",
      chain: "Solana; no observed network checkpoint",
      venue: "Meteora Dynamic Bonding Curve",
      construction: "createConfigAndPool",
      quoteMintFixture: { kind: "synthetic", address: quoteMint, owner: tokenProgram, slot: 0 },
      syntheticBlockhash,
      result: yield* probeSdk(meteora, 2, 2),
    },
    doppler: {
      sdkVersion: "1.0.43",
      chainId: CHAIN_IDS.BASE,
      venue: "Doppler Airlock multicurve",
      construction: "encodeCreateMulticurveParams plus Airlock create calldata",
      syntheticOwner: evmOwner,
      syntheticSalt: evmSalt,
      result: yield* probeSdk(doppler, 0, 1),
    },
  };
  // oxlint-disable-next-line effecttsgo/strict-effect-provide -- Each standalone probe invocation owns fresh SDK counters and all of its layers.
}).pipe(Effect.provide(Layer.mergeAll(MeteoraLaunchSdk.layer, DopplerLaunchSdk.layer, BrowserCrypto.layer)));
