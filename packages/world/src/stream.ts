import { ActionIntent, Receipt, ReceiptCause } from "@floor/contract/economics";
import { Checkpoint, TransactionRef } from "@floor/contract/identifiers";
import { WorldChangeError } from "@floor/contract/world";
import { WorldEvent } from "@floor/contract/world-events";
import { WorldSnapshot } from "@floor/contract/world-stream";
import { DateTime, Effect, Option, Schema } from "effect";
import { allStations, assignAgent } from "./index";

// The chain checkpoint belongs to the evidence. The SQL sequence belongs to
// delivery order; two state changes at one chain checkpoint remain distinct.
export const foldWorldEvent = Effect.fn("foldWorldEvent")(function*(
  snapshot: typeof WorldSnapshot.Type,
  event: WorldEvent,
  receipt: Option.Option<Receipt> = Option.none(),
) {
  if (event.world !== snapshot.model.id || event.checkpoint.chain !== snapshot.chain) {
    return yield* new WorldChangeError({ reason: "wrongChain", reference: event.world });
  }
  if (event._tag === "AgentJoined") {
    const model = yield* Effect.fromResult(assignAgent(snapshot.model, event.agent, snapshot.chain));
    const station = allStations(model).find(item => item.desk.agentId === event.agent);
    if (station?.desk.id !== event.desk) {
      return yield* new WorldChangeError({ reason: "invalidTopology", reference: event.desk });
    }
    return WorldSnapshot.make({
      ...snapshot,
      model,
      sequence: snapshot.sequence + 1,
      checkpoint: Option.some(event.checkpoint),
      agents: [...snapshot.agents, { agent: event.agent, state: Option.none(), receipt: Option.none() }],
    });
  }
  if (event._tag !== "AgentStateChanged" && event._tag !== "ReceiptLanded") {
    return yield* new WorldChangeError({ reason: "invalidTopology", reference: event.id });
  }
  if (!snapshot.agents.some(agent => agent.agent === event.agent)) {
    return yield* new WorldChangeError({ reason: "unknownAgent", reference: event.agent });
  }
  if (event._tag === "ReceiptLanded") {
    if (
      Option.isNone(receipt) || receipt.value.id !== event.receipt
      || receipt.value.action.agent !== event.agent || receipt.value.action.chain !== snapshot.chain
      || (receipt.value._tag === "SettledReceipt"
        && !Schema.toEquivalence(Checkpoint)(receipt.value.checkpoint, event.checkpoint))
    ) {
      return yield* new WorldChangeError({ reason: "invalidTopology", reference: event.receipt });
    }
  }
  return WorldSnapshot.make({
    ...snapshot,
    sequence: snapshot.sequence + 1,
    checkpoint: Option.some(event.checkpoint),
    agents: snapshot.agents.map(agent =>
      agent.agent !== event.agent ? agent : {
        ...agent,
        state: event._tag === "AgentStateChanged" ? Option.some(event.state) : agent.state,
        receipt: event._tag === "ReceiptLanded" ? receipt : agent.receipt,
      }
    ),
  });
});

// Receipt identity survives a recheck. Once its outcome is terminal, a delayed
// retry cannot replace it; unresolved observations can only retain or add evidence.
export const assertReceiptEvolution = Effect.fn("assertReceiptEvolution")(function*(previous: Receipt, next: Receipt) {
  if (
    previous.id !== next.id || previous._tag !== "UnknownReceipt" || next._tag === "RefusedReceipt"
    || !Schema.toEquivalence(ActionIntent)(previous.action, next.action)
    || !Schema.toEquivalence(Receipt.cases.UnknownReceipt.fields.policy)(previous.policy, next.policy)
    || !Schema.toEquivalence(Schema.Array(ReceiptCause))(previous.causes, next.causes)
    || DateTime.Order(next.recordedAt, previous.recordedAt) < 0
  ) {
    return yield* new WorldChangeError({ reason: "invalidTopology", reference: next.id });
  }
  const transaction = next._tag === "SettledReceipt" ? Option.some(next.transaction) : next.transaction;
  const knownTransaction = previous.transaction;
  if (
    Option.isSome(knownTransaction)
    && !Option.exists(transaction, value => Schema.toEquivalence(TransactionRef)(knownTransaction.value, value))
  ) {
    return yield* new WorldChangeError({ reason: "invalidTopology", reference: next.id });
  }
  const checkedAt = previous.lastCheckedAt;
  if (
    next._tag === "UnknownReceipt" && (previous.submission !== next.submission
      || (Option.isSome(checkedAt)
        && !Option.exists(next.lastCheckedAt, time => DateTime.Order(time, checkedAt.value) >= 0)))
  ) {
    return yield* new WorldChangeError({ reason: "invalidTopology", reference: next.id });
  }
  return void 0;
});
