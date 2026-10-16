import { SwapIntent } from "@floor/contract/economics";
import { AssetRef, IntentId } from "@floor/contract/identifiers";
import * as Test from "alchemy/Test/Bun";
import { expect } from "bun:test";
import { Cause, Deferred, Effect, Exit, Fiber, Layer, Ref, Schema } from "effect";
import { TestClock } from "effect/testing";
import { FirstAgent } from "../src/agents/mandate";
import { makeTradeHarness, poolReading, refusedReceipt, toolTurn, tradeInput, tradeModel } from "./trade-fixtures";

const { test } = Test.make({ providers: Layer.empty, dev: true, sidecar: false });
const encodedIntent = Schema.encodeEffect(SwapIntent)(tradeInput.intent);

test(
  "scripted mandate reads the pool, submits the exact intent and publishes the actual refusal",
  Effect.gen(function*() {
    const harness = yield* makeTradeHarness();
    const receipt = yield* FirstAgent.use((agent) => agent.run(tradeInput)).pipe(Effect.provide(FirstAgent.layer.pipe(
      Layer.provide(
        Layer.merge(
          harness.layer,
          tradeModel([toolTurn("read_pool"), toolTurn("submit_intent", { intent: yield* encodedIntent })]),
        ),
      ),
    )));
    expect(receipt).toEqual(refusedReceipt);
    expect(yield* Ref.get(harness.reads)).toEqual([tradeInput.pool]);
    expect(yield* Ref.get(harness.submissions)).toEqual([tradeInput.intent]);
    const events = yield* Ref.get(harness.events);
    expect(events.map((event) => event._tag === "AgentStateChanged" ? event.state : event._tag)).toEqual([
      "AgentJoined",
      "researching",
      "trading",
      "ReceiptLanded",
      "idle",
    ]);
    expect(events.at(-1)?.checkpoint).toEqual(poolReading.checkpoint);
  }),
);

test(
  "mandate refuses submission before a pool read",
  Effect.gen(function*() {
    const harness = yield* makeTradeHarness();
    const result = yield* FirstAgent.use((agent) => agent.run(tradeInput)).pipe(
      Effect.provide(FirstAgent.layer.pipe(
        Layer.provide(
          Layer.merge(harness.layer, tradeModel([toolTurn("submit_intent", { intent: yield* encodedIntent })])),
        ),
      )),
      Effect.exit,
    );
    expect(Exit.isFailure(result)).toBe(true);
    expect(yield* Ref.get(harness.submissions)).toHaveLength(0);
    expect(
      (yield* Ref.get(harness.events)).map((event) => event._tag === "AgentStateChanged" ? event.state : event._tag),
    ).toEqual(["AgentJoined", "researching", "idle"]);
  }),
);

test(
  "mandate rejects model changes to intent authority",
  Effect.gen(function*() {
    const harness = yield* makeTradeHarness();
    const altered = yield* Schema.encodeEffect(SwapIntent)({
      ...tradeInput.intent,
      id: IntentId.make("another-intent"),
    });
    const result = yield* FirstAgent.use((agent) => agent.run(tradeInput)).pipe(
      Effect.provide(FirstAgent.layer.pipe(
        Layer.provide(
          Layer.merge(
            harness.layer,
            tradeModel([toolTurn("read_pool"), toolTurn("submit_intent", { intent: altered })]),
          ),
        ),
      )),
      Effect.exit,
    );
    expect(Exit.isFailure(result)).toBe(true);
    expect(yield* Ref.get(harness.submissions)).toHaveLength(0);
  }),
);

test(
  "mandate rejects a reader's unrelated assets",
  Effect.gen(function*() {
    const harness = yield* makeTradeHarness({ reading: { ...poolReading, baseMint: "unrelated" } });
    const result = yield* FirstAgent.use((agent) => agent.run(tradeInput)).pipe(
      Effect.provide(FirstAgent.layer.pipe(
        Layer.provide(Layer.merge(harness.layer, tradeModel([toolTurn("read_pool")]))),
      )),
      Effect.exit,
    );
    expect(Exit.isFailure(result)).toBe(true);
    expect(yield* Ref.get(harness.submissions)).toHaveLength(0);
  }),
);

test(
  "mandate never publishes a receipt for another action",
  Effect.gen(function*() {
    const harness = yield* makeTradeHarness({
      receipt: {
        ...refusedReceipt,
        action: { ...tradeInput.intent, buy: AssetRef.make(`${tradeInput.intent.chain}/token:unrelated`) },
      },
    });
    const result = yield* FirstAgent.use((agent) => agent.run(tradeInput)).pipe(
      Effect.provide(FirstAgent.layer.pipe(
        Layer.provide(
          Layer.merge(
            harness.layer,
            tradeModel([toolTurn("read_pool"), toolTurn("submit_intent", { intent: yield* encodedIntent })]),
          ),
        ),
      )),
      Effect.exit,
    );
    expect(Exit.isFailure(result)).toBe(true);
    expect((yield* Ref.get(harness.events)).some((event) => event._tag === "ReceiptLanded")).toBe(false);
  }),
);

