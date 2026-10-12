import type { MarketPosition } from "./layout";

export interface LayoutWindow {
  readonly key: string;
  readonly centerU: number;
  readonly centerV: number;
  readonly halfWidth: number;
  readonly halfHeight: number;
  readonly detailed: boolean;
}

/** Overscan is quantized in camera space, so panning reveals prepared neighbours without rebuilding every frame. */
export function layoutWindow(
  center: readonly [number, number],
  zoom: number,
  width: number,
  height: number,
): LayoutWindow {
  const half = 39 / Math.max(0.005, zoom);
  const cell = 2 ** Math.ceil(Math.log2(half));
  const aspect = Math.max(1, width / Math.max(1, height));
  const column = Math.floor((center[0] - center[1]) / Math.SQRT2 / cell);
  const row = Math.floor((center[0] + center[1]) / Math.SQRT2 * 0.5 / cell);
  const detailed = zoom >= 1.35;
  return {
    key: `${column}:${row}:${cell}:${aspect.toFixed(2)}:${detailed}`,
    centerU: (column + 0.5) * cell,
    centerV: (row + 0.5) * cell,
    halfWidth: cell * (aspect + 1),
    halfHeight: cell * 2,
    detailed,
  };
}

export const visibleIn = (item: MarketPosition, window: LayoutWindow): boolean => {
  const u = (item.x - item.z) / Math.SQRT2;
  const v = (item.x + item.z) / Math.SQRT2 * 0.5;
  return Math.abs(u - window.centerU) <= window.halfWidth + item.radius * Math.SQRT2
    && Math.abs(v - window.centerV) <= window.halfHeight + item.height + item.radius;
};
