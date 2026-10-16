import {
  address,
  appendTransactionMessageInstructions,
  blockhash,
  compileTransaction,
  createTransactionMessage,
  getProgramDerivedAddress,
  getTransactionEncoder,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from "@solana/kit";
import { Context, Effect, Layer } from "effect";
import { ConstructionError, UnsupportedConstruction } from "../error";
import { getSwapInstruction, programAddress } from "./instructions";
import type { PoolReading } from "./reader";

export interface MeteoraSwapInput {
  readonly payer: string;
  readonly intentId: string;
  readonly pool: PoolReading;
  readonly inputTokenAccount: string;
  readonly outputTokenAccount: string;
  readonly amountIn: bigint;
  readonly minimumAmountOut: bigint;
  readonly blockhash: string;
  readonly lastValidBlockHeight: bigint;
}

export class MeteoraSwap extends Context.Service<MeteoraSwap, {
  readonly construct: (
    input: MeteoraSwapInput,
  ) => Effect.Effect<Uint8Array, ConstructionError | UnsupportedConstruction>;
}>()("@floor/chains/MeteoraSwap") {
  static readonly layer = Layer.succeed(
    MeteoraSwap,
    MeteoraSwap.of({
      construct: Effect.fn("MeteoraSwap.construct")(function*(input) {
        if (input.amountIn <= 0n || input.minimumAmountOut < 0n || input.lastValidBlockHeight < 0n) {
          return yield* new UnsupportedConstruction({
            invariant: "A swap requires positive input and unsigned output/block height",
          });
        }
        const [eventAuthority] = yield* Effect.tryPromise({
          try: () =>
            getProgramDerivedAddress({ programAddress, seeds: [new TextEncoder().encode("__event_authority")] }),
          catch: cause => new ConstructionError({ operation: "MeteoraSwap.eventAuthority", cause }),
        });
        return yield* Effect.try({
          try: () => {
            const instruction = getSwapInstruction({
              payer: address(input.payer),
              config: address(input.pool.config),
              pool: address(input.pool.address),
              inputTokenAccount: address(input.inputTokenAccount),
              outputTokenAccount: address(input.outputTokenAccount),
              baseVault: address(input.pool.baseVault),
              quoteVault: address(input.pool.quoteVault),
              baseMint: address(input.pool.baseMint),
              quoteMint: address(input.pool.quoteMint),
              eventAuthority,
            }, { amountIn: input.amountIn, minimumAmountOut: input.minimumAmountOut });
            const transaction = compileTransaction(appendTransactionMessageInstructions(
              [instruction, {
                // Distinct intent IDs must not produce the same signature in one block.
                programAddress: address("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"),
                accounts: [],
                data: new TextEncoder().encode(`floor:${input.intentId}`),
              }],
              setTransactionMessageLifetimeUsingBlockhash({
                blockhash: blockhash(input.blockhash),
                lastValidBlockHeight: input.lastValidBlockHeight,
              }, setTransactionMessageFeePayer(address(input.payer), createTransactionMessage({ version: "legacy" }))),
            ));
            return new Uint8Array(getTransactionEncoder().encode(transaction));
          },
          catch: cause => new ConstructionError({ operation: "MeteoraSwap.construct", cause }),
        });
      }),
    }),
  );
}
