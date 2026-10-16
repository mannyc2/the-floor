import { MeteoraLaunch } from "@floor/chains/solana";
import type { ConfigParametersArgs } from "@floor/chains/solana";
import { systemProgram, tokenProgram } from "@floor/chains/solana/programs";
import { readPoolLayer } from "@floor/chains/solana/read-pool";
import { SolanaReader } from "@floor/chains/solana/reader";
import { rpcResult, SolanaRpc } from "@floor/chains/solana/rpc";
import { AgentId, ChainRef, Digest, OwnerId } from "@floor/contract";
import {
  AccountRole,
  address,
  appendTransactionMessageInstructions,
  blockhash,
  compileTransaction,
  createKeyPairFromPrivateKeyBytes,
  createTransactionMessage,
  getAddressEncoder,
  getAddressFromPublicKey,
  getBase64EncodedWireTransaction,
  getProgramDerivedAddress,
  getStructEncoder,
  getTransactionDecoder,
  getU32Encoder,
  getU64Encoder,
  none,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransaction,
} from "@solana/kit";
import type { Address, Instruction } from "@solana/kit";
import { Effect, Layer, Schema } from "effect";
import { Base64, Hex } from "effect/encoding";
import { ForkConfiguration } from "../src/signer";

export class ForkFixtureError extends Schema.TaggedError<ForkFixtureError>()("ForkFixtureError", {
  operation: Schema.String,
  cause: Schema.Defect(),
}) {}
const keyFromSeed = Effect.fn("fork.keyFromSeed")(function*(seed: number) {
  const bytes = new Uint8Array(32).fill(seed);
  const key = yield* Effect.tryPromise({
    try: () => createKeyPairFromPrivateKeyBytes(bytes, true),
    catch: cause => new ForkFixtureError({ operation: "key", cause }),
  });
  const publicKey = yield* Effect.tryPromise({
    try: () => getAddressFromPublicKey(key.publicKey),
    catch: cause => new ForkFixtureError({ operation: "address", cause }),
  });
  return { key, address: publicKey, bytes: new Uint8Array([...bytes, ...getAddressEncoder().encode(publicKey)]) };
});
const config: ConfigParametersArgs = {
  poolFees: {
    baseFee: { cliffFeeNumerator: 10_000_000n, firstFactor: 0, secondFactor: 0n, thirdFactor: 0n, baseFeeMode: 0 },
    dynamicFee: none(),
  },
  collectFeeMode: 0,
  migrationOption: 1,
  activationType: 1,
  tokenType: 0,
  tokenDecimal: 6,
  partnerLiquidityPercentage: 50,
  partnerPermanentLockedLiquidityPercentage: 5,
  creatorLiquidityPercentage: 40,
  creatorPermanentLockedLiquidityPercentage: 5,
  migrationQuoteThreshold: 10_000_000_000n,
  sqrtStartPrice: 32609545905467449n,
  lockedVesting: {
    amountPerPeriod: 0n,
    cliffDurationFromMigrationTime: 0n,
    frequency: 0n,
    numberOfPeriod: 0n,
    cliffUnlockAmount: 0n,
  },
  migrationFeeOption: 3,
  tokenSupply: { preMigrationTokenSupply: 1_000_000_000_000_000n, postMigrationTokenSupply: 1_000_000_000_000_000n },
  creatorTradingFeePercentage: 50,
  tokenUpdateAuthority: 1,
  migrationFee: { feePercentage: 0, creatorFeePercentage: 0 },
  migratedPoolFee: { collectFeeMode: 0, dynamicFee: 0, poolFeeBps: 0 },
  poolCreationFee: 0n,
  partnerLiquidityVestingInfo: {
    vestingPercentage: 0,
    bpsPerPeriod: 0,
    numberOfPeriods: 0,
    cliffDurationFromMigrationTime: 0,
    frequency: 0,
  },
  creatorLiquidityVestingInfo: {
    vestingPercentage: 0,
    bpsPerPeriod: 0,
    numberOfPeriods: 0,
    cliffDurationFromMigrationTime: 0,
    frequency: 0,
  },
  migratedPoolBaseFeeMode: 0,
  migratedPoolMarketCapFeeSchedulerParams: {
    numberOfPeriod: 0,
    sqrtPriceStepBps: 0,
    schedulerExpirationDuration: 0,
    reductionFactor: 0n,
  },
  enableFirstSwapWithMinFee: false,
  compoundingFeeBps: 0,
  padding: new Uint8Array(2),
  curve: [{ sqrtPrice: 130438178253327822n, liquidity: 34783514678091156834964035168207n }, {
    sqrtPrice: 79226673521066979257578248091n,
    liquidity: 3435866574973078303503357n,
  }],
};
const latest = Schema.Struct({
  value: Schema.Struct({ blockhash: Schema.String, lastValidBlockHeight: Schema.Natural }),
});
const createAccountData = getStructEncoder([["instruction", getU32Encoder()], ["lamports", getU64Encoder()], [
  "space",
  getU64Encoder(),
], ["programAddress", getAddressEncoder()]]);
const createAccount = (payer: Address, account: Address, lamports: bigint, space: bigint): Instruction => ({
  programAddress: address(systemProgram),
  accounts: [{ address: payer, role: AccountRole.WRITABLE_SIGNER }, {
    address: account,
    role: AccountRole.WRITABLE_SIGNER,
  }],
  data: createAccountData.encode({ instruction: 0, lamports, space, programAddress: address(tokenProgram) }),
});
const initializeToken = (account: Address, mint: Address, owner: Address): Instruction => ({
  programAddress: address(tokenProgram),
  accounts: [{ address: account, role: AccountRole.WRITABLE }, { address: mint, role: AccountRole.READONLY }],
  data: new Uint8Array([18, ...getAddressEncoder().encode(owner)]),
});

