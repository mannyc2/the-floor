/* oxlint-disable effecttsgo/async-function, effect/noAsyncFunction -- Playwright owns native navigation, GPU readback and their awaited assertions. */
import type { Page } from "@playwright/test";
import { Effect, Schema } from "effect";
import { syntheticPalette } from "../../../apps/web/src/map/_lib/renderer/scene";
import type { Theme } from "../../../apps/web/src/map/model";
import { ProportionStudy } from "../../../apps/web/workbench/proportion-study";
import { fixedSeed, fixedTimeEpochMs } from "../../look/protocol";
import { expect, record, test } from "./fixture";

// Neutral diagnostic inputs exercise geometry injection; candidate art and
// its eventual owner pick remain outside the regression fixture.
const recipe: ProportionStudy["recipe"] = {
  headRatio: .18,
  shoulderRatio: .28,
  worktopRatio: .52,
  counterRadiusRatio: 1.2,
  stationWidthRatio: .8,
  stationDepthRatio: .36,
  postPitchRatio: 4,
  figureRadiusRatio: 1.38,
  monitorCrownRatio: 1.5,
};
const viewport = { width: 800, height: 240 };
test.use({ viewport, deviceScaleFactor: 1 });

// @effect-diagnostics-next-line asyncFunction:off -- Playwright owns the real browser route and its capture-readiness assertions.
const loadStudy = async (page: Page, view: ProportionStudy["view"], theme: Theme = "day", shape = recipe) => {
  const study: ProportionStudy = {
    id: "neutral-proportion-regression",
    recipe: shape,
    palette: syntheticPalette,
    view,
  };
  // oxlint-disable-next-line effect/noEffectRunInTests -- The native Playwright request boundary uses the production-owned Schema codec.
  const encoded = await Effect.runPromise(Schema.encodeEffect(Schema.fromJsonString(ProportionStudy))(study));
  const query = new URLSearchParams({
    technique: "B",
    backend: "webgl",
    theme,
    rung: "building",
    asset: "scene",
    dpr: "1",
    width: String(viewport.width),
    height: String(viewport.height),
    desks: "12",
    seed: String(fixedSeed),
    fixedTimeEpochMs: String(fixedTimeEpochMs),
    proportions: encoded,
  });
  await page.clock.setFixedTime(fixedTimeEpochMs);
  await page.goto(`/look/?${query}`);
  await expect.poll(() => page.evaluate(() => window.floorLook?.state()._tag)).toBe("Ready");
  const state = await page.evaluate(() => window.floorTest.inspect());
  const expected = {
    x: view === "post" || view === "floor" ? -4 : -2,
    z: view === "post" || view === "floor" ? -4 : -2,
    extent: view === "post" ? 38 : view === "floor" ? 78 : view === "cast" ? 25 : 8 * Math.cos(Math.PI / 6) * 240 / 40,
    rotation: 0,
  };
  expect(state.camera).toEqual(expected);
  expect(state.renderer).toContain("SwiftShader");
  expect(state.theme).toBe(theme);
  const evidence = await page.evaluate(() => ({
    study: window.floorTest.proportions(),
    ready: window.floorLook?.state(),
  }));
  return { ...evidence, hash: await page.evaluate(() => window.floorTest.hash()) };
};

test(
  "proportion readability projects nominal standing height to forty pixels with eight supported poses",
  // @effect-diagnostics-next-line asyncFunction:off -- The browser measures the actual orthographic projection and rendered diagnostic objects at native output size.
  async ({ page }, info) => {
    const evidence = await loadStudy(page, "readability");
    expect(evidence.study?.view).toBe("readability");
    expect(evidence.study?.kit.figureHeight).toBe(8);
    const objects = evidence.study?.objects ?? [];
    expect(
      objects.filter(object => /^cast-\d+-(standing|phone|reading|seated|asleep|walking|throwing)$/.test(object.name))
        .map(object => object.name),
    ).toEqual([
      "cast-0-standing",
      "cast-1-standing",
      "cast-2-phone",
      "cast-3-reading",
      "cast-4-seated",
      "cast-5-asleep",
      "cast-6-walking",
      "cast-7-throwing",
    ]);
    expect(objects.filter(object => object.name.endsWith("-chair"))).toHaveLength(2);
    expect(objects.filter(object => object.name.endsWith("-worktop"))).toHaveLength(2);
    const projection = await page.evaluate(() => {
      const feet = window.floorTest.project(0, 0, 0), head = window.floorTest.project(0, 8, 0);
      return feet.y - head.y;
    });
    expect(projection).toBeCloseTo(40, 6);
    await page.locator("canvas[data-floor-look]").screenshot({ path: info.outputPath("neutral-native-forty.png") });
    record("nativeReadability", { ...evidence, projection });
  },
);

