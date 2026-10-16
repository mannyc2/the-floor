import type { DopplerLaunchInput } from "@floor/chains/evm";
import { MeteoraLaunch, QuoteAccountRpcReply } from "@floor/chains/solana";
import type { ConfigParametersArgs, MeteoraLaunchInput } from "@floor/chains/solana";
import { tokenProgram } from "@floor/chains/solana/programs";
import { getAddressDecoder, none } from "@solana/kit";
import { Effect, Layer, Schema } from "effect";
import { FetchHttpClient } from "effect/http";

// Controlled dev-oracle output, never a price quote or network snapshot.
export const config: ConfigParametersArgs = {
  "poolFees": {
    "baseFee": {
      "cliffFeeNumerator": 10000000n,
      "firstFactor": 0,
      "secondFactor": 0n,
      "thirdFactor": 0n,
      "baseFeeMode": 0,
    },
    "dynamicFee": none(),
  },
  "collectFeeMode": 0,
  "migrationOption": 1,
  "activationType": 1,
  "tokenType": 0,
  "tokenDecimal": 6,
  "partnerLiquidityPercentage": 50,
  "partnerPermanentLockedLiquidityPercentage": 5,
  "creatorLiquidityPercentage": 40,
  "creatorPermanentLockedLiquidityPercentage": 5,
  "migrationQuoteThreshold": 10000000000n,
  "sqrtStartPrice": 32609545905467449n,
  "lockedVesting": {
    "amountPerPeriod": 0n,
    "cliffDurationFromMigrationTime": 0n,
    "frequency": 0n,
    "numberOfPeriod": 0n,
    "cliffUnlockAmount": 0n,
  },
  "migrationFeeOption": 3,
  "tokenSupply": { "preMigrationTokenSupply": 1000000000000000n, "postMigrationTokenSupply": 1000000000000000n },
  "creatorTradingFeePercentage": 50,
  "tokenUpdateAuthority": 1,
  "migrationFee": { "feePercentage": 0, "creatorFeePercentage": 0 },
  "migratedPoolFee": { "collectFeeMode": 0, "dynamicFee": 0, "poolFeeBps": 0 },
  "poolCreationFee": 0n,
  "partnerLiquidityVestingInfo": {
    "vestingPercentage": 0,
    "bpsPerPeriod": 0,
    "numberOfPeriods": 0,
    "cliffDurationFromMigrationTime": 0,
    "frequency": 0,
  },
  "creatorLiquidityVestingInfo": {
    "vestingPercentage": 0,
    "bpsPerPeriod": 0,
    "numberOfPeriods": 0,
    "cliffDurationFromMigrationTime": 0,
    "frequency": 0,
  },
  "migratedPoolBaseFeeMode": 0,
  "migratedPoolMarketCapFeeSchedulerParams": {
    "numberOfPeriod": 0,
    "sqrtPriceStepBps": 0,
    "schedulerExpirationDuration": 0,
    "reductionFactor": 0n,
  },
  "enableFirstSwapWithMinFee": false,
  "compoundingFeeBps": 0,
  "padding": new Uint8Array(2),
  "curve": [{ "sqrtPrice": 130438178253327822n, "liquidity": 34783514678091156834964035168207n }, {
    "sqrtPrice": 79226673521066979257578248091n,
    "liquidity": 3435866574973078303503357n,
  }],
};

// These are replay inputs from kit-construction/002, not live provider data.
const identity = (byte: number) => getAddressDecoder().decode(new Uint8Array(32).fill(byte));
export const meteoraInput: MeteoraLaunchInput = {
  rpcEndpoint: "https://fixture.invalid/rpc",
  payer: identity(1),
  creator: identity(1),
  feeClaimer: identity(1),
  leftoverReceiver: identity(1),
  configAddress: identity(2),
  baseMint: identity(3),
  quoteMint: "So11111111111111111111111111111111111111112",
  config,
  metadata: { name: "Spike", symbol: "SPK", uri: "https://example.invalid/spike" },
  blockhash: "11111111111111111111111111111111",
  lastValidBlockHeight: 0n,
};

export const dopplerInput: DopplerLaunchInput = {
  chainId: 8453,
  owner: "0x1111111111111111111111111111111111111111",
  salt: "0x1111111111111111111111111111111111111111111111111111111111111111",
  token: { name: "Spike", symbol: "SPK", tokenURI: "https://example.invalid/spike" },
  initialSupply: 1_000_000n * 10n ** 18n,
  numTokensToSell: 900_000n * 10n ** 18n,
  numeraire: "0x4200000000000000000000000000000000000006",
  fee: 3000,
  tickSpacing: 60,
  curves: [{ tickLower: 0, tickUpper: 240000, numPositions: 10, shares: 10n ** 18n }],
};

export const quoteRpcLayer = (options: { readonly slot: number; readonly owner: string; readonly status?: number }) =>
  Layer.unwrap(Effect.gen(function*() {
    const json = yield* Schema.encodeEffect(Schema.fromJsonString(QuoteAccountRpcReply))({
      jsonrpc: "2.0",
      id: 1,
      result: { context: { slot: options.slot }, value: { owner: options.owner } },
    });
    const replayFetch = Object.assign(() =>
      // oxlint-disable-next-line effect/noNewPromise -- The test Fetch callback implements the browser Promise contract without making a network request.
      Promise.resolve(
        new Response(json, { status: options.status ?? 200, headers: { "content-type": "application/json" } }),
      ), { preconnect: () => {/* Replay preconnection must never open a socket. */} });
    return MeteoraLaunch.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch, replayFetch)));
  }));

export const meteoraRpcLayer = quoteRpcLayer({ slot: 0, owner: tokenProgram });
