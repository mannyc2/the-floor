/* oxlint-disable effecttsgo/async-function, effect/noAsyncFunction -- Playwright owns native browser input, GPU readback and their awaited assertions. */
import type { Page } from "@playwright/test";
import { Effect, Schema } from "effect";
import type { Palette, PaletteName } from "../../../apps/web/src/map/_lib/renderer/palette";
import { syntheticPalette } from "../../../apps/web/src/map/_lib/renderer/scene";
import type { Presentation, Rotation, Theme } from "../../../apps/web/src/map/model";
import { ToneStudy } from "../../../apps/web/workbench/tone-study";
import { fixedSeed, fixedTimeEpochMs } from "../../look/protocol";
import { expect, record, test } from "./fixture";

// Deliberately neutral diagnostic values exercise data injection without
// committing the owner's unpicked art candidates as regression fixtures.
const palette: Palette = {
  colors: {
    ...syntheticPalette.colors,
    "timber-0": { day: 0x454545, night: 0x262626 },
    "timber-1": { day: 0x777777, night: 0x303030 },
    "timber-2": { day: 0x999999, night: 0x606060 },
    "timber-3": { day: 0xbbbbbb, night: 0x808080 },
    "floor-3": { day: 0xcccccc, night: 0x404040 },
    "steel-3": { day: 0xaaaaaa, night: 0x505050 },
    "glass-3": { day: 0x666666, night: 0x686868 },
    "brass-3": { day: 0xeeeeee, night: 0x909090 },
    "jacket-blue-3": { day: 0xababab, night: 0x515151 },
    "jacket-red-3": { day: 0xbcbcbc, night: 0x616161 },
    "jacket-green-3": { day: 0xcdcdcd, night: 0x717171 },
    ground: { day: 0xf2f2f2, night: 0x181818 },
    line: { day: 0x181818, night: 0xd8d8d8 },
    steel: { day: 0x777777, night: 0x898989 },
    paper: { day: 0xe6e6e6, night: 0x262626 },
    "tone-0": { day: 0x454545, night: 0x262626 },
    "tone-1": { day: 0x777777, night: 0x303030 },
    "tone-2": { day: 0x999999, night: 0x606060 },
    "tone-3": { day: 0xbbbbbb, night: 0x808080 },
  },
  lineOpacity: { day: 1, night: .35 },
};
const viewport = { width: 900, height: 700 };
test.use({ viewport, deviceScaleFactor: 1 });

// @effect-diagnostics-next-line asyncFunction:off -- Playwright owns the native navigation boundary around the Schema-encoded diagnostic request.
const openStudy = async (page: Page, candidate: Palette, theme: Theme, desks = 12) => {
  // oxlint-disable-next-line effect/noEffectRunInTests -- This native Playwright request adapter runs the production-owned Schema codec before entering the browser route.
  const encoded = await Effect.runPromise(
    Schema.encodeEffect(Schema.fromJsonString(ToneStudy))({
      id: "neutral-browser-regression",
      palette: candidate,
    }),
  );
  const query = new URLSearchParams({
    technique: "B",
    backend: "webgl",
    theme,
    rung: "building",
    dpr: "1",
    width: String(viewport.width),
    height: String(viewport.height),
    desks: String(desks),
    asset: "scene",
    seed: String(fixedSeed),
    fixedTimeEpochMs: String(fixedTimeEpochMs),
    tones: encoded,
  });
  await page.goto(`/look/?${query.toString()}`);
};

// @effect-diagnostics-next-line asyncFunction:off -- Playwright owns document navigation and waits for the real renderer's capture readiness.
const loadStudy = async (page: Page, candidate = palette, theme: Theme = "day") => {
  await page.clock.setFixedTime(fixedTimeEpochMs);
  await openStudy(page, candidate, theme);
  await expect.poll(() => page.evaluate(() => window.floorLook?.state()._tag)).toBe("Ready");
  const state = await page.evaluate(() => window.floorTest.inspect());
  expect(state.renderer).toContain("SwiftShader");
  expect(state.camera).toEqual({ x: 0, z: 0, extent: 14, rotation: 0 });
  expect(state.theme).toBe(theme);
  return await page.evaluate(() => window.floorLook?.state());
};

interface Point {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}
const postTop: Point = { x: 0, y: 4.27, z: 0 };
const materialSamples: ReadonlyArray<{ readonly point: Point; readonly entity: number; readonly tone: PaletteName }> = [
  { point: { x: 5.7, y: 0, z: 4 }, entity: 3000, tone: "floor-3" },
  { point: { x: 5, y: 1.5, z: 2.7 }, entity: 3128, tone: "steel-3" },
  { point: { x: 1.9, y: 1.1, z: 5.2 }, entity: 3129, tone: "glass-3" },
  { point: { x: -4.9, y: 1.05, z: 2.8 }, entity: 3130, tone: "jacket-blue-3" },
  { point: { x: -5, y: 1.05, z: 4 }, entity: 3131, tone: "jacket-red-3" },
  { point: { x: -4.7, y: 1.05, z: 5.1 }, entity: 3132, tone: "jacket-green-3" },
  { point: { x: -3.02, y: .665, z: 5.02 }, entity: 3134, tone: "brass-3" },
  { point: { x: -1.42, y: .665, z: 5.02 }, entity: 3149, tone: "brass-3" },
  { point: { x: .18, y: .665, z: 5.02 }, entity: 3164, tone: "brass-3" },
];
const rgb = (color: number) => [color >> 16 & 255, color >> 8 & 255, color & 255, 255];

