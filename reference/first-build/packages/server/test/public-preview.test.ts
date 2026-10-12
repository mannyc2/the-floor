import { assert, it } from "@effect/vitest";
import { Agent, defaultPolicy } from "@floor/contract";
import type { PlateRenderInput } from "@floor/renderer/plate";
import { Context, Effect, Exit, Layer, Option, Ref } from "effect";
import { recordedFloor } from "../../../testing/flows/_fixtures/recorded-floor";
import { Atlas } from "../src/atlas";
import { PlateRenderer } from "../src/plate-renderer";
import { PublicPreviews } from "../src/public-preview";
import { FloorDatabase } from "../src/store";

class Captures extends Context.Service<Captures, Ref.Ref<readonly PlateRenderInput[]>>()("test/PreviewCaptures") {}
const captures = Layer.effect(Captures, Ref.make<readonly PlateRenderInput[]>([]));
// Browser pixels have their own real Chromium flow; this boundary records exactly what public preview caching may render.
const renderEdge = Layer.effect(
  PlateRenderer,
  Effect.gen(function*() {
    const inputs = yield* Captures;
    return PlateRenderer.of({
      render: input => Ref.update(inputs, values => [...values, input]).pipe(Effect.as("data:image/png;base64,AA==")),
    });
  }),
).pipe(Layer.provideMerge(captures));
const dependencies = PublicPreviews.layer.pipe(Layer.provideMerge(renderEdge), Layer.provideMerge(recordedFloor));

it.layer(dependencies)("public image previews", test => {
  test.effect("renders a retained source once and rechecks desk privacy before serving a cache hit", () =>
    Effect.gen(function*() {
      const previews = yield* PublicPreviews;
      const db = yield* FloorDatabase;
      const inputs = yield* Captures;
      const snapshot = yield* (yield* Atlas).snapshot(Option.none());
      const market = yield* Effect.fromOption(Option.fromUndefinedOr(snapshot.market.markets[0]));
      // oxlint-disable-next-line effect/noNullish -- Owner and account transport contracts persist absent addresses and modifiers as null.
      const absent = null;
      yield* db.owners.insert({ id: "preview-owner", walletAddress: absent, mode: "local" });
      const agent = Agent.make({
        id: "preview-agent",
        owner: "preview-owner",
        name: "Public Wren",
        emblem: { shape: "circle", modifier: absent },
        walletAddress: absent,
        mandate: "Private instructions",
        policy: defaultPolicy,
        visibility: "public",
        publishMandate: false,
        paused: true,
        state: "asleep",
        budget: { dailyUsd: 10, spentUsd: 0, day: "2026-01-01" },
        districtId: "base",
        createdAt: snapshot.market.blockTimestamp,
      });
      yield* db.agents.insert(agent);
      yield* previews.image("market", market.id, snapshot.market.blockNumber);
      yield* previews.image("market", market.id, snapshot.market.blockNumber);
      assert.strictEqual((yield* Ref.get(inputs)).length, 1);
      const captured = yield* Effect.fromOption(Option.fromUndefinedOr((yield* Ref.get(inputs))[0]));
      assert.strictEqual(captured.snapshot.market.blockHash, snapshot.market.blockHash);
      assert.deepStrictEqual(captured.snapshot.tiers, snapshot.tiers);
      yield* previews.image("agent", agent.id, snapshot.market.blockNumber);
      yield* previews.image("agent", agent.id, snapshot.market.blockNumber);
      assert.strictEqual((yield* Ref.get(inputs)).length, 2);
      const desk = yield* previews.describe("agent", agent.id, Option.none());
      assert.isTrue(Option.exists(desk.desk, value => Option.isNone(value.agent.publishedMandate)));
      yield* db.agents.update({ ...agent, visibility: "private" });
      assert.isTrue(Exit.isFailure(yield* Effect.exit(previews.image("agent", agent.id, snapshot.market.blockNumber))));
      assert.isTrue(Exit.isFailure(yield* Effect.exit(previews.describe("agent", agent.id, Option.none()))));
      assert.strictEqual((yield* Ref.get(inputs)).length, 2);
    }));
});
