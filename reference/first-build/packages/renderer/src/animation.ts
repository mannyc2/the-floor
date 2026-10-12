import { defaults, type DriverExpression } from "@floor/contract";
import type { KitPartUpdate } from "@floor/kit";
import { Option } from "effect";
import { type MarketCache, marketPartKey, type MarketUpdate } from "./incremental";
import { type AtlasLayout, drawMarket } from "./layout";

const usesTime = (expression: DriverExpression): boolean =>
  expression.op === "time" || ("args" in expression && expression.args.some(usesTime));

/** Camera culling and reduced motion decide whether the renderer has an animation clock to advance at all. */
export const animatedDesignMarkets = (
  layout: AtlasLayout,
  cache: MarketCache,
  reducedMotion: boolean,
): readonly string[] =>
  reducedMotion
    ? []
    : layout.drawingOptions.adoptedDesigns.filter(adoption =>
      cache.markets.get(adoption.marketId)?.drawing.detail === "instrument"
      && adoption.design.drivers.some(driver => usesTime(driver.expression))
    ).map(adoption => adoption.marketId);

export const designAnimationDue = (previous: number, now: number): boolean =>
  now - previous >= 1000 / defaults.maxUpdatesPerSecond;

/** Only bounded, visible adopted models change pose; observations, brass, paths and source timestamps remain fixed. */
export function planDesignAnimation(
  layout: AtlasLayout,
  cache: MarketCache,
  ids: readonly string[],
  seconds: number,
): MarketUpdate {
  const changes: MarketUpdate["changes"][number][] = [];
  const parts: KitPartUpdate[] = [];
  for (const marketId of ids) {
    const cached = cache.markets.get(marketId);
    if (!cached || cached.drawing.detail !== "instrument") continue;
    const drawing = drawMarket(
      cached.position,
      cached.drawing.detail,
      { ...layout.drawingOptions, seconds },
      Option.contains(layout.activeId, marketId),
    );
    changes.push({ marketId, position: cached.position, drawing });
    for (const [index, part] of drawing.parts.entries()) {
      parts.push({ key: marketPartKey(marketId, index), part: Option.some(part) });
    }
  }
  return { activeId: layout.activeId, changes, parts };
}

/** GPU poses are display state; retaining the phase makes the next measured update use the same time coordinate. */
export function commitDesignAnimation(
  layout: AtlasLayout,
  cache: MarketCache,
  update: MarketUpdate,
  seconds: number,
): AtlasLayout {
  for (const change of update.changes) cache.markets.set(change.marketId, change);
  return { ...layout, drawingOptions: { ...layout.drawingOptions, seconds } };
}
