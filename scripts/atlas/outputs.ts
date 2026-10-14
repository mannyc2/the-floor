import {
  cameraCorners,
  cameraFlight,
  cameraRungValues,
  cameraValues,
  proportionCameraValues,
} from "@floor/atlas/camera";
import { darkLine, lineClasses, lineOpacity, lineWidthCssPx, shading } from "@floor/atlas/look";
import {
  characterMaterials,
  PaletteName,
  paletteValues,
  proportionPaletteValues,
  syntheticPaletteValues,
} from "@floor/atlas/materials";
import { kitUnit, roomyRatios, studyCounts, studyLayout } from "@floor/atlas/proportions";
import { type AtlasValue, colors, type ThemeValues } from "@floor/atlas/tokens";
import { Effect, Record, Schema } from "effect";

const themes: ReadonlyArray<"day" | "night"> = ["day", "night"];
const hex = (value: number) => "#" + value.toString(16).padStart(6, "0");
const components = (value: number) => [(value >> 16 & 255) / 255, (value >> 8 & 255) / 255, (value & 255) / 255];

// Match the renderer's pinned three.js transfer arithmetic, including its rounded
// constants. Algebraically equivalent division changes some Float32 texture bytes.
export const srgbToLinear = (component: number) =>
  component < .04045 ? component * .0773993808 : Math.pow(component * .9478672986 + .0521327014, 2.4);

export const linearPalette = (values: Readonly<Record<PaletteName, ThemeValues<number>>>, theme: "day" | "night") =>
  PaletteName.literals.flatMap(name => [...components(values[name][theme].value).map(srgbToLinear), 1]);

const extensions = <A>(entry: AtlasValue<A>) => ({ "org.the-floor.atlas": { status: entry.status } });
const colorToken = (entry: AtlasValue<number>): Schema.Json => ({
  $type: "color",
  $value: { colorSpace: "srgb", components: components(entry.value), alpha: 1 },
  $extensions: extensions(entry),
});
const numberToken = (entry: AtlasValue<number>): Schema.Json => ({
  $type: "number",
  $value: entry.value,
  $extensions: extensions(entry),
});
const durationToken = (entry: AtlasValue<number>): Schema.Json => ({
  $type: "duration",
  $value: { value: entry.value, unit: "ms" },
  $extensions: extensions(entry),
});
const dimensionToken = (entry: AtlasValue<number>): Schema.Json => ({
  $type: "dimension",
  $value: { value: entry.value, unit: "px" },
  $extensions: extensions(entry),
});
const themedColors = (values: Readonly<Record<string, ThemeValues<number>>>, theme: "day" | "night") =>
  Record.map(values, value => colorToken(value[theme]));

export const dtcgTokens: Schema.Json = {
  $description:
    "The Floor Atlas. Status and approval scope belong to each token; provisional and synthetic values are not approvals.",
  $extensions: {
    "org.the-floor.atlas": {
      format: "DTCG 2025.10",
      generator: "scripts/build-atlas.ts",
      // Material bindings are semantic metadata, not a DTCG string token type.
      characterMaterials: Record.map(characterMaterials, entry => ({ slot: entry.value, status: entry.status })),
    },
  },
  ...Object.fromEntries(themes.map(theme => [theme, {
    colors: themedColors(colors, theme),
    materials: themedColors(paletteValues, theme),
    proportionStudy: themedColors(proportionPaletteValues, theme),
    synthetic: themedColors(syntheticPaletteValues, theme),
    darkLine: colorToken(darkLine[theme]),
    lineOpacity: numberToken(lineOpacity[theme]),
  }])),
  look: {
    lineWidth: dimensionToken(lineWidthCssPx),
    lineClasses: Record.map(lineClasses, numberToken),
    shading: Record.map(shading, numberToken),
  },
  proportions: {
    standingHeightK: numberToken(kitUnit),
    roomy: Record.map(roomyRatios, numberToken),
    studyLayout: Record.map(studyLayout, numberToken),
    studyCounts: {
      stationsPerPost: numberToken(studyCounts.stationsPerPost),
      floorPosts: numberToken(studyCounts.floorPosts),
      readabilityHeight: dimensionToken(studyCounts.readabilityHeightCssPx),
    },
  },
  camera: {
    basis: Record.map(cameraValues, numberToken),
    rungs: Record.map(cameraRungValues, numberToken),
    proportionStudy: Record.map(proportionCameraValues, numberToken),
    corners: Object.fromEntries(
      Object.entries(cameraCorners).map(([name, entry]) => [name, {
        x: numberToken({ value: entry.value.x, status: entry.status }),
        z: numberToken({ value: entry.value.z, status: entry.status }),
      }]),
    ),
    flight: {
      default: durationToken(cameraFlight.defaultMs),
      minimum: durationToken(cameraFlight.minimumMs),
      maximum: durationToken(cameraFlight.maximumMs),
      arc: numberToken(cameraFlight.arc),
    },
  },
};

const css = themes.map(theme => {
  const selector = theme === "day" ? ":root,\n:root[data-theme=\"day\"]" : ":root[data-theme=\"night\"]";
  const declarations = Object.entries(colors).map(([name, values]) =>
    `  --atlas-${name}: ${hex(values[theme].value)};`
  );
  return `${selector} {\n${declarations.join("\n")}\n}`;
}).join("\n\n") + "\n";

const paletteExport = (name: string, values: Readonly<Record<PaletteName, ThemeValues<number>>>) => {
  const rows = themes.map(theme =>
    `  ${theme}: [\n${linearPalette(values, theme).map(value => `    ${value},`).join("\n")}\n  ],`
  );
  return `export const ${name}: Readonly<Record<"day" | "night", ReadonlyArray<number>>> = {\n${rows.join("\n")}\n};`;
};

export const renderAtlasOutputs = Effect.fn("Atlas.renderOutputs")(function*() {
  const tokens = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Json, { space: 2 }))(dtcgTokens);
  return [
    { path: "packages/atlas/generated/atlas.css", content: css },
    {
      path: "packages/atlas/generated/palette.ts",
      content: "// Generated by scripts/build-atlas.ts; exact bytes are checked against the source manifest.\n"
        + "// RGBA linear-sRGB rows retain PaletteName order; each row contains every material and tone.\n"
        + [
          paletteExport("paletteLinearRgba", paletteValues),
          paletteExport("syntheticPaletteLinearRgba", syntheticPaletteValues),
          paletteExport("proportionPaletteLinearRgba", proportionPaletteValues),
        ].join("\n\n") + "\n",
    },
    { path: "packages/atlas/generated/tokens.json", content: tokens + "\n" },
  ];
});
