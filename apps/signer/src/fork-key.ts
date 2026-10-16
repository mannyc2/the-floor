import { SignerError } from "@floor/chains/signer";
import { rpcResult, SolanaRpc } from "@floor/chains/solana/rpc";
import {
  createKeyPairFromBytes,
  getAddressFromPublicKey,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  getTransactionDecoder,
  signTransaction,
} from "@solana/kit";
import { Context, Effect, HashSet, Layer, Schema } from "effect";

const publicGenesisHashes = HashSet.make(
  "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
  "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBGmZ",
  "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY",
);

export class ForkKey extends Context.Service<ForkKey, {
  readonly payer: string;
  readonly verify: Effect.Effect<void, SignerError>;
  readonly sign: (
    bytes: Uint8Array,
  ) => Effect.Effect<{ readonly signature: string; readonly transaction: string }, SignerError>;
}>()("@floor/signer/ForkKey") {
  static layer(input: { readonly endpoint: string; readonly genesisHash: string; readonly secretKey: Uint8Array }) {
    return Layer.effect(
      ForkKey,
      Effect.gen(function*() {
        const rpc = yield* SolanaRpc;
        const url = yield* Effect.try({
          try: () => new URL(input.endpoint),
          catch: cause => new SignerError({ operation: "fork.endpoint", cause }),
        });
        if (
          url.protocol !== "http:" || !["127.0.0.1", "[::1]"].includes(url.hostname)
          || HashSet.has(publicGenesisHashes, input.genesisHash)
        ) {
          return yield* new SignerError({
            operation: "fork.endpoint",
            cause: "Local keys require a loopback RPC and a non-public genesis",
          });
        }
        const verify = Effect.gen(function*() {
          const actual = yield* rpcResult(rpc, Schema.String, "getGenesisHash", []);
          if (actual !== input.genesisHash) {
            return yield* new SignerError({
              operation: "fork.genesis",
              cause: { expected: input.genesisHash, actual },
            });
          }
          return void 0;
        }).pipe(Effect.mapError(cause => new SignerError({ operation: "fork.verify", cause })));
        // Verify before importing private material, and again for every signature;
        // a port reused by another RPC must not inherit the fork's authority.
        yield* verify;
        const key = yield* Effect.tryPromise({
          try: () => createKeyPairFromBytes(input.secretKey),
          catch: cause => new SignerError({ operation: "fork.key", cause }),
        });
        const payer = yield* Effect.tryPromise({
          try: () => getAddressFromPublicKey(key.publicKey),
          catch: cause => new SignerError({ operation: "fork.payer", cause }),
        });
        return ForkKey.of({
          payer,
          verify,
          sign: Effect.fn("ForkKey.sign")(function*(bytes) {
            yield* verify;
            const transaction = yield* Effect.try({
              try: () => getTransactionDecoder().decode(bytes),
              catch: cause => new SignerError({ operation: "fork.decode", cause }),
            });
            const signed = yield* Effect.tryPromise({
              try: () => signTransaction([key], transaction),
              catch: cause => new SignerError({ operation: "fork.sign", cause }),
            });
            return {
              signature: getSignatureFromTransaction(signed),
              transaction: getBase64EncodedWireTransaction(signed),
            };
          }),
        });
      }),
    );
  }
}
