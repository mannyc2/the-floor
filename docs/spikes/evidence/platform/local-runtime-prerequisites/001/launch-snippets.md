# Launch construction candidates — unexecuted

These small examples use APIs inspected in the exact npm distributions named in [findings](api-findings.md). Installation failed for lack of disk space, so they have not been typechecked, run or claimed as evidence. Adapt them into the spike's Effect service boundary, preserving typed causes and refusing unintended RPC. Never add a wallet client, simulation call, signature or broadcast to the offline check.

## Doppler: deterministic Airlock calldata

The distributed 1.0.43 encoder is synchronous. Supply the already-constructed SDK with a public client whose transport rejects every request and no wallet client. Both the builder and encoder must complete without invoking that transport. The target chain here is Base only to exercise one supported EVM encoding; this does not settle the milestone islands or verify live deployments.

```ts
import {
  CHAIN_IDS,
  DopplerSDK,
  MulticurveBuilder,
  airlockAbi,
  getAddresses,
} from "@whetstone-research/doppler-sdk/evm";
import { encodeFunctionData, parseEther } from "viem";

declare const sdk: DopplerSDK<typeof CHAIN_IDS.BASE>;

const params = new MulticurveBuilder(CHAIN_IDS.BASE)
  .tokenConfig({
    name: "Offline Spike",
    symbol: "SPIKE",
    tokenURI: "https://example.invalid/spike.json",
  })
  .saleConfig({
    initialSupply: parseEther("1000000"),
    numTokensToSell: parseEther("900000"),
    numeraire: "0x4200000000000000000000000000000000000006",
  })
  .poolConfig({
    fee: 3000,
    tickSpacing: 60,
    curves: [{
      tickLower: 0,
      tickUpper: 240000,
      numPositions: 10,
      shares: parseEther("1"),
    }],
  })
  .withGovernance({ type: "default" })
  .withMigration({ type: "uniswapV2" })
  .withUserAddress("0x1111111111111111111111111111111111111111")
  .withSalt("0x1111111111111111111111111111111111111111111111111111111111111111")
  .build();

const createParams = sdk.factory.encodeCreateMulticurveParams(params);
const unsignedRequest = {
  to: getAddresses(CHAIN_IDS.BASE).airlock,
  data: encodeFunctionData({
    abi: airlockAbi,
    functionName: "create",
    args: [createParams],
  }),
};
```

Record the calldata byte length/digest and zero attempted RPC calls. Repeating with identical inputs/salt should produce the same digest. The fixed salt and identity are synthetic test values, not usable production launch inputs. Do not infer pool validity, locks or broadcast success from the encoded request.

## Meteora: config transaction with RPC forbidden

The supplied `Connection` must reject every request; construct the `DynamicBondingCurveClient` from that connection. These inputs match the current `BuildCurveParams` and enum definitions. The account public keys are passed in as synthetic fixture identities; no private keys are needed to construct instructions.

```ts
import {
  ActivationType,
  BaseFeeMode,
  CollectFeeMode,
  DynamicBondingCurveClient,
  MigrationFeeOption,
  MigrationOption,
  TokenAuthorityOption,
  TokenDecimal,
  TokenType,
  buildCurve,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import { PublicKey } from "@solana/web3.js";

declare const client: DynamicBondingCurveClient;
declare const payer: PublicKey;
declare const config: PublicKey;

const curve = buildCurve({
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

const unsignedConfig = await client.partner.createConfig({
  ...curve,
  payer,
  config,
  feeClaimer: payer,
  leftoverReceiver: payer,
  quoteMint: new PublicKey("So11111111111111111111111111111111111111112"),
});
```

Record instruction program IDs, instruction-data digests and zero attempted RPC calls. This covers a config transaction only. For a full pool transaction, `partner.createConfigAndPool` takes the same inputs plus `preCreatePoolParam: { name, symbol, uri, poolCreator, baseMint }`, but always reads the quote-mint account to learn its token program. That check needs a clearly labelled controlled RPC fixture or a permitted pinned account read. Do not label a fabricated account response as chain evidence, and do not claim this config-only snippet completes the full-launch gate.

The numeric curve values are bounded fixture inputs for SDK construction, not financial guidance or a product launch design. The spike still must show the exact constructed request executes inside workerd, then distinguish that result from a hosted provider or on-chain test.
