import { Effect, Record as Records, Schema } from "effect";
import { darkLine, lineOpacity } from "./look";
import { approved, colors, materialColor, provisional, synthetic, type ThemeValues } from "./tokens";

const color = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 0xffffff }));
const themeColor = Schema.Struct({ day: color, night: color });
// Texture order is the shader's material address: four unshaded slots, then
// four-entry ramps (downward, dark side, light side, top). Downward-facing
// curved patches can be visible; only occluded undersides escape line checks.
// The original synthetic ramp stays first so a study cannot recolour the app.
const bodyNames = Schema.Literals([
  "ground",
  "line",
  "steel",
  "paper",
  "tone-0",
  "tone-1",
  "tone-2",
  "tone-3",
  "timber-0",
  "timber-1",
  "timber-2",
  "timber-3",
  "floor-0",
  "floor-1",
  "floor-2",
  "floor-3",
  "paper-0",
  "paper-1",
  "paper-2",
  "paper-3",
  "steel-0",
  "steel-1",
  "steel-2",
  "steel-3",
  "glass-0",
  "glass-1",
  "glass-2",
  "glass-3",
  "brass-0",
  "brass-1",
  "brass-2",
  "brass-3",
  "jacket-blue-0",
  "jacket-blue-1",
  "jacket-blue-2",
  "jacket-blue-3",
  "jacket-red-0",
  "jacket-red-1",
  "jacket-red-2",
  "jacket-red-3",
  "jacket-green-0",
  "jacket-green-1",
  "jacket-green-2",
  "jacket-green-3",
]);
const lightNames = Schema.Literals([
  "screen-light-0",
  "screen-light-1",
  "screen-light-2",
  "screen-light-3",
  "lamp-light-0",
  "lamp-light-1",
  "lamp-light-2",
  "lamp-light-3",
  "engraving-0",
  "engraving-1",
  "engraving-2",
  "engraving-3",
]);
export const PaletteName = Schema.Literals([...bodyNames.literals, ...lightNames.literals]);
export type PaletteName = typeof PaletteName.Type;
// Earlier approved-day study requests have no light or engraving slots. These
// neutral defaults keep those requests readable; only opted-in studies use them.
export const unusedLightValue = {
  day: synthetic(0x777777, "docs/decisions.md#the-look", "Unused study compatibility default; not picked art."),
  night: synthetic(0x777777, "docs/decisions.md#the-look", "Unused study compatibility default; not picked art."),
};
export const syntheticDarkLine = {
  day: synthetic(0x292929, "docs/decisions.md#the-look", "Synthetic renderer dark-line compatibility default."),
  night: synthetic(0x292929, "docs/decisions.md#the-look", "Synthetic renderer dark-line compatibility default."),
};
const values = (entry: ThemeValues<number>) => ({ day: entry.day.value, night: entry.night.value });
const unusedLight = themeColor.pipe(Schema.withDecodingDefaultKey(Effect.succeed(values(unusedLightValue))));
export const Palette = Schema.Struct({
  colors: Schema.StructWithRest(Schema.Record(bodyNames, themeColor), [Schema.Record(lightNames, unusedLight)]),
  darkLine: themeColor.pipe(Schema.withDecodingDefaultKey(Effect.succeed(values(syntheticDarkLine)))),
  lineOpacity: Schema.Struct({
    day: Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
    night: Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
  }),
});
export type Palette = typeof Palette.Type;

