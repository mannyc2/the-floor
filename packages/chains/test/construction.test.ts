import { BunCrypto } from "@effect/platform-bun";
import { DopplerLaunch } from "@floor/chains/evm";
import { MeteoraLaunch } from "@floor/chains/solana";
import { token2022Program, tokenProgram } from "@floor/chains/solana/programs";
import {
  AccountRole,
  decompileTransactionMessage,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
} from "@solana/kit";
import type { Instruction } from "@solana/kit";
import { expect, test } from "bun:test";
import { Array, Crypto, Effect, Layer, Option } from "effect";
import { Hex } from "effect/encoding";
import { getConfigParametersDecoder } from "../src/solana/_generated/configParameters";
import { getInitializePoolParametersDecoder } from "../src/solana/_generated/initializePoolParameters";
import { dopplerInput, meteoraInput, meteoraRpcLayer, quoteRpcLayer } from "./_inputs";
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

// Construction returns only the transaction bytes, so tests read them back with
// Kit's own decoders. An unsigned slot decodes as null.
const decode = (bytes: Uint8Array) => {
  const transaction = getTransactionDecoder().decode(bytes);
  const message = decompileTransactionMessage(getCompiledTransactionMessageDecoder().decode(transaction.messageBytes));
  // Each message version types its instructions differently; all are Instructions.
  const instructions: ReadonlyArray<Instruction> = message.instructions;
  return {
    attachedSignatures:
      Object.values(transaction.signatures).filter((signature) => Option.isSome(Option.fromNullOr(signature))).length,
    instructions: instructions.map((instruction) => ({
      programAddress: instruction.programAddress,
      accounts: (instruction.accounts ?? []).map(({ address, role }) => ({ address, role })),
      dataHex: Hex.encode(new Uint8Array(instruction.data ?? [])),
    })),
  };
};

// The pool instruction lists the pool, base vault and quote vault at 5 to 7.
const poolAccounts = (bytes: Uint8Array) =>
  Effect.fromOption(Array.get(decode(bytes).instructions, 1)).pipe(
    Effect.map((instruction) => instruction.accounts.slice(5, 8).map(({ address }) => address)),
  );

// A compiled message keeps one role per account, merged across instructions
// with the fee payer as a writable signer, so the oracle's per-instruction roles
// are compared in that form. The IDL test pins each instruction's own roles.
const oracleMessage = () => {
  const roles = new Map<string, number>([[meteoraInput.payer, AccountRole.WRITABLE_SIGNER]]);
  for (const { address, role } of oracle.instructions.flatMap((instruction) => instruction.accounts)) {
    roles.set(address, (roles.get(address) ?? AccountRole.READONLY) | role);
  }
  return oracle.instructions.map((instruction) => ({
    ...instruction,
    accounts: instruction.accounts.map(({ address }) => ({ address, role: roles.get(address) })),
  }));
};

test("Meteora account order, data and full unsigned bytes match the recorded SDK oracle", () =>
  runSolana(Effect.gen(function*() {
    const sdk = yield* MeteoraLaunch;
    const crypto = yield* Crypto.Crypto;
    const first = yield* sdk.construct(meteoraInput);
    const repeat = yield* sdk.construct(meteoraInput);
    const decoded = decode(first.bytes);
    expectEqual(decoded.instructions, oracleMessage());
    expect(first.bytes.length).toBe(oracle.byteLength);
    expect(Hex.encode(yield* crypto.digest("SHA-256", first.bytes))).toBe(oracle.sha256);
    expect(repeat).toEqual(first);
    expect(first.requiredSigners).toEqual([meteoraInput.payer, meteoraInput.configAddress, meteoraInput.baseMint]);
    expect(decoded.attachedSignatures).toBe(0);
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
    const decoded = decode(result.bytes);
    const createConfig = yield* Effect.fromOption(Array.get(decoded.instructions, 0));
    const initializePool = yield* Effect.fromOption(Array.get(decoded.instructions, 1));
    const configBytes = yield* Effect.fromResult(Hex.decode(createConfig.dataHex));
    const metadataBytes = yield* Effect.fromResult(Hex.decode(initializePool.dataHex));
    expect(getConfigParametersDecoder().decode(configBytes.slice(8)).migrationQuoteThreshold).toBe(12_345_678_900n);
    expect(getInitializePoolParametersDecoder().decode(metadataBytes.slice(8))).toEqual(changed.metadata);
    expectEqual(createConfig.accounts[1]?.address, changed.feeClaimer);
    expectEqual(createConfig.accounts[2]?.address, changed.leftoverReceiver);
    expectEqual(createConfig.accounts[4]?.address, changed.payer);
    expectEqual(initializePool.accounts[2]?.address, changed.creator);
    expect(result.requiredSigners).toContain(changed.payer);
    expect(decoded.attachedSignatures).toBe(0);
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
      const original = yield* poolAccounts(first.bytes);
      expect(original).toHaveLength(3);
      expectEqual(yield* poolAccounts(swapped.bytes), [original[0], original[2], original[1]]);
      expect(swapped.quoteReadSlot).toBe(345_678_901);
    }),
    quoteRpcLayer({ slot: 345_678_901, owner: tokenProgram }),
  ));

for (
  const example of [
    {
      name: "unsupported quote mint owner",
      rpc: quoteRpcLayer({ slot: 1, owner: token2022Program }),
    },
    {
      name: "unsuccessful HTTP status",
      rpc: quoteRpcLayer({ slot: 1, owner: tokenProgram, status: 503 }),
    },
    {
      name: "negative RPC slot",
      rpc: quoteRpcLayer({ slot: -1, owner: tokenProgram }),
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
    expect(repeat).toEqual(first);
    const changed = yield* sdk.construct({
      ...dopplerInput,
      owner: "0x2222222222222222222222222222222222222222",
      initialSupply: 2_000_000n * 10n ** 18n,
      token: { name: "Caller token", symbol: "CALL", tokenURI: "https://caller.invalid/metadata" },
    });
    expect(changed.intendedSender).toBe("0x2222222222222222222222222222222222222222");
    expect(changed.bytes).not.toEqual(first.bytes);
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
