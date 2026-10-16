import { Checkpoint } from "@floor/contract";
import { Context, Schema } from "effect";
import type { Effect } from "effect";
import { ConstructionError } from "../error";

export const PoolReading = Schema.Struct({
  address: Schema.String,
  config: Schema.String,
  baseMint: Schema.String,
  quoteMint: Schema.String,
  baseVault: Schema.String,
  quoteVault: Schema.String,
  baseReserve: Schema.BigIntFromString,
  quoteReserve: Schema.BigIntFromString,
  sqrtPrice: Schema.BigIntFromString,
  slot: Schema.BigIntFromString,
  checkpoint: Checkpoint,
});
export type PoolReading = typeof PoolReading.Type;

export class SolanaReader extends Context.Service<SolanaReader, {
  readonly getPool: (pool: string) => Effect.Effect<PoolReading, ConstructionError>;
}>()("@floor/chains/SolanaReader") {}
