import { Record as Records, Schema } from "effect";
import { approved, synthetic } from "./tokens";

const brief = "testing/look/scenes/proportions-post-day.json";
const ratio = (minimum: number, maximum: number) => Schema.Finite.check(Schema.isBetween({ minimum, maximum }));
// The workbench retains its original candidate envelope. An allowed candidate
// is not approved merely because it decodes through the same shape as Roomy.
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
export const kitUnit = approved(
  8,
  brief,
  "standingHeightK",
  "K = H / 8; dimensionless nominal standing height, without physical units or posed silhouette bounds.",
);
export const figureHeight = kitUnit.value;
export const roomyRatios = {
  headRatio: approved(.175, brief, "headRatio", "Hair-free head ellipsoid height divided by nominal H, before pose."),
  shoulderRatio: approved(
    .27,
    brief,
    "shoulderRatio",
    "Nominal torso width divided by H, before build, shaped jacket and sleeves.",
  ),
  worktopRatio: approved(.54, brief, "worktopRatio", "Top working surface elevation divided by H."),
  counterRadiusRatio: approved(
    1.32,
    brief,
    "counterRadiusRatio",
    "Outer counter lip radius divided by H; excludes occupied clearance.",
  ),
  stationWidthRatio: approved(
    .9,
    brief,
    "stationWidthRatio",
    "Outer-lip chord between support-frame centre lines divided by H; not clear width.",
  ),
  stationDepthRatio: approved(
    .4,
    brief,
    "stationDepthRatio",
    "Outer lip to inner counter-body boundary divided by H; excludes the .035H worktop overhang.",
  ),
  postPitchRatio: approved(
    4.25,
    brief,
    "postPitchRatio",
    "Neighbouring post-centre spacing divided by H; not a collision or aisle guarantee.",
  ),
  figureRadiusRatio: approved(
    1.49,
    brief,
    "figureRadiusRatio",
    "Station stance centre radius divided by H; not an action envelope.",
  ),
  monitorCrownRatio: approved(1.5, brief, "monitorCrownRatio", "Central monitor cluster top divided by H."),
};
export const roomyRecipe: ProportionRecipe = Records.map(roomyRatios, entry => entry.value);
export const studyCounts = {
  stationsPerPost: synthetic(
    8,
    brief,
    "Controlled comparison count; Roomy approval does not approve station capacity.",
  ),
  floorPosts: synthetic(3, brief, "Controlled comparison count; not an approved floor population or density."),
  readabilityHeightCssPx: synthetic(
    40,
    brief,
    "Recorded native readability view of nominal standing H, not approved camera framing.",
  ),
};

const construction = (value: number) =>
  synthetic(value, brief, "Recorded workbench support or placement dimension; not one of the nine approved ratios.");
export const studyLayout = {
  castFloorWidth: construction(30),
  castFloorDepth: construction(21),
  floorWidth: construction(72),
  postFloorWidth: construction(36),
  floorThickness: construction(.15),
  floorCentreY: construction(-.075),
  castColumnPitch: construction(6.5),
  castRowPitch: construction(8),
};
