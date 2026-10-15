import { BunCrypto } from "@effect/platform-bun";
import { DopplerLaunch } from "@floor/chains/evm";
import { MeteoraLaunch } from "@floor/chains/solana";
import { dopplerInput, meteoraInput, meteoraRpcLayer, quoteRpcLayer } from "@floor/chains/testing";
import { expect, test } from "bun:test";
import { Array, Crypto, Effect, Layer } from "effect";
import { Hex } from "effect/encoding";
import { getConfigParametersDecoder } from "../src/solana/_generated/configParameters";
import { getInitializePoolParametersDecoder } from "../src/solana/_generated/initializePoolParameters";
import { expectEqual, runTest } from "./_runtime";
import evmOracle from "./fixtures/evm-oracle.json";
import oracle from "./fixtures/instruction-oracle.json";

const runSolana = <A, E>(effect: Effect.Effect<A, E, MeteoraLaunch | Crypto.Crypto>, rpc = meteoraRpcLayer) =>
  runTest(effect.pipe(
    Effect.provide(Layer.merge(rpc, BunCrypto.layer)),
  ));
const runEvm = <A, E>(effect: Effect.Effect<A, E, DopplerLaunch | Crypto.Crypto>) =>
  runTest(effect.pipe(
    Effect.provide([DopplerLaunch.layer, BunCrypto.layer]),
  ));

test("Meteora account order, data and full unsigned bytes match the recorded SDK oracle", () =>
  runSolana(Effect.gen(function*() {
    const sdk = yield* MeteoraLaunch;
    const crypto = yield* Crypto.Crypto;
    const first = yield* sdk.construct(meteoraInput);
    const repeat = yield* sdk.construct(meteoraInput);
    expect(first.instructions).toEqual(oracle.instructions);
    expect(first.bytes.length).toBe(oracle.byteLength);
    expect(Hex.encode(yield* crypto.digest("SHA-256", first.bytes))).toBe(oracle.sha256);
    expect(repeat).toEqual(first);
    expect(first.requiredSigners).toEqual([meteoraInput.payer, meteoraInput.configAddress, meteoraInput.baseMint]);
    expect(first.attachedSignatures).toBe(0);
    expect(first.quoteReadSlot).toBe(0);
  })));

test("Meteora serializes caller amounts, metadata, recipients, creator and fee payer", () =>
  runSolana(Effect.gen(function*() {
    const sdk = yield* MeteoraLaunch;
    const changed = {
      ...meteoraInput,
      payer: meteoraInput.quoteMint,
      creator: meteoraInput.baseMint,
      feeClaimer: meteoraInput.configAddress,
      leftoverReceiver: meteoraInput.baseMint,
      config: { ...meteoraInput.config, migrationQuoteThreshold: 12_345_678_900n },
      metadata: { name: "Caller token", symbol: "CALL", uri: "https://caller.invalid/token" },
    };
    const result = yield* sdk.construct(changed);
    const createConfig = yield* Effect.fromOption(Array.get(result.instructions, 0));
    const initializePool = yield* Effect.fromOption(Array.get(result.instructions, 1));
    const configBytes = yield* Effect.fromResult(Hex.decode(createConfig.dataHex));
    const metadataBytes = yield* Effect.fromResult(Hex.decode(initializePool.dataHex));
    expect(getConfigParametersDecoder().decode(configBytes.slice(8)).migrationQuoteThreshold).toBe(12_345_678_900n);
    expect(getInitializePoolParametersDecoder().decode(metadataBytes.slice(8))).toEqual(changed.metadata);
    expect(createConfig.accounts[1]?.address).toBe(changed.feeClaimer);
    expect(createConfig.accounts[2]?.address).toBe(changed.leftoverReceiver);
    expect(createConfig.accounts[4]?.address).toBe(changed.payer);
    expect(initializePool.accounts[2]?.address).toBe(changed.creator);
    expect(result.requiredSigners).toContain(changed.payer);
    expect(result.attachedSignatures).toBe(0);
  })));

