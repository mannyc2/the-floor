import { Schema } from "effect";

const color = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 0xffffff }));
const themeColor = Schema.Struct({ day: color, night: color });
// Texture order is the shader's material address: four unshaded slots, then
// four-entry ramps (downward, dark side, light side, top). Downward-facing
// curved patches can be visible; only occluded undersides escape line checks.
// The original synthetic ramp stays first so a study cannot recolour the app.
export const PaletteName = Schema.Literals([
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
export type PaletteName = typeof PaletteName.Type;
export const Palette = Schema.Struct({
  colors: Schema.Record(PaletteName, themeColor),
  lineOpacity: Schema.Struct({
    day: Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
    night: Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
  }),
});
export type Palette = typeof Palette.Type;
