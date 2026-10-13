import { Effect, Schema } from "effect";

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
const unusedLight = themeColor.pipe(
  Schema.withDecodingDefaultKey(Effect.succeed({ day: 0x777777, night: 0x777777 })),
);
export const Palette = Schema.Struct({
  colors: Schema.StructWithRest(Schema.Record(bodyNames, themeColor), [Schema.Record(lightNames, unusedLight)]),
  darkLine: themeColor.pipe(Schema.withDecodingDefaultKey(Effect.succeed({ day: 0x292929, night: 0x292929 }))),
  lineOpacity: Schema.Struct({
    day: Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
    night: Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
  }),
});
export type Palette = typeof Palette.Type;
