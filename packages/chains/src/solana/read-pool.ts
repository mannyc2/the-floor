import { ChainRef, Checkpoint, Digest, Height } from "@floor/contract";
import { getAddressDecoder } from "@solana/kit";
import { DateTime, Effect, Layer, Schedule, Schema } from "effect";
import { Base64 } from "effect/encoding";
import { ConstructionError } from "../error";
import { getPoolStateDecoder } from "./_generated/poolState";
import { SolanaReader } from "./reader";
import { rpcResult, SolanaRpc } from "./rpc";

const Account = Schema.Struct({
  context: Schema.Struct({ slot: Schema.Natural }),
  value: Schema.Struct({ owner: Schema.String, data: Schema.Tuple([Schema.String, Schema.Literal("base64")]) }),
});
const Block = Schema.Struct({ blockhash: Schema.String, blockTime: Schema.Int });
const program = "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN";

export const chainCheckpoint = Effect.fn("SolanaReader.checkpoint")(
  function*(rpc: SolanaRpc["Service"], chain: ChainRef, slot: number) {
    const block = yield* rpcResult(rpc, Block, "getBlock", [slot, {
      commitment: "confirmed",
      transactionDetails: "none",
      rewards: false,
      maxSupportedTransactionVersion: 0,
    }]).pipe(Effect.retry({ schedule: Schedule.spaced("100 millis"), times: 20 }));
    return Checkpoint.make({
      chain,
      height: Height.make(String(slot)),
      hash: Digest.make(block.blockhash),
      time: DateTime.makeUnsafe(block.blockTime * 1000),
    });
  },
);

export const readPoolLayer = (chain: ChainRef) =>
  Layer.effect(
    SolanaReader,
    Effect.gen(function*() {
      const rpc = yield* SolanaRpc;
      return SolanaReader.of({
        getPool: Effect.fn("SolanaReader.getPool")(function*(pool) {
          const account = yield* rpcResult(rpc, Account, "getAccountInfo", [pool, {
            encoding: "base64",
            commitment: "confirmed",
          }]);
          if (account.value.owner !== program) {
            return yield* new ConstructionError({ operation: "readPool.owner", cause: account.value.owner });
          }
          const bytes = yield* Effect.fromResult(Base64.decode(account.value.data[0])).pipe(
            Effect.mapError(cause => new ConstructionError({ operation: "readPool.base64", cause })),
          );
          if (
            ![213, 224, 5, 209, 98, 69, 119, 92].every((value, index) => bytes[index] === value)
          ) {
            return yield* new ConstructionError({
              operation: "readPool.discriminator",
              cause: "Account is not a VirtualPool",
            });
          }
          const state = yield* Effect.try({
            try: () => getPoolStateDecoder().decode(bytes.slice(8)),
            catch: cause => new ConstructionError({ operation: "readPool.decode", cause }),
          });
          if (state.poolType !== 0 || state.isMigrated !== 0) {
            return yield* new ConstructionError({
              operation: "readPool.unsupported",
              cause: "Only active legacy SPL pools are supported",
            });
          }
          const configAccount = yield* rpcResult(rpc, Account, "getAccountInfo", [state.config, {
            encoding: "base64",
            commitment: "confirmed",
            minContextSlot: account.context.slot,
          }]);
          if (configAccount.value.owner !== program) {
            return yield* new ConstructionError({
              operation: "readPool.configOwner",
              cause: configAccount.value.owner,
            });
          }
          const configBytes = yield* Effect.fromResult(Base64.decode(configAccount.value.data[0])).pipe(
            Effect.mapError(cause => new ConstructionError({ operation: "readPool.configBase64", cause })),
          );
          if (
            ![26, 108, 14, 123, 116, 230, 129, 43].every((value, index) => configBytes[index] === value)
          ) {
            return yield* new ConstructionError({
              operation: "readPool.configDiscriminator",
              cause: "Account is not a PoolConfig",
            });
          }
          const quoteMint = yield* Effect.try({
            try: () => getAddressDecoder().decode(configBytes.slice(8, 40)),
            catch: cause => new ConstructionError({ operation: "readPool.configDecode", cause }),
          });
          return {
            address: pool,
            config: state.config,
            baseMint: state.baseMint,
            quoteMint,
            baseVault: state.baseVault,
            quoteVault: state.quoteVault,
            baseReserve: state.baseReserve,
            quoteReserve: state.quoteReserve,
            sqrtPrice: state.sqrtPrice,
            slot: BigInt(account.context.slot),
            checkpoint: yield* chainCheckpoint(rpc, chain, account.context.slot),
          };
        }),
      });
    }),
  );