// @effect-diagnostics-next-line asyncFunction:off -- This browser boundary samples the real drawing buffer at independently specified world-space face interiors.
const facePixels = async (page: Page, points: ReadonlyArray<Point>) =>
  await page.evaluate(locations => {
    const state = window.floorTest.inspect();
    const bytes = window.floorTest.frame();
    return locations.map(point => {
      const screen = window.floorTest.project(point.x, point.y, point.z);
      const x = Math.floor(screen.x), y = Math.floor(screen.y);
      const offset = ((state.height - 1 - y) * state.width + x) * 4;
      return {
        screen,
        inViewport: x >= 0 && y >= 0 && x < state.width && y < state.height,
        entity: window.floorTest.pick(screen.x, screen.y),
        rgba: bytes.slice(offset, offset + 4),
      };
    });
  }, points);

// @effect-diagnostics-next-line asyncFunction:off -- Playwright submits a real service presentation and observes its acknowledged rendering revision.
const setTheme = async (page: Page, theme: Theme) => {
  const state = await page.evaluate(() => window.floorTest.inspect());
  const next: Presentation = {
    revision: state.revision + 1,
    theme,
    camera: state.camera,
    sampleTime: 0,
    playbackRate: 0,
    previousValue: 0,
    nextValue: 0,
    intervalStart: 0,
  };
  await page.evaluate(value => window.floorTest.present(value), next);
  await expect.poll(() => page.evaluate(() => window.floorTest.inspect().revision)).toBe(next.revision);
};

// @effect-diagnostics-next-line asyncFunction:off -- Playwright exercises the real theme/upload and WebGL context-restoration paths without remounting or reinjecting palette data.
test("candidate colors survive a theme roundtrip and WebGL context restoration", async ({ page }, info) => {
  await loadStudy(page);
  const original = await page.evaluate(() => window.floorTest.hash());
  const materials = await facePixels(page, materialSamples.map(sample => sample.point));
  expect(materials.map(sample => sample.entity)).toEqual(materialSamples.map(sample => sample.entity));
  expect(materials.map(sample => sample.rgba)).toEqual(
    materialSamples.map(sample => rgb(palette.colors[sample.tone].day)),
  );
  const day = await facePixels(page, [postTop]);
  expect(day.map(sample => sample.entity)).toEqual([3004]);
  expect(day.map(sample => sample.rgba)).toEqual([rgb(palette.colors["timber-3"].day)]);
  expect(await page.evaluate(() => window.floorTest.frame().slice(0, 4))).toEqual(rgb(palette.colors.ground.day));
  await page.locator("canvas[data-floor-look]").screenshot({ path: info.outputPath("neutral-day.png") });
  await setTheme(page, "night");
  const night = await page.evaluate(() => window.floorTest.hash());
  expect(night).not.toBe(original);
  const nightFace = await facePixels(page, [postTop]);
  expect(nightFace.map(sample => sample.entity)).toEqual([3004]);
  expect(nightFace.map(sample => sample.rgba)).toEqual([rgb(palette.colors["timber-3"].night)]);
  await page.locator("canvas[data-floor-look]").screenshot({ path: info.outputPath("neutral-night.png") });
  await page.evaluate(() => window.floorTest.lose());
  await expect.poll(() => page.evaluate(() => window.floorTest.inspect().lost)).toBe(true);
  await page.evaluate(() => window.floorTest.restore());
  await expect.poll(() => page.evaluate(() => window.floorTest.inspect().lost)).toBe(false);
  await expect.poll(() => page.evaluate(() => window.floorTest.hash())).toBe(night);
  await setTheme(page, "day");
  expect(await page.evaluate(() => window.floorTest.hash())).toBe(original);
  record("paletteRoundtrip", { original, night, day, nightFace, materialSamples, materials });
});

const corners: ReadonlyArray<
  { readonly rotation: Rotation; readonly station: number; readonly tone: "timber-1" | "timber-2" }
> = [
  { rotation: 0, station: 1, tone: "timber-2" },
  { rotation: 1, station: 3, tone: "timber-1" },
  { rotation: 2, station: 5, tone: "timber-2" },
  { rotation: 3, station: 7, tone: "timber-2" },
];

