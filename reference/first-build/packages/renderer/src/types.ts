import { AdoptedDesign, Note, PublicAgent, PublicReceipt } from "@floor/contract";
import type { MarketSlot, MarketTier } from "@floor/districts";
import type { AtlasTheme } from "@floor/kit";
import { Data, type Result, Schema } from "effect";

export type MarketKind = "constant-product" | "concentrated-liquidity" | "bonding-curve";
export const AtlasMarket = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  symbol: Schema.String,
  chainId: Schema.Int,
  protocol: Schema.String,
  kind: Schema.Literals(["constant-product", "concentrated-liquidity", "bonding-curve"]),
  baseSymbol: Schema.String,
  quoteSymbol: Schema.String,
  priceUsd: Schema.NullOr(Schema.Finite),
  priceQuote: Schema.optional(Schema.NullOr(Schema.Finite)),
  liquidityUsd: Schema.NullOr(Schema.Finite),
  volume24hUsd: Schema.NullOr(Schema.Finite),
  valueMovingUsd: Schema.optional(Schema.NullOr(Schema.Finite)),
  tradeCount: Schema.optional(Schema.NullOr(Schema.Int)),
  change24h: Schema.NullOr(Schema.Finite),
  verified: Schema.Boolean,
  stale: Schema.Boolean,
  reserve0: Schema.optional(Schema.NullOr(Schema.Finite)),
  reserve1: Schema.optional(Schema.NullOr(Schema.Finite)),
  bands: Schema.optional(
    Schema.Array(Schema.Struct({ lower: Schema.Finite, upper: Schema.Finite, liquidity: Schema.Finite })),
  ),
  progress: Schema.optional(Schema.NullOr(Schema.Finite)),
  priceHistory: Schema.optional(
    Schema.Array(
      Schema.Struct({ timestamp: Schema.Finite, price: Schema.Finite, volume: Schema.optional(Schema.Finite) }),
    ),
  ),
  agentCount: Schema.optional(Schema.Int),
  riskScore: Schema.optional(Schema.Finite),
  source: Schema.optional(Schema.Literals(["chain", "recording", "synthetic"])),
});
export type AtlasMarket = typeof AtlasMarket.Type;
export const AtlasEvidence = Schema.Struct({
  agents: Schema.Array(PublicAgent),
  receipts: Schema.Array(PublicReceipt),
  notes: Schema.Array(Note),
  observedAt: Schema.String,
  chainId: Schema.Int,
  blockNumber: Schema.Int,
});
export type AtlasEvidence = typeof AtlasEvidence.Type;
export type AtlasZoom = "archipelago" | "island" | "district" | "works" | "machine";
export type AtlasLens = "flow" | "liquidity" | "attention" | "risk" | "mine";
export interface AtlasView {
  readonly level: AtlasZoom;
  readonly zoom: number;
  readonly center: readonly [number, number];
  readonly selectedId: string | null;
}
export interface AtlasLabel {
  readonly id: string;
  readonly text: string;
  readonly kind: "island" | "district" | "market" | "landmark";
  readonly x: number;
  readonly y: number;
  readonly visible: boolean;
  readonly selected: boolean;
  readonly subtitle?: string | undefined;
}
export interface RendererStats {
  readonly framesPerSecond: number;
  readonly frameTimeMs: number;
  readonly drawCalls: number;
  readonly triangles: number;
  readonly parts: number;
  readonly markets: number;
  readonly detail: number;
  readonly orangeParts: number;
  readonly activeMarketId: string | null;
  readonly tierCounts: { readonly stall: number; readonly works: number; readonly tower: number };
  readonly instrumentTierCounts: { readonly stall: number; readonly works: number; readonly tower: number };
}
export interface AtlasRendererOptions {
  readonly onSelect?: (id: string) => void;
  readonly onHover?: (id: string | null) => void;
  readonly onViewChange?: (view: AtlasView) => void;
  readonly onLabels?: (labels: readonly AtlasLabel[]) => void;
  readonly onStats?: (stats: RendererStats) => void;
  readonly onFrame?: (frame: RendererFrame) => void;
  readonly onError?: (error: Error) => void;
  readonly allowSynthetic?: boolean;
}
/** GPU allocation counts are observable; their byte sizes are not exposed by WebGL. */
export interface RendererFrame {
  readonly revision: number;
  readonly renderedAtMs: number;
  readonly stats: RendererStats;
  readonly memory: { readonly geometries: number; readonly textures: number };
}
export class AtlasRendererError extends Data.TaggedError("AtlasRendererError")<{ readonly message: string }> {}

export interface AtlasRenderer {
  readonly canvas: HTMLCanvasElement;
  setData(
    data: {
      readonly markets: readonly AtlasMarket[];
      readonly activeMarketId?: string | null;
      readonly slots?: readonly MarketSlot[];
      readonly tiers?: readonly MarketTier[];
      readonly revision?: number;
      readonly evidence?: AtlasEvidence;
      readonly adoptedDesigns?: readonly AdoptedDesign[];
    },
  ): Result.Result<void, AtlasRendererError>;
  setSelected(id: string | null): void;
  setTheme(theme: AtlasTheme): void;
  setExploded(exploded: boolean): void;
  setReducedMotion(reduced: boolean): void;
  setLens(lens: AtlasLens): void;
  setMoorings(ids: readonly string[]): void;
  zoomIn(): void;
  zoomOut(): void;
  focus(id: string | null): void;
  resetView(): void;
  exportPlate(): Result.Result<string, AtlasRendererError>;
  getView(): AtlasView;
  getStats(): RendererStats;
  destroy(): void;
}
