import { Schema } from "effect";

const ratio = (minimum: number, maximum: number) => Schema.Finite.check(Schema.isBetween({ minimum, maximum }));
export const ProportionRecipe = Schema.Struct({
  headRatio: ratio(.13, .25),
  shoulderRatio: ratio(.18, .34),
  worktopRatio: ratio(.4, .65),
  counterRadiusRatio: ratio(.9, 1.8),
  stationWidthRatio: ratio(.55, 1.15),
  stationDepthRatio: ratio(.3, .65),
  postPitchRatio: ratio(3.2, 6),
  figureRadiusRatio: ratio(1.1, 2.1),
  monitorCrownRatio: ratio(1.3, 1.9),
});
export type ProportionRecipe = typeof ProportionRecipe.Type;
// H = 8K is a nominal standing height; posed silhouettes can extend beyond it.
export const figureHeight = 8;
export const roomyRecipe = {
  "headRatio": 0.175,
  "shoulderRatio": 0.27,
  "worktopRatio": 0.54,
  "counterRadiusRatio": 1.32,
  "stationWidthRatio": 0.9,
  "stationDepthRatio": 0.4,
  "postPitchRatio": 4.25,
  "figureRadiusRatio": 1.49,
  "monitorCrownRatio": 1.5,
} as const;
export const studyCounts = {
  "stationsPerPost": 8,
  "floorPosts": 3,
  "readabilityHeightCssPx": 40,
} as const;
export const studyLayout = {
  "castFloorWidth": 30,
  "castFloorDepth": 21,
  "floorWidth": 72,
  "postFloorWidth": 36,
  "floorThickness": 0.15,
  "floorCentreY": -0.075,
  "castColumnPitch": 6.5,
  "castRowPitch": 8,
} as const;
