import type { AdoptedDesign } from "@floor/contract";
import { type DesignGeometry, designGeometry, fitDesignGeometry } from "@floor/gate/geometry";
import { Option } from "effect";
import { designReadings } from "./design-readings";
import type { MarketPosition } from "./layout";

/** Geometry is placed inside the unchanged market slot; canonical flow highlighting remains owned by the atlas. */
export const adoptedMachineGeometry = (
  item: MarketPosition,
  adoption: AdoptedDesign,
  exploded = false,
  seconds = 0,
): Option.Option<DesignGeometry> =>
  fitDesignGeometry(
    designGeometry(adoption.design, designReadings(item.market), seconds),
    {
      width: Math.min(adoption.design.bounds.width, item.radius * 2),
      depth: Math.min(adoption.design.bounds.depth, item.radius * 2),
      height: Math.min(adoption.design.bounds.height, item.height - 0.9),
    },
    [item.x, 0.9 + (exploded ? 2.7 : 0), item.z],
  );