test(
  "tops stay lightest and world faces keep their directional tones at every camera corner",
  // @effect-diagnostics-next-line asyncFunction:off -- GPU readbacks at each camera corner verify actual top/side shading, including the diagonal band's tie policy.
  async ({ page }, info) => {
    await loadStudy(page);
    const sameFaces = new Map<string, Array<number>>();
    for (const { rotation, station, tone } of corners) {
      await page.evaluate(turn => window.floorTest.setCamera({ x: 0, z: 0, extent: 14, rotation: turn }), rotation);
      const angle = station * Math.PI / 4;
      const probes = [
        { name: "top", point: postTop, expected: palette.colors["timber-3"].day, entity: 3004 },
        {
          // A diagonal face is front-facing at only one of the four exact
          // corners. Check its independently specified band there; the axis
          // faces below are visible at two corners and prove room anchoring.
          name: `diagonal-${station}`,
          point: { x: Math.sin(angle) * 3.45, y: 1.03, z: Math.cos(angle) * 3.45 },
          expected: palette.colors[tone].day,
          entity: 3006 + station * 13,
        },
        ...(rotation === 0 || rotation === 1
          ? [{ name: "east", point: { x: 3.45, y: .95, z: 0 }, expected: palette.colors["timber-1"].day, entity: 3032 }]
          : []),
        ...(rotation === 0 || rotation === 3
          ? [{
            name: "south",
            point: { x: 0, y: .95, z: 3.45 },
            expected: palette.colors["timber-2"].day,
            entity: 3006,
          }]
          : []),
      ];
      const observed = await facePixels(page, probes.map(probe => probe.point));
      record(`worldFaces-${rotation}`, { probes, observed });
      await page.locator("canvas[data-floor-look]").screenshot({
        path: info.outputPath(`neutral-corner-${rotation}.png`),
      });
      for (const [index, sample] of observed.entries()) {
        const probe = probes[index];
        expect(probe).toBeDefined();
        if (!probe) continue;
        expect(sample.inViewport).toBe(true);
        expect(sample.entity, `${probe.name} must sample its own visible face`).toBe(probe.entity);
        expect(sample.rgba, `${probe.name} at rotation ${rotation}`).toEqual(rgb(probe.expected));
        const previous = sameFaces.get(probe.name);
        if (previous) expect(sample.rgba).toEqual(previous);
        sameFaces.set(probe.name, sample.rgba);
      }
    }
  },
);

// @effect-diagnostics-next-line asyncFunction:off -- Each candidate reloads the real B scene, so equal mask hashes prove palette and opacity do not alter edge geometry.
test("palette and line-opacity uploads change color while preserving every technique B mask byte", async ({ page }) => {
  const opacity: Palette = { ...palette, lineOpacity: { day: 1, night: 1 } };
  const colors: Palette = {
    ...palette,
    colors: { ...palette.colors, "timber-3": { day: 0xdddddd, night: 0x999999 } },
  };
  const captures: Array<{ color: string; mask: string; scene: string; palette: string }> = [];
  for (const candidate of [palette, opacity, colors]) {
    const state = await loadStudy(page, candidate, "night");
    expect(state?._tag).toBe("Ready");
    if (state?._tag !== "Ready") continue;
    const color = await page.evaluate(() => window.floorTest.hash());
    await page.evaluate(() => window.floorLook?.mask(true));
    const mask = await page.evaluate(() => window.floorTest.hash());
    const population = await page.evaluate(() => {
      const bytes = window.floorTest.frame();
      let edges = 0, background = 0;
      for (let index = 0; index < bytes.length; index += 4) {
        if (bytes[index] === 0 && bytes[index + 1] === 0 && bytes[index + 2] === 0) edges++;
        if (bytes[index] === 255 && bytes[index + 1] === 255 && bytes[index + 2] === 255) background++;
      }
      return { edges, background, pixels: bytes.length / 4 };
    });
    expect(population.edges).toBeGreaterThan(0);
    expect(population.background).toBeGreaterThan(0);
    expect(population.edges + population.background).toBe(population.pixels);
    expect(mask).not.toBe(color);
    record("maskPopulation", population);
    captures.push({ color, mask, scene: state.sourceSceneSha256, palette: state.paletteSha256 });
  }
  expect(captures).toHaveLength(3);
  expect(new Set(captures.map(capture => capture.color)).size).toBe(3);
  expect(new Set(captures.map(capture => capture.mask)).size).toBe(1);
  expect(new Set(captures.map(capture => capture.scene)).size).toBe(1);
  expect(new Set(captures.map(capture => capture.palette)).size).toBe(3);
  record("paletteMaskIsolation", captures);
});

// @effect-diagnostics-next-line asyncFunction:off -- The browser enters the rejected public capture configuration rather than arranging renderer internals.
test("tone studies reject high desk counts before adding their reserved entities", async ({ page }) => {
  await openStudy(page, palette, "day", 3000);
  await expect.poll(() => page.evaluate(() => window.floorLook?.state()._tag)).toBe("Failed");
  const state = await page.evaluate(() => window.floorLook?.state());
  expect(state?._tag).toBe("Failed");
  if (state?._tag === "Failed") expect(state.reason).toContain("Tone studies use the fixed whole scene");
  await expect(page.locator("canvas[data-floor-look]")).toHaveAttribute(
    "aria-label",
    "Synthetic desk scene — unapproved geometry and palette",
  );
  record("invalidToneStudy", state);
});
