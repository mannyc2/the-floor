import { Effect, Record as Records, Schema } from "effect";
import { darkLine, lineOpacity } from "./look";
import { colors } from "./tokens";

const bodyColors = {
  "ground": colors.ground,
  "line": colors.line,
  "steel": { day: 0x777777, night: 0x898989 },
  "paper": { day: 0xf2f2f2, night: 0x262626 },
  "tone-0": { day: 0x777777, night: 0x303030 },
  "tone-1": { day: 0x999999, night: 0x454545 },
  "tone-2": { day: 0xbbbbbb, night: 0x606060 },
  "tone-3": { day: 0xdddddd, night: 0x808080 },
  "timber-0": { day: 0x5d3a1f, night: 0x27180d },
  "timber-1": { day: 0x82532f, night: 0x392416 },
  "timber-2": { day: 0xb17742, night: 0x66462c },
  "timber-3": { day: 0xdaab7c, night: 0x7f664e },
  "floor-0": { day: 0x5f4629, night: 0x21180d },
  "floor-1": { day: 0x86643d, night: 0x342618 },
  "floor-2": { day: 0xa57c4d, night: 0x55412c },
  "floor-3": { day: 0xcc9b61, night: 0x735a3e },
  "paper-0": colors.paper,
  "paper-1": colors.paper,
  "paper-2": colors.paper,
  "paper-3": colors.paper,
  "steel-0": { day: 0x4c4b48, night: 0x292927 },
  "steel-1": { day: 0x605e5c, night: 0x292928 },
  "steel-2": { day: 0x83817d, night: 0x494846 },
  "steel-3": { day: 0xa6a39e, night: 0x696865 },
  "glass-0": { day: 0x4e606f, night: 0x212a32 },
  "glass-1": { day: 0x4e606f, night: 0x212a32 },
  "glass-2": { day: 0x657c8d, night: 0x3e4d58 },
  "glass-3": { day: 0x88a6be, night: 0x576b7c },
  "brass-0": { day: 0x634c22, night: 0x362912 },
  "brass-1": { day: 0x917135, night: 0x4e3c1d },
  "brass-2": { day: 0xc1974a, night: 0x755c2f },
  "brass-3": { day: 0xfed683, night: 0x9f8655 },
  "jacket-blue-0": { day: 0x2c3d55, night: 0x131a24 },
  "jacket-blue-1": { day: 0x475f82, night: 0x202938 },
  "jacket-blue-2": { day: 0x5f7fab, night: 0x39485f },
  "jacket-blue-3": { day: 0x7da5de, night: 0x556a89 },
  "jacket-red-0": { day: 0x602d28, night: 0x2a1311 },
  "jacket-red-1": { day: 0x934841, night: 0x3f201e },
  "jacket-red-2": { day: 0xc16157, night: 0x6a3a36 },
  "jacket-red-3": { day: 0xf97f73, night: 0x995650 },
  "jacket-green-0": { day: 0x304031, night: 0x141b15 },
  "jacket-green-1": { day: 0x4d644f, night: 0x222b23 },
  "jacket-green-2": { day: 0x678469, night: 0x3d4b3e },
  "jacket-green-3": { day: 0x87ac89, night: 0x5a6e5b },
} as const;
const lightColors = {
  "screen-light-0": { day: 0x88a6be, night: 0x8baac2 },
  "screen-light-1": { day: 0x88a6be, night: 0x8baac2 },
  "screen-light-2": { day: 0x88a6be, night: 0x8baac2 },
  "screen-light-3": { day: 0x88a6be, night: 0x8baac2 },
  "lamp-light-0": { day: 0xebd9bc, night: 0xd2c2a8 },
  "lamp-light-1": { day: 0xebd9bc, night: 0xd2c2a8 },
  "lamp-light-2": { day: 0xebd9bc, night: 0xd2c2a8 },
  "lamp-light-3": { day: 0xebd9bc, night: 0xd2c2a8 },
  "engraving-0": { day: 0x080808, night: 0x080808 },
  "engraving-1": { day: 0x080808, night: 0x080808 },
  "engraving-2": { day: 0x080808, night: 0x080808 },
  "engraving-3": { day: 0x080808, night: 0x080808 },
} as const;
const materialColors = { ...bodyColors, ...lightColors } as const;

const color = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 0xffffff }));
const themeColor = Schema.Struct({ day: color, night: color });
// Four unshaded slots precede the downward, dark-side, light-side and top ramps.
const bodyNames = Schema.Literals(Records.keys(bodyColors));
const lightNames = Schema.Literals(Records.keys(lightColors));
export const PaletteName = Schema.Literals([...bodyNames.literals, ...lightNames.literals]);
export type PaletteName = typeof PaletteName.Type;
const unusedLight = { day: 0x777777, night: 0x777777 } as const;
const syntheticDarkLine = { day: 0x292929, night: 0x292929 } as const;
// Older scene requests omit light slots; neutral defaults preserve their bytes.
export const Palette = Schema.Struct({
  colors: Schema.StructWithRest(Schema.Record(bodyNames, themeColor), [
    Schema.Record(lightNames, themeColor.pipe(Schema.withDecodingDefaultKey(Effect.succeed(unusedLight)))),
  ]),
  darkLine: themeColor.pipe(Schema.withDecodingDefaultKey(Effect.succeed(syntheticDarkLine))),
  lineOpacity: Schema.Struct({
    day: Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
    night: Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
  }),
});
export type Palette = typeof Palette.Type;

export const materialPalette: Palette = { colors: materialColors, darkLine, lineOpacity };
const syntheticTones = [
  { day: 0x777777, night: 0x303030 },
  { day: 0x999999, night: 0x454545 },
  { day: 0xbbbbbb, night: 0x606060 },
  { day: 0xdddddd, night: 0x808080 },
] as const;
export const syntheticPalette: Palette = {
  colors: {
    ...Records.map(materialColors, (_value, name) => {
      const index = PaletteName.literals.indexOf(name);
      return index < bodyNames.literals.length ? syntheticTones[(index - 4) % 4] ?? unusedLight : unusedLight;
    }),
    ground: { day: 0xe6e6e6, night: 0x181818 },
    line: { day: 0x292929, night: 0xd8d8d8 },
    steel: { day: 0x777777, night: 0x898989 },
    paper: { day: 0xf2f2f2, night: 0x262626 },
  },
  darkLine: syntheticDarkLine,
  lineOpacity: { day: 1, night: .7 },
};
export const proportionPalette: Palette = {
  ...materialPalette,
  colors: {
    ...materialColors,
    "tone-0": { day: 0x7a5b42, night: 0x33261d },
    "tone-1": { day: 0x7a5b42, night: 0x33261d },
    "tone-2": { day: 0xa77e5c, night: 0x584436 },
    "tone-3": { day: 0xd9a579, night: 0x7e634f },
    "steel-0": materialColors["steel-1"],
    "jacket-blue-0": materialColors["jacket-blue-1"],
    "jacket-red-0": materialColors["jacket-red-1"],
    "jacket-green-0": materialColors["jacket-green-1"],
  },
};
export const characterMaterials = { skin: "tone-0", hair: "steel-0", trousers: "steel-0", shirt: "glass-0" } as const;
