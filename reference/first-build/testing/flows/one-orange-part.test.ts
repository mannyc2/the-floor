import { assert, it } from "@effect/vitest";
import { chooseOrange } from "@floor/districts";
import { createLayout } from "@floor/renderer/layout";
import { atlasMarket } from "@floor/renderer/market-view";
import { Effect, Option } from "effect";
import { Atlas } from "../../packages/server/src/atlas";
import { recordedFloor } from "./_fixtures/recorded-floor";

it.layer(recordedFloor)("one orange part", test => {
  test.effect("uses the same observed movement leader in the server snapshot and machine geometry", () =>
    Effect.gen(function*() {
      const atlas = yield* Atlas;
      yield* atlas.refresh;
      const state = yield* atlas.snapshot(Option.none());
      const measured = state.market.markets.flatMap(market =>
        Option.match(Option.fromNullishOr(market.valueMovingUsd), {
          onNone: () => [],
          onSome: valueMoving => [{ id: market.id, valueMoving }],
        })
      );
      const chosen = chooseOrange(measured);
      assert.isTrue(Option.isSome(chosen));
      assert.deepStrictEqual(Option.fromNullishOr(state.activeMarketId), chosen);
      const layout = createLayout(state.market.markets.map(atlasMarket), {
        lens: "flow",
        moorings: new Set(),
        explodedId: Option.none(),
        activeMarketId: chosen,
        slots: state.slots,
        tiers: state.tiers,
      });
      assert.deepStrictEqual(layout.activeId, chosen);
      assert.strictEqual(layout.parts.filter(part => part.material === "accent").length, 1);
      assert.isTrue(Option.isNone(chooseOrange(measured.map(market => ({ ...market, valueMoving: 0 })))));
    }));
});
