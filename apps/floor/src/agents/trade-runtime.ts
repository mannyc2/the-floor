import { WorldPublisher } from "@floor/api/world";
import { Signer } from "@floor/chains/signer";
import { SolanaReader } from "@floor/chains/solana/reader";
import { Receipt } from "@floor/contract/economics";
import { IntentId } from "@floor/contract/identifiers";
import { DurableObject } from "alchemy/Cloudflare/Workers/DurableObject";
import { Effect, Layer, Schema, Semaphore } from "effect";
import { AgentTradeError, FirstAgent, TradeMandate } from "./mandate";
import { AgentModel } from "./models";

const MandateJson = Schema.toCodecJson(TradeMandate);
const ReceiptJson = Schema.toCodecJson(Receipt);
interface TraderRpc {
  readonly run: (intent: IntentId, input: Schema.Json) => Effect.Effect<Schema.Json, AgentTradeError>;
}
class FloorTraders extends DurableObject<FloorTraders, TraderRpc>()("FLOOR_TRADERS", { errors: [AgentTradeError] }) {}

/** One object serializes a Floor agent's mandates; the signer's journal owns transaction recovery. */
export const makeFirstAgentRuntime = <E>(dependencies: Layer.Layer<AgentModel | Signer | SolanaReader, E>) => {
  const objects = FloorTraders.make(Effect.gen(function*() {
    const publisher = yield* WorldPublisher;
    return yield* Effect.succeed(
      Effect.gen(function*() {
        const turns = yield* Semaphore.make(1);
        return {
          run: (intent: IntentId, encoded: Schema.Json) =>
            turns.withPermit(
              Effect.gen(function*() {
                const agent = yield* FirstAgent;
                const input = yield* Schema.decodeEffect(MandateJson)(encoded);
                return yield* agent.run(input);
              }).pipe(
                Effect.flatMap(Schema.encodeEffect(ReceiptJson)),
                Effect.mapError((cause) => new AgentTradeError({ intent, operation: "run", cause })),
                // oxlint-disable-next-line effecttsgo/strict-effect-provide -- Each RPC owns its client and model resources; Alchemy closes the initializer scope before invoking handlers.
                Effect.provide(
                  FirstAgent.layer.pipe(
                    Layer.provide(Layer.merge(dependencies, Layer.succeed(WorldPublisher, publisher))),
                    Layer.orDie,
                  ),
                ),
              ),
            ),
        };
      }),
    );
  }));
  return Layer.effect(
    FirstAgent,
    Effect.gen(function*() {
      const traders = yield* FloorTraders;
      return FirstAgent.of({
        run: Effect.fn("FirstAgent.remoteRun")(function*(input) {
          const encoded = yield* Schema.encodeEffect(MandateJson)(input);
          return yield* traders.getByName(input.intent.agent).run(input.intent.id, encoded).pipe(
            Effect.flatMap(Schema.decodeEffect(ReceiptJson)),
          );
        }, (effect, input) =>
          effect.pipe(
            Effect.mapError((cause) => new AgentTradeError({ intent: input.intent.id, operation: "run", cause })),
          )),
      });
    }),
  ).pipe(Layer.provide(objects));
};
