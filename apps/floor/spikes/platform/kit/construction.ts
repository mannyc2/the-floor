import { BrowserCrypto } from "@effect/platform-browser";
import {
  address,
  appendTransactionMessageInstructions,
  blockhash,
  compileTransaction,
  createTransactionMessage,
  getAddressDecoder,
  getAddressEncoder,
  getProgramDerivedAddress,
  getTransactionEncoder,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from "@solana/kit";
import type { Address, Instruction, ReadonlyUint8Array } from "@solana/kit";
import { Crypto, Effect, Option, Schema } from "effect";
import { Hex } from "effect/encoding";
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import {
  getCreateConfigInstruction,
  getInitializeVirtualPoolWithSplTokenInstruction,
  programAddress,
} from "./bounded-instructions";
import { config } from "./config";

export class ConstructionError extends Schema.TaggedError<ConstructionError>()("ConstructionError", {
  operation: Schema.String,
  cause: Schema.Defect(),
}) {}
const quoteMint = address("So11111111111111111111111111111111111111112");
const tokenProgram = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const mintMetadataProgram = address("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
const payer = getAddressDecoder().decode(new Uint8Array(32).fill(1));
const configAddress = getAddressDecoder().decode(new Uint8Array(32).fill(2));
const baseMint = getAddressDecoder().decode(new Uint8Array(32).fill(3));
const encode = getAddressEncoder();
const utf8 = new TextEncoder();
const derive = Effect.fn("deriveMeteoraAddress")(
  function*(program: Address, seeds: ReadonlyArray<ReadonlyUint8Array | Uint8Array>) {
    const result = yield* Effect.tryPromise({
      try: () => getProgramDerivedAddress({ programAddress: program, seeds: [...seeds] }),
      catch: (cause) => new ConstructionError({ operation: "Kit.getProgramDerivedAddress", cause }),
    });
    return result[0];
  },
);
const RpcResponse = Schema.Struct({
  jsonrpc: Schema.Literal("2.0"),
  id: Schema.Literal(1),
  result: Schema.Struct({
    context: Schema.Struct({ slot: Schema.Literal(0) }),
    value: Schema.Struct({ owner: Schema.Literal(tokenProgram) }),
  }),
});
const getQuoteOwner = Effect.fn("getQuoteOwner")(function*(endpoint: string) {
  const client = yield* HttpClient.HttpClient;
  const request = yield* HttpClientRequest.post(endpoint).pipe(HttpClientRequest.bodyJson({
    jsonrpc: "2.0",
    id: 1,
    method: "getAccountInfo",
    params: [quoteMint, { encoding: "base64", commitment: "confirmed" }],
  }));
  const response = yield* client.execute(request).pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(RpcResponse)));
  return address(response.result.value.owner);
});
const encodeInstruction = (instruction: Instruction) => ({
  programAddress: instruction.programAddress,
  accounts: instruction.accounts,
  dataHex: Hex.encode(new Uint8Array(instruction.data ?? [])),
});
const constructMeteora = Effect.fn("constructMeteoraLaunch")(function*(endpoint: string) {
  const owner = yield* getQuoteOwner(endpoint);
  const eventAuthority = yield* derive(programAddress, [utf8.encode("__event_authority")]);
  // The two fixed mint identities order quote above base lexicographically as encoded public keys.
  const pool = yield* derive(programAddress, [
    utf8.encode("pool"),
    encode.encode(configAddress),
    encode.encode(quoteMint),
    encode.encode(baseMint),
  ]);
  const baseVault = yield* derive(programAddress, [
    utf8.encode("token_vault"),
    encode.encode(baseMint),
    encode.encode(pool),
  ]);
  const quoteVault = yield* derive(programAddress, [
    utf8.encode("token_vault"),
    encode.encode(quoteMint),
    encode.encode(pool),
  ]);
  const mintMetadata = yield* derive(mintMetadataProgram, [
    utf8.encode("metadata"),
    encode.encode(mintMetadataProgram),
    encode.encode(baseMint),
  ]);
  const instructions = [
    getCreateConfigInstruction({
      config: configAddress,
      feeClaimer: payer,
      leftoverReceiver: payer,
      quoteMint,
      payer,
      eventAuthority,
    }, config),
    getInitializeVirtualPoolWithSplTokenInstruction({
      config: configAddress,
      creator: payer,
      baseMint,
      quoteMint,
      pool,
      baseVault,
      quoteVault,
      mintMetadata,
      payer,
      tokenQuoteProgram: owner,
      eventAuthority,
    }, { name: "Spike", symbol: "SPK", uri: "https://example.invalid/spike" }),
  ];
  const message = appendTransactionMessageInstructions(
    instructions,
    setTransactionMessageLifetimeUsingBlockhash({
      blockhash: blockhash("11111111111111111111111111111111"),
      lastValidBlockHeight: 0n,
    }, setTransactionMessageFeePayer(payer, createTransactionMessage({ version: "legacy" }))),
  );
  const transaction = compileTransaction(message);
  const bytes = new Uint8Array(getTransactionEncoder().encode(transaction));
  const crypto = yield* Crypto.Crypto;
  return {
    instructions: instructions.map(encodeInstruction),
    byteLength: bytes.length,
    sha256: Hex.encode(yield* crypto.digest("SHA-256", bytes)),
    requiredSigners: Object.keys(transaction.signatures),
    attachedSignatures: Object.values(transaction.signatures).filter((value) =>
      Option.isSome(Option.fromNullOr(value))
    ).length,
    pdas: { eventAuthority, pool, baseVault, quoteVault, mintMetadata },
    quoteOwner: owner,
    fixtureSlot: 0,
  };
});
export const construct = (endpoint: string) =>
  constructMeteora(endpoint).pipe(
    Effect.mapError((cause) => new ConstructionError({ operation: "Meteora.construct", cause })),
    // oxlint-disable-next-line effecttsgo/strict-effect-provide -- This exported standalone Worker edge is the resource boundary for construction.
    Effect.provide([BrowserCrypto.layer, FetchHttpClient.layer]),
  );
