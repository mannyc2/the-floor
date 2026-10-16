import {
  address,
  appendTransactionMessageInstructions,
  blockhash,
  compileTransaction,
  createTransactionMessage,
  getAddressEncoder,
  getProgramDerivedAddress,
  getTransactionEncoder,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from "@solana/kit";
import type { Address, ReadonlyUint8Array } from "@solana/kit";
import { Context, Effect, Layer, Schema } from "effect";
import { Hex } from "effect/encoding";
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import { ConstructionError, UnsupportedConstruction } from "../error";
import type { ConfigParametersArgs } from "./_generated/configParameters";
import type { InitializePoolParametersArgs } from "./_generated/initializePoolParameters";
import {
  getCreateConfigInstruction,
  getInitializeVirtualPoolWithSplTokenInstruction,
  programAddress,
} from "./instructions";
import { metadataProgram, tokenProgram } from "./programs";

export { ConstructionError, UnsupportedConstruction } from "../error";
export type { ConfigParametersArgs } from "./_generated/configParameters";

export interface MeteoraLaunchInput {
  readonly rpcEndpoint: string;
  readonly payer: string;
  readonly creator: string;
  readonly feeClaimer: string;
  readonly leftoverReceiver: string;
  readonly configAddress: string;
  readonly baseMint: string;
  readonly quoteMint: string;
  readonly config: ConfigParametersArgs;
  readonly metadata: InitializePoolParametersArgs;
  readonly blockhash: string;
  readonly lastValidBlockHeight: bigint;
}

export interface UnsignedSolanaLaunch {
  readonly bytes: Uint8Array;
  readonly requiredSigners: ReadonlyArray<string>;
  readonly quoteReadSlot: number;
}

const tokenProgramAddress = address(tokenProgram);
const metadataProgramAddress = address(metadataProgram);
const encoder = getAddressEncoder();
const utf8 = new TextEncoder();
// The wire shape belongs to this adapter; keeping acceptance policy separate
// lets replay callers encode invalid replies and verify the production boundary.
export const QuoteAccountRpcReply = Schema.Struct({
  jsonrpc: Schema.Literal("2.0"),
  id: Schema.Literal(1),
  result: Schema.Struct({
    context: Schema.Struct({ slot: Schema.Int }),
    value: Schema.Struct({ owner: Schema.String }),
  }),
});
const RpcResponse = QuoteAccountRpcReply.check(
  Schema.makeFilter(reply =>
    reply.result.context.slot >= 0
      ? true
      : { path: ["result", "context", "slot"], issue: "RPC slot must be nonnegative" }
  ),
  // This promotion covers the tested legacy SPL instruction. Token-2022 needs
  // a separately verified instruction path, so it is rejected at the edge.
  Schema.makeFilter(reply =>
    reply.result.value.owner === tokenProgram
      ? true
      : { path: ["result", "value", "owner"], issue: "Quote mint must belong to the legacy SPL token program" }
  ),
);

const derive = Effect.fn("Meteora.deriveAddress")(function*(
  program: Address,
  seeds: ReadonlyArray<ReadonlyUint8Array | Uint8Array>,
) {
  const result = yield* Effect.tryPromise({
    try: () => getProgramDerivedAddress({ programAddress: program, seeds: [...seeds] }),
    catch: (cause) => new ConstructionError({ operation: "Kit.getProgramDerivedAddress", cause }),
  });
  return result[0];
});

export class MeteoraLaunch extends Context.Service<MeteoraLaunch, {
  readonly construct: (
    input: MeteoraLaunchInput,
  ) => Effect.Effect<UnsignedSolanaLaunch, ConstructionError | UnsupportedConstruction>;
}>()("@floor/chains/MeteoraLaunch") {
  static readonly layer = Layer.effect(
    MeteoraLaunch,
    Effect.gen(function*() {
      const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);
      const construct = Effect.fn("MeteoraLaunch.construct")(function*(input: MeteoraLaunchInput) {
        if (input.config.tokenType !== 0 || input.baseMint === input.quoteMint || input.lastValidBlockHeight < 0n) {
          return yield* new UnsupportedConstruction({
            invariant: "Legacy SPL base mint, distinct mint identities and unsigned block height are required",
          });
        }
        const identities = yield* Effect.try({
          try: () => ({
            payer: address(input.payer),
            creator: address(input.creator),
            feeClaimer: address(input.feeClaimer),
            leftoverReceiver: address(input.leftoverReceiver),
            config: address(input.configAddress),
            baseMint: address(input.baseMint),
            quoteMint: address(input.quoteMint),
            recentBlockhash: blockhash(input.blockhash),
          }),
          catch: (cause) => new ConstructionError({ operation: "Kit.decodeIdentities", cause }),
        });
        const request = yield* HttpClientRequest.post(input.rpcEndpoint).pipe(
          HttpClientRequest.bodyJson({
            jsonrpc: "2.0",
            id: 1,
            method: "getAccountInfo",
            params: [identities.quoteMint, { encoding: "base64", commitment: "confirmed" }],
          }),
          Effect.mapError((cause) => new ConstructionError({ operation: "Meteora.quoteMintRequest", cause })),
        );
        const quote = yield* client.execute(request).pipe(
          Effect.flatMap(HttpClientResponse.schemaBodyJson(RpcResponse)),
          Effect.mapError((cause) => new ConstructionError({ operation: "Meteora.quoteMintRead", cause })),
        );
        const eventAuthority = yield* derive(programAddress, [utf8.encode("__event_authority")]);
        const baseBytes = encoder.encode(identities.baseMint);
        const quoteBytes = encoder.encode(identities.quoteMint);
        // The SDK orders decoded public-key bytes descending, not base58 text.
        const quoteFirst = Hex.encode(new Uint8Array(quoteBytes)) > Hex.encode(new Uint8Array(baseBytes));
        const pool = yield* derive(programAddress, [
          utf8.encode("pool"),
          encoder.encode(identities.config),
          quoteFirst ? quoteBytes : baseBytes,
          quoteFirst ? baseBytes : quoteBytes,
        ]);
        const baseVault = yield* derive(programAddress, [utf8.encode("token_vault"), baseBytes, encoder.encode(pool)]);
        const quoteVault = yield* derive(programAddress, [
          utf8.encode("token_vault"),
          quoteBytes,
          encoder.encode(pool),
        ]);
        const mintMetadata = yield* derive(metadataProgramAddress, [
          utf8.encode("metadata"),
          encoder.encode(metadataProgramAddress),
          baseBytes,
        ]);
        return yield* Effect.try({
          try: (): UnsignedSolanaLaunch => {
            const message = appendTransactionMessageInstructions(
              [
                getCreateConfigInstruction({ ...identities, eventAuthority }, input.config),
                getInitializeVirtualPoolWithSplTokenInstruction({
                  ...identities,
                  pool,
                  baseVault,
                  quoteVault,
                  mintMetadata,
                  tokenQuoteProgram: tokenProgramAddress,
                  eventAuthority,
                }, input.metadata),
              ],
              setTransactionMessageLifetimeUsingBlockhash({
                blockhash: identities.recentBlockhash,
                lastValidBlockHeight: input.lastValidBlockHeight,
              }, setTransactionMessageFeePayer(identities.payer, createTransactionMessage({ version: "legacy" }))),
            );
            const transaction = compileTransaction(message);
            return {
              bytes: new Uint8Array(getTransactionEncoder().encode(transaction)),
              requiredSigners: Object.keys(transaction.signatures),
              quoteReadSlot: quote.result.context.slot,
            };
          },
          catch: (cause) => new ConstructionError({ operation: "Meteora.encodeUnsignedTransaction", cause }),
        });
      });
      return MeteoraLaunch.of({ construct });
    }),
  ).pipe(Layer.provide(FetchHttpClient.layer));
}