test(
  "mandate stops at its tool budget instead of making a third call",
  Effect.gen(function*() {
    const harness = yield* makeTradeHarness();
    const result = yield* FirstAgent.use((agent) => agent.run(tradeInput)).pipe(
      Effect.provide(FirstAgent.layer.pipe(
        Layer.provide(
          Layer.merge(harness.layer, tradeModel([toolTurn("read_pool"), toolTurn("read_pool"), toolTurn("read_pool")])),
        ),
      )),
      Effect.exit,
    );
    expect(Exit.isFailure(result)).toBe(true);
    expect(Exit.isFailure(result) ? Cause.pretty(result.cause) : "").toContain("exceeded its 2 Tool Call limit");
    expect(yield* Ref.get(harness.reads)).toHaveLength(2);
    expect(yield* Ref.get(harness.submissions)).toHaveLength(0);
  }),
);

test(
  "mandate interrupts a model at its duration limit and clears its activity",
  Effect.gen(function*() {
    const harness = yield* makeTradeHarness();
    const started = yield* Deferred.make<void>();
    const model = tradeModel(
      [toolTurn("read_pool")],
      Deferred.done(started, Exit.void).pipe(Effect.andThen(Effect.never)),
    );
    const running = yield* FirstAgent.use((agent) => agent.run(tradeInput)).pipe(
      Effect.provide(FirstAgent.layer.pipe(Layer.provide(Layer.merge(harness.layer, model)))),
      Effect.forkChild,
    );
    yield* Deferred.await(started);
    yield* TestClock.adjust("31 seconds");
    const result = yield* Fiber.await(running);
    expect(Exit.isFailure(result)).toBe(true);
    expect(Exit.isFailure(result) ? Cause.pretty(result.cause) : "").toContain("duration");
    expect(yield* Ref.get(harness.reads)).toHaveLength(0);
    const last = (yield* Ref.get(harness.events)).at(-1);
    expect(last?._tag === "AgentStateChanged" ? last.state : last?._tag).toBe("idle");
  }).pipe(Effect.provide(TestClock.layer())),
);

test(
  "cancelling a mandate clears its visible activity before interruption returns",
  Effect.gen(function*() {
    const harness = yield* makeTradeHarness();
    const started = yield* Deferred.make<void>();
    const model = tradeModel(
      [toolTurn("read_pool")],
      Deferred.done(started, Exit.void).pipe(Effect.andThen(Effect.never)),
    );
    const running = yield* FirstAgent.use((agent) => agent.run(tradeInput)).pipe(
      Effect.provide(FirstAgent.layer.pipe(Layer.provide(Layer.merge(harness.layer, model)))),
      Effect.forkChild,
    );
    yield* Deferred.await(started);
    yield* Fiber.interrupt(running);
    expect(yield* Ref.get(harness.submissions)).toHaveLength(0);
    const last = (yield* Ref.get(harness.events)).at(-1);
    expect(last?._tag === "AgentStateChanged" ? last.state : last?._tag).toBe("idle");
  }),
);

test(
  "a cleanup failure preserves the original execution failure",
  Effect.gen(function*() {
    const harness = yield* makeTradeHarness({
      idleFailure: new WorldPublishError({
        world: tradeInput.world,
        operation: "state",
        cause: "Synthetic cleanup unavailable",
      }),
    });
    const result = yield* FirstAgent.use((agent) => agent.run(tradeInput)).pipe(
      Effect.provide(FirstAgent.layer.pipe(Layer.provide(Layer.merge(
        harness.layer,
        tradeModel([toolTurn("submit_intent", { intent: yield* encodedIntent })]),
      )))),
      Effect.exit,
    );
    expect(Exit.isFailure(result)).toBe(true);
    const failure = Exit.isFailure(result) ? Cause.pretty(result.cause) : "";
    expect(failure).toContain("The pool must be read before submitting an intent");
    expect(failure).toContain("Synthetic cleanup unavailable");
  }),
);

test(
  "a mandate without trade capability never starts a model or publishes activity",
  Effect.gen(function*() {
    const harness = yield* makeTradeHarness();
    const result = yield* FirstAgent.use((agent) =>
      agent.run({
        ...tradeInput,
        mandate: { ...tradeInput.mandate, capabilities: ["research"] },
      })
    ).pipe(
      Effect.provide(FirstAgent.layer.pipe(Layer.provide(Layer.merge(harness.layer, tradeModel([]))))),
      Effect.exit,
    );
    expect(Exit.isFailure(result)).toBe(true);
    expect(yield* Ref.get(harness.events)).toHaveLength(0);
    expect(yield* Ref.get(harness.submissions)).toHaveLength(0);
  }),
);
import { WorldPublishError } from "@floor/api/world";
