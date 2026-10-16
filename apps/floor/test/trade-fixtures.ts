import { WorldPublisher, WorldPublishError } from "@floor/api/world";
import { Signer } from "@floor/chains/signer";
import { PoolReading, SolanaReader } from "@floor/chains/solana/reader";
import { PositiveUsd } from "@floor/contract/agents";
import { PolicyDecision, Receipt, ReceiptCause, SwapIntent } from "@floor/contract/economics";
import {
  AgentId,
  AssetRef,
  ChainRef,
  Checkpoint,
  DeskId,
  Digest,
  Height,
  IntentId,
  OwnerId,
  PolicyId,
  ReceiptId,
  WorldEventId,
  WorldId,
} from "@floor/contract/identifiers";
import { WorldEvent } from "@floor/contract/world-events";
import { ScriptedModel, ScriptedStreamTurn } from "@yielded/agent-testing/scripted-model";
import { BigDecimal, DateTime, Effect, Layer, Option, Ref, Schema } from "effect";
import { TradeMandate } from "../src/agents/mandate";
import { AgentModel } from "../src/agents/models";

const chain = ChainRef.make("solana:synthetic");
const checkpoint = Checkpoint.make({
  chain,
  height: Height.make("100"),
  hash: Digest.make("synthetic-block"),
  time: DateTime.makeUnsafe("2026-10-15T12:00:00Z"),
});
export const tradeInput = TradeMandate.make({
  world: WorldId.make("synthetic-world"),
  mandate: {
    instructions: "Read this synthetic pool, then submit the single bounded swap.",
    capabilities: ["research", "trade"],
    updatedAt: checkpoint.time,
  },
  pool: "synthetic-pool",
  checkpoint,
  intent: SwapIntent.make({
    id: IntentId.make("synthetic-intent"),
    agent: AgentId.make("synthetic-agent"),
    owner: OwnerId.make("synthetic-owner"),
    chain,
    requestedAt: checkpoint.time,
    sell: AssetRef.make(`${chain}/token:quote`),
    buy: AssetRef.make(`${chain}/token:base`),
    dollars: PositiveUsd.make(BigDecimal.make(1n, 0)),
    slippageCap: 0.01,
  }),
});
export const poolReading = PoolReading.make({
  address: tradeInput.pool,
  config: "synthetic-config",
  baseMint: "base",
  quoteMint: "quote",
  baseVault: "synthetic-base-vault",
  quoteVault: "synthetic-quote-vault",
  baseReserve: 100000n,
  quoteReserve: 200000n,
  sqrtPrice: 1n,
  slot: 101n,
  checkpoint: Checkpoint.make({ ...checkpoint, height: Height.make("101"), hash: Digest.make("synthetic-read-block") }),
});
export const refusedReceipt = Receipt.cases.RefusedReceipt.make({
  id: ReceiptId.make("synthetic-receipt"),
  action: tradeInput.intent,
  recordedAt: checkpoint.time,
  causes: [
    ReceiptCause.cases.OwnerRequest.make({ owner: tradeInput.intent.owner, request: Digest.make("synthetic-request") }),
  ],
  policy: PolicyDecision.cases.Unconfirmed.make({ policy: PolicyId.make("synthetic-policy") }),
  refusal: { code: "policyUnconfirmed", detail: "Synthetic policy refusal used only by local tests" },
});

export const toolTurn = (name: "read_pool" | "submit_intent", params: Schema.Json = {}) => ({ name, params });
export const tradeModel = (
  turns: ReadonlyArray<ReturnType<typeof toolTurn>>,
  onStreamStart: Effect.Effect<void> = Effect.void,
) =>
  Layer.succeed(
    AgentModel,
    AgentModel.of({
      provider: "scripted",
      name: "floor-first-trade-test",
      layer: ScriptedModel.layer(turns.map(({ name, params }, index) => ({
        ...ScriptedStreamTurn.make({
          parts: [
            { type: "tool-call", id: `synthetic-${index}-${name}`, name, params },
            { type: "finish", reason: "tool-calls", usage: { inputTokens: {}, outputTokens: {} } },
          ],
          termination: Schema.TaggedStruct("Complete", {}).make({}),
        }),
        onStreamStart,
      }))),
    }),
  );

export const makeTradeHarness = Effect.fn("makeTradeHarness")(function*(options: {
  readonly reading?: PoolReading;
  readonly receipt?: Receipt;
  readonly idleFailure?: WorldPublishError;
} = {}) {
  const events = yield* Ref.make<ReadonlyArray<WorldEvent>>([]);
  const submissions = yield* Ref.make<ReadonlyArray<SwapIntent>>([]);
  const reads = yield* Ref.make<ReadonlyArray<string>>([]);
  const record = Effect.fnUntraced(function*(event: WorldEvent) {
    yield* Ref.update(events, (current) => [...current, event]);
    return event;
  });
  const stamp = Effect.fnUntraced(function*(input: { readonly world: WorldId; readonly checkpoint: Checkpoint }) {
    return { ...input, id: WorldEventId.make(`synthetic-event-${(yield* Ref.get(events)).length}`) };
  });
  const layer = Layer.mergeAll(
    Layer.succeed(
      SolanaReader,
      SolanaReader.of({
        getPool: Effect.fnUntraced(function*(pool) {
          yield* Ref.update(reads, (current) => [...current, pool]);
          return options.reading ?? poolReading;
        }),
      }),
    ),
    Layer.succeed(
      Signer,
      Signer.of({
        submit: Effect.fnUntraced(function*(intent) {
          yield* Ref.update(submissions, (current) => [...current, intent]);
          return options.receipt ?? refusedReceipt;
        }),
        settle: () => Effect.succeed(options.receipt ?? refusedReceipt),
      }),
    ),
    Layer.succeed(
      WorldPublisher,
      WorldPublisher.of({
        join: Effect.fnUntraced(function*(input) {
          return yield* record(
            WorldEvent.cases.AgentJoined.make({
              ...yield* stamp(input),
              agent: input.agent,
              desk: DeskId.make("synthetic-desk"),
            }),
          );
        }),
        state: Effect.fnUntraced(function*(input) {
          if (input.state === "idle" && options.idleFailure) return yield* options.idleFailure;
          return yield* record(
            WorldEvent.cases.AgentStateChanged.make({ ...yield* stamp(input), agent: input.agent, state: input.state }),
          );
        }),
        receipt: Effect.fnUntraced(function*(input) {
          return yield* record(
            WorldEvent.cases.ReceiptLanded.make({
              ...yield* stamp(input),
              agent: input.agent,
              receipt: input.receipt.id,
            }),
          );
        }),
        move: Effect.fnUntraced(function*(input) {
          return yield* record(
            WorldEvent.cases.AgentMoved.make({
              ...yield* stamp(input),
              agent: input.agent,
              from: Option.none(),
              to: input.location,
            }),
          );
        }),
      }),
    ),
  );
  return { layer, events, submissions, reads };
});