// @effect-diagnostics-next-line asyncFunction:off -- Fresh navigation exercises different geometry requests while independently holding palette and camera constant.
test("proportion recipes change real post geometry without changing the palette or common camera", async ({ page }) => {
  const first = await loadStudy(page, "post");
  const second = await loadStudy(page, "post", "day", { ...recipe, counterRadiusRatio: 1.4, figureRadiusRatio: 1.58 });
  expect(first.ready?._tag).toBe("Ready");
  expect(second.ready?._tag).toBe("Ready");
  if (first.ready?._tag !== "Ready" || second.ready?._tag !== "Ready") return;
  expect(second.ready.paletteSha256).toBe(first.ready.paletteSha256);
  expect(second.ready.sourceSceneSha256).not.toBe(first.ready.sourceSceneSha256);
  expect(second.hash).not.toBe(first.hash);
  const firstCounter = first.study?.objects.find(object => object.name === "post-0-counter");
  const secondCounter = second.study?.objects.find(object => object.name === "post-0-counter");
  expect(firstCounter?.bounds).not.toEqual(secondCounter?.bounds);
  expect(second.study?.objects.filter(object => object.name.startsWith("post-0-station-"))).toHaveLength(8);
  record("recipeComparison", { first, second });
});

test(
  "proportion floor retains thirty-six figures and its night frame after rotation and context restoration",
  // @effect-diagnostics-next-line asyncFunction:off -- Real context loss and native quarter-turn input test restored scene ownership without reinjecting candidate geometry.
  async ({ page }, info) => {
    const evidence = await loadStudy(page, "floor", "night");
    const objects = evidence.study?.objects ?? [];
    expect(objects.filter(object => object.name.includes("-figure-") || object.name.includes("-spillover-")))
      .toHaveLength(36);
    expect(objects.filter(object => object.name.includes("-spillover-")).map(object => object.name.split("-")[1]))
      .toEqual([
        "0",
        "0",
        "1",
        "1",
        "1",
        "1",
        "2",
        "2",
        "2",
        "2",
        "2",
        "2",
      ]);
    expect(objects.every(object => object.id > 0 && object.id < 4096)).toBe(true);
    await page.locator("canvas[data-floor-look]").screenshot({ path: info.outputPath("neutral-floor-night.png") });
    await page.evaluate(() => window.floorTest.lose());
    await expect.poll(() => page.evaluate(() => window.floorTest.inspect().lost)).toBe(true);
    await page.evaluate(() => window.floorTest.restore());
    await expect.poll(() => page.evaluate(() => window.floorTest.inspect().lost)).toBe(false);
    await expect.poll(() => page.evaluate(() => window.floorTest.hash())).toBe(evidence.hash);
    await page.locator("canvas[data-floor-look]").focus();
    for (let turn = 0; turn < 4; turn++) {
      await page.keyboard.press("e");
      await expect.poll(() => page.evaluate(() => window.floorTest.inspect().camera.rotation)).toBe((turn + 1) % 4);
    }
    await expect.poll(() => page.evaluate(() => window.floorTest.inspect().camera.rotation)).toBe(0);
    await expect.poll(() => page.evaluate(() => window.floorTest.hash())).toBe(evidence.hash);
    record("restoredFloor", evidence);
  },
);