const syntheticPair = (day: number, night: number): ThemeValues<number> => ({
  day: synthetic(day, "docs/decisions.md#the-look", "Neutral synthetic renderer exercise, not a proposed material."),
  night: synthetic(
    night,
    "docs/decisions.md#the-look",
    "Neutral synthetic renderer exercise, not a proposed material.",
  ),
});
export const syntheticPaletteValues = {
  ground: syntheticPair(0xe6e6e6, 0x181818),
  line: syntheticPair(0x292929, 0xd8d8d8),
  steel: syntheticPair(0x777777, 0x898989),
  paper: syntheticPair(0xf2f2f2, 0x262626),
  "tone-0": syntheticPair(0x777777, 0x303030),
  "tone-1": syntheticPair(0x999999, 0x454545),
  "tone-2": syntheticPair(0xbbbbbb, 0x606060),
  "tone-3": syntheticPair(0xdddddd, 0x808080),
  "timber-0": syntheticPair(0x777777, 0x303030),
  "timber-1": syntheticPair(0x999999, 0x454545),
  "timber-2": syntheticPair(0xbbbbbb, 0x606060),
  "timber-3": syntheticPair(0xdddddd, 0x808080),
  "floor-0": syntheticPair(0x777777, 0x303030),
  "floor-1": syntheticPair(0x999999, 0x454545),
  "floor-2": syntheticPair(0xbbbbbb, 0x606060),
  "floor-3": syntheticPair(0xdddddd, 0x808080),
  "paper-0": syntheticPair(0x777777, 0x303030),
  "paper-1": syntheticPair(0x999999, 0x454545),
  "paper-2": syntheticPair(0xbbbbbb, 0x606060),
  "paper-3": syntheticPair(0xdddddd, 0x808080),
  "steel-0": syntheticPair(0x777777, 0x303030),
  "steel-1": syntheticPair(0x999999, 0x454545),
  "steel-2": syntheticPair(0xbbbbbb, 0x606060),
  "steel-3": syntheticPair(0xdddddd, 0x808080),
  "glass-0": syntheticPair(0x777777, 0x303030),
  "glass-1": syntheticPair(0x999999, 0x454545),
  "glass-2": syntheticPair(0xbbbbbb, 0x606060),
  "glass-3": syntheticPair(0xdddddd, 0x808080),
  "brass-0": syntheticPair(0x777777, 0x303030),
  "brass-1": syntheticPair(0x999999, 0x454545),
  "brass-2": syntheticPair(0xbbbbbb, 0x606060),
  "brass-3": syntheticPair(0xdddddd, 0x808080),
  "jacket-blue-0": syntheticPair(0x777777, 0x303030),
  "jacket-blue-1": syntheticPair(0x999999, 0x454545),
  "jacket-blue-2": syntheticPair(0xbbbbbb, 0x606060),
  "jacket-blue-3": syntheticPair(0xdddddd, 0x808080),
  "jacket-red-0": syntheticPair(0x777777, 0x303030),
  "jacket-red-1": syntheticPair(0x999999, 0x454545),
  "jacket-red-2": syntheticPair(0xbbbbbb, 0x606060),
  "jacket-red-3": syntheticPair(0xdddddd, 0x808080),
  "jacket-green-0": syntheticPair(0x777777, 0x303030),
  "jacket-green-1": syntheticPair(0x999999, 0x454545),
  "jacket-green-2": syntheticPair(0xbbbbbb, 0x606060),
  "jacket-green-3": syntheticPair(0xdddddd, 0x808080),
  "screen-light-0": syntheticPair(0x777777, 0x777777),
  "screen-light-1": syntheticPair(0x777777, 0x777777),
  "screen-light-2": syntheticPair(0x777777, 0x777777),
  "screen-light-3": syntheticPair(0x777777, 0x777777),
  "lamp-light-0": syntheticPair(0x777777, 0x777777),
  "lamp-light-1": syntheticPair(0x777777, 0x777777),
  "lamp-light-2": syntheticPair(0x777777, 0x777777),
  "lamp-light-3": syntheticPair(0x777777, 0x777777),
  "engraving-0": syntheticPair(0x777777, 0x777777),
  "engraving-1": syntheticPair(0x777777, 0x777777),
  "engraving-2": syntheticPair(0x777777, 0x777777),
  "engraving-3": syntheticPair(0x777777, 0x777777),
} satisfies Readonly<Record<PaletteName, ThemeValues<number>>>;
export const syntheticLineOpacity = {
  day: synthetic(1, "docs/decisions.md#the-look", "Synthetic renderer opacity, not approved art."),
  night: synthetic(.7, "docs/decisions.md#the-look", "Synthetic renderer opacity, not approved art."),
};
export const syntheticPalette: Palette = {
  colors: Records.map(syntheticPaletteValues, values),
  darkLine: values(syntheticDarkLine),
  lineOpacity: values(syntheticLineOpacity),
};
const unshown = (day: number, night: number): ThemeValues<number> => ({
  day: synthetic(
    day,
    "testing/look/scenes/materials-day.json",
    "Recorded unshown support slot; no visible-face approval.",
  ),
  night: synthetic(
    night,
    "testing/look/scenes/materials-night.json",
    "Recorded unshown support slot; no visible-face approval.",
  ),
});
const instrument = (day: number, night: number): ThemeValues<number> => ({
  day: provisional(
    day,
    "testing/look/scenes/materials-day.json",
    "Brass and engraving await real instrument geometry and mounting checks.",
  ),
  night: provisional(
    night,
    "testing/look/scenes/materials-night.json",
    "Brass and engraving await real instrument geometry and mounting checks.",
  ),
});
const litFace = (day: number, night: number, sourceKey: string): ThemeValues<number> => ({
  day: synthetic(
    day,
    "testing/look/scenes/materials-night.json",
    "Dormant day light entry; the night pick does not approve it.",
  ),
  night: approved(
    night,
    "testing/look/scenes/materials-night.json",
    sourceKey,
    "Shown flat lit face, without glow or a raised-body ramp; no lamp or screen design approval.",
  ),
});
export const paletteValues = {
  ...syntheticPaletteValues,
  ground: colors.ground,
  line: colors.line,
  "timber-0": unshown(0x5d3a1f, 0x27180d),
  "timber-1": materialColor(0x82532f, 0x392416, "timber-1"),
  "timber-2": materialColor(0xb17742, 0x66462c, "timber-2"),
  "timber-3": materialColor(0xdaab7c, 0x7f664e, "timber-3"),
  "floor-0": unshown(0x5f4629, 0x21180d),
  "floor-1": materialColor(0x86643d, 0x342618, "floor-1"),
  "floor-2": materialColor(0xa57c4d, 0x55412c, "floor-2"),
  "floor-3": materialColor(0xcc9b61, 0x735a3e, "floor-3"),
  "paper-0": colors.paper,
  "paper-1": colors.paper,
  "paper-2": colors.paper,
  "paper-3": colors.paper,
  "steel-0": unshown(0x4c4b48, 0x292927),
  "steel-1": materialColor(0x605e5c, 0x292928, "steel-1"),
  "steel-2": materialColor(0x83817d, 0x494846, "steel-2"),
  "steel-3": materialColor(0xa6a39e, 0x696865, "steel-3"),
  "glass-0": materialColor(0x4e606f, 0x212a32, "glass-0"),
  "glass-1": materialColor(0x4e606f, 0x212a32, "glass-1"),
  "glass-2": materialColor(0x657c8d, 0x3e4d58, "glass-2"),
  "glass-3": materialColor(0x88a6be, 0x576b7c, "glass-3"),
  "brass-0": instrument(0x634c22, 0x362912),
  "brass-1": instrument(0x917135, 0x4e3c1d),
  "brass-2": instrument(0xc1974a, 0x755c2f),
  "brass-3": instrument(0xfed683, 0x9f8655),
  "jacket-blue-0": unshown(0x2c3d55, 0x131a24),
  "jacket-blue-1": materialColor(0x475f82, 0x202938, "jacket-blue-1"),
  "jacket-blue-2": materialColor(0x5f7fab, 0x39485f, "jacket-blue-2"),
  "jacket-blue-3": materialColor(0x7da5de, 0x556a89, "jacket-blue-3"),
  "jacket-red-0": unshown(0x602d28, 0x2a1311),
  "jacket-red-1": materialColor(0x934841, 0x3f201e, "jacket-red-1"),
  "jacket-red-2": materialColor(0xc16157, 0x6a3a36, "jacket-red-2"),
  "jacket-red-3": materialColor(0xf97f73, 0x995650, "jacket-red-3"),
  "jacket-green-0": unshown(0x304031, 0x141b15),
  "jacket-green-1": materialColor(0x4d644f, 0x222b23, "jacket-green-1"),
  "jacket-green-2": materialColor(0x678469, 0x3d4b3e, "jacket-green-2"),
  "jacket-green-3": materialColor(0x87ac89, 0x5a6e5b, "jacket-green-3"),
  "screen-light-0": litFace(0x88a6be, 0x8baac2, "screen-light"),
  "screen-light-1": litFace(0x88a6be, 0x8baac2, "screen-light"),
  "screen-light-2": litFace(0x88a6be, 0x8baac2, "screen-light"),
  "screen-light-3": litFace(0x88a6be, 0x8baac2, "screen-light"),
  "lamp-light-0": litFace(0xebd9bc, 0xd2c2a8, "lamp-light"),
  "lamp-light-1": litFace(0xebd9bc, 0xd2c2a8, "lamp-light"),
  "lamp-light-2": litFace(0xebd9bc, 0xd2c2a8, "lamp-light"),
  "lamp-light-3": litFace(0xebd9bc, 0xd2c2a8, "lamp-light"),
  "engraving-0": instrument(0x080808, 0x080808),
  "engraving-1": instrument(0x080808, 0x080808),
  "engraving-2": instrument(0x080808, 0x080808),
  "engraving-3": instrument(0x080808, 0x080808),
} satisfies Readonly<Record<PaletteName, ThemeValues<number>>>;
export const materialPalette: Palette = {
  colors: Records.map(paletteValues, values),
  darkLine: values(darkLine),
  lineOpacity: values(lineOpacity),
};

