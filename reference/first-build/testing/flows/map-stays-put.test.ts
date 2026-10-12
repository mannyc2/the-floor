import { assert, it } from "@effect/vitest";
import { createLayout } from "@floor/renderer/layout";
import { atlasMarket } from "@floor/renderer/market-view";
import { Array, Effect, Option } from "effect";
import { Atlas } from "../../packages/server/src/atlas";
import { recordedFloor } from "./_fixtures/recorded-floor";

it.layer(recordedFloor)("map stays put", test => {
  test.effect("keeps authoritative slots across liquidity reversal, lenses, arrivals and removals", () =>
    Effect.gen(function*() {
      const atlas = yield* Atlas;
      yield* atlas.refresh;
      const state = yield* atlas.snapshot(Option.none());
      const markets = state.market.markets.map(atlasMarket);
      const options = {
        lens: "liquidity" as const,
        moorings: new Set<string>(),
        explodedId: Option.none<string>(),
        activeMarketId: Option.fromNullishOr(state.activeMarketId),
        slots: state.slots,
        tiers: state.tiers,
      };
      const before = createLayout(markets, options);
      const first = yield* Effect.fromOption(Array.head(markets));
      const newcomer = { ...first, id: "recorded-arrival", liquidityUsd: 1_000_000_000 };
      const changed = [
        ...markets.toReversed().map((market, index) => ({ ...market, liquidityUsd: (index + 1) * 1_000_000 })),
        newcomer,
      ];
      const slots = [...state.slots, { marketId: newcomer.id, slot: state.slots.length }];
      const after = createLayout(changed, { ...options, lens: "flow", slots });
      const removed = createLayout(changed.filter(market => market.id !== first.id), {
        ...options,
        lens: "risk",
        slots,
      });
      const positions = new Map(before.markets.map(item => [item.market.id, { x: item.x, z: item.z }]));
      for (const layout of [after, removed]) {
        for (const item of layout.markets) {
          const original = Option.fromUndefinedOr(positions.get(item.market.id));
          if (Option.isSome(original)) assert.deepStrictEqual({ x: item.x, z: item.z }, original.value);
        }
      }
    }));
});
