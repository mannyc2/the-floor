import type { KitPart, KitPartUpdate } from "@floor/kit";
import { Array, Option, Schema } from "effect";
import {
  type AtlasLayout,
  drawMarket,
  type MarketDrawing,
  marketLabel,
  type MarketPosition,
  type ReceiptStamp,
  type StallSpan,
} from "./layout";
import { AtlasMarket } from "./types";

const equalMarket = Schema.toEquivalence(AtlasMarket);
const equalId = Option.makeEquivalence<string>((left, right) => left === right);
export const marketPartKey = (marketId: string, index: number): string => `market:${marketId}:part:${index}`;
interface CachedMarket {
  readonly position: MarketPosition;
  readonly drawing: MarketDrawing;
}
export interface MarketCache {
  readonly prefix: readonly KitPart[];
  readonly suffix: readonly KitPart[];
  readonly order: readonly string[];
  readonly markets: Map<string, CachedMarket>;
  readonly marketIndexes: ReadonlyMap<string, number>;
  readonly keys: readonly string[];
}
interface MarketChange extends CachedMarket {
  readonly marketId: string;
}
export interface MarketUpdate {
  readonly activeId: Option.Option<string>;
  readonly changes: readonly MarketChange[];
  readonly parts: readonly KitPartUpdate[];
}

/** The cache owns GPU addresses only; every accepted snapshot still replaces the corresponding observations. */
export function cacheMarkets(layout: AtlasLayout, markets: readonly AtlasMarket[]): MarketCache {
  const first = Option.map(Array.head(layout.marketSpans), span => span.start);
  const last = Option.map(Array.last(layout.marketSpans), span => span.start + span.count);
  const positions = new Map(layout.markets.map(position => [position.market.id, position]));
  const drawings = new Map(layout.marketDrawings.map(drawing => [drawing.marketId, drawing]));
  const keys = layout.parts.map((_part, index) => `static:${index}`);
  const cached = new Map<string, CachedMarket>();
  for (const span of layout.marketSpans) {
    const position = positions.get(span.marketId);
    const drawing = drawings.get(span.marketId);
    if (!position || !drawing) continue;
    cached.set(span.marketId, { position, drawing });
    for (let index = 0; index < span.count; index++) keys[span.start + index] = marketPartKey(span.marketId, index);
  }
  return {
    prefix: layout.parts.slice(0, Option.getOrElse(first, () => layout.parts.length)),
    suffix: Option.match(last, { onNone: () => [], onSome: end => layout.parts.slice(end) }),
    order: layout.marketSpans.map(span => span.marketId),
    markets: cached,
    keys,
    marketIndexes: new Map(markets.map((market, index) => [market.id, index])),
  };
}

function changedMarkets(
  previous: readonly AtlasMarket[],
  next: readonly AtlasMarket[],
): Option.Option<Map<string, AtlasMarket>> {
  if (previous.length !== next.length) return Option.none();
  const changed = new Map<string, AtlasMarket>();
  for (let index = 0; index < previous.length; index++) {
    const before = previous[index];
    const after = next[index];
    if (!before || !after || before.id !== after.id) return Option.none();
    if (before === after || equalMarket(before, after)) continue;
    // Figure placement and design eligibility depend on these identities, rather than the reading instruments.
    if (before.agentCount !== after.agentCount || before.source !== after.source || before.kind !== after.kind) {
      return Option.none();
    }
    changed.set(before.id, after);
  }
  return Option.some(changed);
}

const geometryChanged = (cached: CachedMarket, market: AtlasMarket, wasActive: boolean, active: boolean): boolean => {
  if (cached.drawing.detail === "hidden") return false;
  if (wasActive !== active) return true;
  if (cached.drawing.detail === "silhouette") return false;
  if (cached.drawing.detail === "stall") {
    return market.liquidityUsd !== cached.position.market.liquidityUsd || market.stale !== cached.position.market.stale;
  }
  return true;
};

export function planMarketUpdate(
  layout: AtlasLayout,
  previous: readonly AtlasMarket[],
  next: readonly AtlasMarket[],
  requestedActive: Option.Option<string>,
  cache: MarketCache,
): Option.Option<MarketUpdate> {
  const updates = changedMarkets(previous, next);
  if (Option.isNone(updates)) return Option.none();
  const lookup = (id: string): Option.Option<AtlasMarket> =>
    Option.flatMap(
      Option.fromUndefinedOr(cache.marketIndexes.get(id)),
      index => Option.fromUndefinedOr(next[index]),
    );
  const activeId = Option.filter(requestedActive, id => Option.exists(lookup(id), market => !market.stale));
  if (!equalId(activeId, layout.activeId)) {
    for (const id of [...Option.toArray(layout.activeId), ...Option.toArray(activeId)]) {
      const market = lookup(id);
      if (Option.isNone(market)) return Option.none();
      updates.value.set(id, market.value);
    }
  }
  const changes: MarketChange[] = [];
  const parts: KitPartUpdate[] = [];
  for (const [marketId, market] of updates.value) {
    const cached = cache.markets.get(marketId);
    if (!cached) return Option.none();
    const position = { ...cached.position, market };
    const redraw = geometryChanged(
      cached,
      market,
      Option.contains(layout.activeId, marketId),
      Option.contains(activeId, marketId),
    );
    const drawing = redraw
      ? drawMarket(position, cached.drawing.detail, layout.drawingOptions, Option.contains(activeId, marketId))
      : cached.drawing;
    changes.push({ marketId, position, drawing });
    if (drawing !== cached.drawing) {
      for (let index = 0; index < Math.max(drawing.parts.length, cached.drawing.parts.length); index++) {
        parts.push({ key: marketPartKey(marketId, index), part: Option.fromUndefinedOr(drawing.parts[index]) });
      }
    }
  }
  return Option.some({ activeId, changes, parts });
}

/** Buffer acceptance precedes the complete layout commit, so capture, picking, traces and latest readings stay consistent. */
export function commitMarketUpdate(layout: AtlasLayout, cache: MarketCache, update: MarketUpdate): AtlasLayout {
  const positions = new Map(update.changes.map(change => [change.marketId, change.position]));
  for (const change of update.changes) cache.markets.set(change.marketId, change);
  const parts = [...cache.prefix];
  const marketSpans: StallSpan[] = [];
  const stallSpans: StallSpan[] = [];
  const marketDrawings: MarketDrawing[] = [];
  const paths = [...layout.staticPaths];
  const receiptStamps: ReceiptStamp[] = [];
  for (const marketId of cache.order) {
    const market = cache.markets.get(marketId);
    if (!market) continue;
    const span = { marketId, start: parts.length, count: market.drawing.parts.length };
    marketSpans.push(span);
    if (market.position.tier === "stall") stallSpans.push(span);
    marketDrawings.push(market.drawing);
    for (const part of market.drawing.parts) parts.push(part);
    for (const path of market.drawing.paths) paths.push(path);
    for (const stamp of market.drawing.receiptStamps) receiptStamps.push(stamp);
  }
  for (const part of cache.suffix) parts.push(part);
  return {
    ...layout,
    parts,
    marketSpans,
    stallSpans,
    marketDrawings,
    paths,
    receiptStamps,
    activeId: update.activeId,
    markets: layout.markets.map(position => positions.get(position.market.id) ?? position),
    labels: layout.labels.map(label => {
      const position = positions.get(label.id);
      return position ? marketLabel(position, layout.labelOptions) : label;
    }),
  };
}