test("mint byte ordering survives either caller order and preserves the actual RPC slot", () =>
  runSolana(
    Effect.gen(function*() {
      const sdk = yield* MeteoraLaunch;
      const first = yield* sdk.construct(meteoraInput);
      const swapped = yield* sdk.construct({
        ...meteoraInput,
        baseMint: meteoraInput.quoteMint,
        quoteMint: meteoraInput.baseMint,
      });
      expect(swapped.pdas.pool).toBe(first.pdas.pool);
      expect(swapped.pdas.baseVault).toBe(first.pdas.quoteVault);
      expect(swapped.pdas.quoteVault).toBe(first.pdas.baseVault);
      expect(swapped.quoteReadSlot).toBe(345_678_901);
    }),
    quoteRpcLayer({ slot: 345_678_901, owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" }),
  ));

for (
  const example of [
    {
      name: "unsupported quote mint owner",
      rpc: quoteRpcLayer({ slot: 1, owner: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb" }),
    },
    {
      name: "unsuccessful HTTP status",
      rpc: quoteRpcLayer({ slot: 1, owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", status: 503 }),
    },
    {
      name: "negative RPC slot",
      rpc: quoteRpcLayer({ slot: -1, owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" }),
    },
  ]
) {
  test(`${example.name} fails closed`, () =>
    runSolana(
      Effect.gen(function*() {
        const sdk = yield* MeteoraLaunch;
        const result = yield* sdk.construct(meteoraInput).pipe(
          Effect.match({ onFailure: (error) => error._tag, onSuccess: () => "unexpected_success" }),
        );
        expect(result).toBe("ConstructionError");
      }),
      example.rpc,
    ));
}

test("invalid identities, unsupported base tokens and overflowing config fields fail without construction", () =>
  runSolana(Effect.gen(function*() {
    const sdk = yield* MeteoraLaunch;
    for (
      const input of [
        { ...meteoraInput, baseMint: "invalid" },
        { ...meteoraInput, baseMint: meteoraInput.quoteMint },
        { ...meteoraInput, config: { ...meteoraInput.config, tokenType: 1 } },
        { ...meteoraInput, config: { ...meteoraInput.config, migrationQuoteThreshold: 1n << 64n } },
        { ...meteoraInput, lastValidBlockHeight: -1n },
      ]
    ) {
      const failed = yield* sdk.construct(input).pipe(Effect.match({ onFailure: () => true, onSuccess: () => false }));
      expect(failed).toBe(true);
    }
  })));

test("Doppler construction retains exact oracle calldata and accepts caller inputs", () =>
  runEvm(Effect.gen(function*() {
    const sdk = yield* DopplerLaunch;
    const crypto = yield* Crypto.Crypto;
    const first = yield* sdk.construct(dopplerInput);
    const repeat = yield* sdk.construct(dopplerInput);
    expect(first.bytes.length).toBe(evmOracle.byteLength);
    expect(Hex.encode(yield* crypto.digest("SHA-256", first.bytes))).toBe(evmOracle.sha256);
    expectEqual(first.destination, evmOracle.destinations[0]);
    expect(first.attachedSignatures).toBe(0);
    expect(repeat).toEqual(first);
    const changed = yield* sdk.construct({
      ...dopplerInput,
      owner: "0x2222222222222222222222222222222222222222",
      initialSupply: 2_000_000n * 10n ** 18n,
      token: { name: "Caller token", symbol: "CALL", tokenURI: "https://caller.invalid/metadata" },
    });
    expect(changed.intendedSender).toBe("0x2222222222222222222222222222222222222222");
    expect(changed.bytes).not.toEqual(first.bytes);
    expect(changed.attachedSignatures).toBe(0);
  })));

test("Doppler rejects invalid addresses, nonpositive amounts and malformed salts", () =>
  runEvm(Effect.gen(function*() {
    const sdk = yield* DopplerLaunch;
    const invalidInputs: ReadonlyArray<typeof dopplerInput> = [
      { ...dopplerInput, owner: "invalid" },
      { ...dopplerInput, salt: "0x1234" },
      { ...dopplerInput, initialSupply: -1n },
      { ...dopplerInput, numTokensToSell: 0n },
    ];
    for (const input of invalidInputs) {
      const failed = yield* sdk.construct(input).pipe(Effect.match({ onFailure: () => true, onSuccess: () => false }));
      expect(failed).toBe(true);
    }
  })));
