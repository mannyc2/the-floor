import { expect, test } from "bun:test";
import * as camera from "../src/camera";
import * as look from "../src/look";
import { characterMaterials, materialPalette, proportionPalette, syntheticPalette } from "../src/materials";
import { figureHeight, roomyRecipe, studyCounts, studyLayout } from "../src/proportions";
import { colors } from "../src/tokens";

test("drawing values retain their recorded bytes and dimensions", () => {
  expect({
    ...camera,
    ...look,
    characterMaterials,
    materialPalette,
    proportionPalette,
    syntheticPalette,
    figureHeight,
    roomyRecipe,
    studyCounts,
    studyLayout,
    colors,
  }).toMatchSnapshot();
});
