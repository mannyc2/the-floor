import { PoolReading } from "@floor/chains/solana/reader";
import { PositiveUsd } from "@floor/contract/agents";
import { SwapIntent } from "@floor/contract/economics";
import { AgentId, AssetRef, ChainRef, IntentId, OwnerId, WorldId } from "@floor/contract/identifiers";
import { Config, Effect, FileSystem, Schema } from "effect";
import { TradeMandate } from "../src/agents/mandate";

export const TradeConfiguration = Schema.Struct({
  mandate: TradeMandate,
  endpoint: Schema.NonEmptyString,
  signerUrl: Schema.NonEmptyString,
});
const ForkInfo = Schema.Struct({
  configuration: Schema.Struct({
    endpoint: Schema.NonEmptyString,
    agent: AgentId,
    owner: OwnerId,
    pool: Schema.NonEmptyString,
  }),
  reading: PoolReading,
  chain: ChainRef,
  signerUrl: Schema.NonEmptyString,
});

/** Consume only the public fork metadata; the signer remains the sole key holder. */
export const readTradeConfiguration = Effect.fn("firstTrade.readConfiguration")(function*(world: WorldId) {
  const path = yield* Config.schema(Schema.NonEmptyString, "FLOOR_FORK_INFO").pipe(
    Config.withDefault("work/first-trade/fork.json"),
  );
  const fs = yield* FileSystem.FileSystem;
  const info = yield* Schema.decodeEffect(Schema.fromJsonString(Schema.toCodecJson(ForkInfo)))(
    yield* fs.readFileString(path),
  );
  const checkpoint = info.reading.checkpoint;
  return TradeConfiguration.make({
    endpoint: info.configuration.endpoint,
    signerUrl: info.signerUrl,
    mandate: TradeMandate.make({
      world,
      pool: info.configuration.pool,
      checkpoint,
      mandate: {
        instructions: "Read the local fork pool, then submit the single bounded swap in this mandate.",
        capabilities: ["research", "trade"],
        updatedAt: checkpoint.time,
      },
      intent: SwapIntent.make({
        id: IntentId.make(`${world}-swap`),
        agent: info.configuration.agent,
        owner: info.configuration.owner,
        chain: info.chain,
        requestedAt: checkpoint.time,
        sell: AssetRef.make(`${info.chain}/token:${info.reading.quoteMint}`),
        buy: AssetRef.make(`${info.chain}/token:${info.reading.baseMint}`),
        dollars: yield* Schema.decodeEffect(PositiveUsd)("1"),
        slippageCap: 0.05,
      }),
    }),
  });
});