const provisionalCharacter = (day: number, night: number): ThemeValues<number> => ({
  day: provisional(
    day,
    "docs/atlas.md#approved-proportions-and-kit-unit--13-october-2026",
    "Diagnostic skin or newly exposed underside assignment; proportion approval does not approve this material use.",
  ),
  night: provisional(
    night,
    "docs/atlas.md#approved-proportions-and-kit-unit--13-october-2026",
    "Diagnostic skin or newly exposed underside assignment; proportion approval does not approve this material use.",
  ),
});
export const proportionPaletteValues = {
  ...paletteValues,
  "tone-0": provisionalCharacter(0x7a5b42, 0x33261d),
  "tone-1": provisionalCharacter(0x7a5b42, 0x33261d),
  "tone-2": provisionalCharacter(0xa77e5c, 0x584436),
  "tone-3": provisionalCharacter(0xd9a579, 0x7e634f),
  "steel-0": provisionalCharacter(paletteValues["steel-1"].day.value, paletteValues["steel-1"].night.value),
  "jacket-blue-0": provisionalCharacter(
    paletteValues["jacket-blue-1"].day.value,
    paletteValues["jacket-blue-1"].night.value,
  ),
  "jacket-red-0": provisionalCharacter(
    paletteValues["jacket-red-1"].day.value,
    paletteValues["jacket-red-1"].night.value,
  ),
  "jacket-green-0": provisionalCharacter(
    paletteValues["jacket-green-1"].day.value,
    paletteValues["jacket-green-1"].night.value,
  ),
} satisfies Readonly<Record<PaletteName, ThemeValues<number>>>;
export const proportionPalette: Palette = { ...materialPalette, colors: Records.map(proportionPaletteValues, values) };
const characterBinding = (slot: PaletteName, reason: string) =>
  provisional(slot, "docs/atlas.md#approved-proportions-and-kit-unit--13-october-2026", reason);
export const characterMaterials = {
  skin: characterBinding("tone-0", "One provisional diagnostic skin hue, not a completed cast skin range."),
  hair: characterBinding(
    "steel-0",
    "Hair provisionally reuses steel; the material pick does not approve this semantic use.",
  ),
  trousers: characterBinding(
    "steel-0",
    "Trousers provisionally reuse steel; the material pick does not approve this semantic use.",
  ),
  shirt: characterBinding(
    "glass-0",
    "Shirt openings provisionally reuse glass; the material pick does not approve this semantic use.",
  ),
};