export const launchForkFixture = Effect.fn("fork.launchFixture")(function*(endpoint: string) {
  const rpc = yield* SolanaRpc;
  const genesisHash = yield* rpcResult(rpc, Schema.String, "getGenesisHash", []);
  const payer = yield* keyFromSeed(21);
  const quote = yield* keyFromSeed(22);
  const base = yield* keyFromSeed(23);
  const poolConfig = yield* keyFromSeed(24);
  const input = yield* keyFromSeed(25);
  const output = yield* keyFromSeed(26);
  yield* rpcResult(rpc, Schema.String, "requestAirdrop", [payer.address, 100_000_000_000]);
  const send = Effect.fn("fork.sendFixtureTransaction")(
    function*(instructions: ReadonlyArray<Instruction>, keys: ReadonlyArray<CryptoKeyPair>) {
      const recent = yield* rpcResult(rpc, latest, "getLatestBlockhash", [{ commitment: "confirmed" }]);
      const tx = compileTransaction(
        appendTransactionMessageInstructions(
          instructions,
          setTransactionMessageLifetimeUsingBlockhash({
            blockhash: blockhash(recent.value.blockhash),
            lastValidBlockHeight: BigInt(recent.value.lastValidBlockHeight),
          }, setTransactionMessageFeePayer(payer.address, createTransactionMessage({ version: "legacy" }))),
        ),
      );
      const signed = yield* Effect.tryPromise({
        try: () => signTransaction([...keys], tx),
        catch: cause => new ForkFixtureError({ operation: "sign", cause }),
      });
      return yield* rpcResult(rpc, Schema.String, "sendTransaction", [getBase64EncodedWireTransaction(signed), {
        encoding: "base64",
        skipPreflight: false,
        preflightCommitment: "confirmed",
        maxRetries: 0,
      }]);
    },
  );
  const mintRent = yield* rpcResult(rpc, Schema.Natural, "getMinimumBalanceForRentExemption", [82]);
  yield* send([createAccount(payer.address, quote.address, BigInt(mintRent), 82n), {
    programAddress: address(tokenProgram),
    accounts: [{ address: quote.address, role: AccountRole.WRITABLE }],
    data: new Uint8Array([20, 6, ...getAddressEncoder().encode(payer.address), 0, ...new Uint8Array(32)]),
  }], [payer.key, quote.key]);
  const lifetime = yield* rpcResult(rpc, latest, "getLatestBlockhash", [{ commitment: "confirmed" }]);
  const launch = yield* (yield* MeteoraLaunch).construct({
    rpcEndpoint: endpoint,
    payer: payer.address,
    creator: payer.address,
    feeClaimer: payer.address,
    leftoverReceiver: payer.address,
    configAddress: poolConfig.address,
    baseMint: base.address,
    quoteMint: quote.address,
    config,
    metadata: { name: "Fork Test Token", symbol: "FORK", uri: "https://example.invalid/fork-test-token" },
    blockhash: lifetime.value.blockhash,
    lastValidBlockHeight: BigInt(lifetime.value.lastValidBlockHeight),
  });
  const signedLaunch = yield* Effect.tryPromise({
    try: () => signTransaction([payer.key, base.key, poolConfig.key], getTransactionDecoder().decode(launch.bytes)),
    catch: cause => new ForkFixtureError({ operation: "launch.sign", cause }),
  });
  yield* rpcResult(rpc, Schema.String, "sendTransaction", [getBase64EncodedWireTransaction(signedLaunch), {
    encoding: "base64",
    skipPreflight: false,
    preflightCommitment: "confirmed",
    maxRetries: 0,
  }]);
  const tokenRent = yield* rpcResult(rpc, Schema.Natural, "getMinimumBalanceForRentExemption", [165]);
  yield* send([
    createAccount(payer.address, input.address, BigInt(tokenRent), 165n),
    initializeToken(input.address, quote.address, payer.address),
    createAccount(payer.address, output.address, BigInt(tokenRent), 165n),
    initializeToken(output.address, base.address, payer.address),
    {
      programAddress: address(tokenProgram),
      accounts: [{ address: quote.address, role: AccountRole.WRITABLE }, {
        address: input.address,
        role: AccountRole.WRITABLE,
      }, { address: payer.address, role: AccountRole.READONLY_SIGNER }],
      data: new Uint8Array([7, ...getU64Encoder().encode(100_000_000_000n)]),
    },
  ], [payer.key, input.key, output.key]);
  const baseBytes = getAddressEncoder().encode(base.address);
  const quoteBytes = getAddressEncoder().encode(quote.address);
  const quoteFirst = Hex.encode(new Uint8Array(quoteBytes)) > Hex.encode(new Uint8Array(baseBytes));
  const [pool] = yield* Effect.tryPromise({
    try: () =>
      getProgramDerivedAddress({
        programAddress: address("dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN"),
        seeds: [
          new TextEncoder().encode("pool"),
          getAddressEncoder().encode(poolConfig.address),
          quoteFirst ? quoteBytes : baseBytes,
          quoteFirst ? baseBytes : quoteBytes,
        ],
      }),
    catch: cause => new ForkFixtureError({ operation: "pool.derive", cause }),
  });
  const configuration = ForkConfiguration.make({
    endpoint,
    genesisHash: Digest.make(genesisHash),
    owner: OwnerId.make("fork-owner"),
    agent: AgentId.make("fork-agent"),
    pool,
    inputTokenAccount: input.address,
    outputTokenAccount: output.address,
    quoteDecimals: 6,
  });
  const chain = ChainRef.make(`solana:${genesisHash.slice(0, 32)}`);
  const reading = yield* SolanaReader.use(reader => reader.getPool(pool)).pipe(Effect.provide(readPoolLayer(chain)));
  return { configuration, secretKey: Base64.encode(payer.bytes), payer: payer.address, reading, chain };
});

export const fixtureLayer = (endpoint: string) => Layer.merge(SolanaRpc.layer(endpoint), MeteoraLaunch.layer);
