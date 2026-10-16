import type { Page } from "@playwright/test";
import { Effect, Schema } from "effect";
import { AssetReview } from "../../../apps/web/workbench/_lib/asset-review-model";
import { fixedSeed, fixedTimeEpochMs } from "../../look/protocol";
import { expect, record, test } from "../renderer/fixture";

// @effect-diagnostics-next-line asyncFunction:off -- Playwright performs native navigation against the built workbench.
const load = async (page: Page, review: AssetReview, theme: "day" | "night") => {
  const assets = await Effect.runPromise(Schema.encodeEffect(Schema.fromJsonString(AssetReview))(review));
  const query = new URLSearchParams({
    technique: "B",
    backend: "webgl",
    theme,
    rung: "building",
    asset: "scene",
    dpr: "1",
    width: "1200",
    height: "900",
    desks: "12",
    seed: String(fixedSeed),
    fixedTimeEpochMs: String(fixedTimeEpochMs),
    assets,
  });
  await page.clock.setFixedTime(fixedTimeEpochMs);
  await page.goto(`/look/?${query}`);
  await expect.poll(() => page.evaluate(() => window.floorLook?.state()._tag), { timeout: 30000 }).toBe("Ready");
  const observed = await page.evaluate(() => window.floorTest.inspect());
  expect(observed.renderer).toContain("SwiftShader");
  expect(observed.theme).toBe(theme);
  expect(observed.triangles).toBeGreaterThan(1500);
  const bounds = await page.evaluate(() => window.floorTest.assetBounds());
  const posts = bounds.filter(item => item.name.startsWith("asset_post_") || item.name === "asset_desk_support");
  expect(posts).toHaveLength(review.view === "floor" ? 3 : 1);
  for (const post of posts) {
    expect(post.maximum[0] - post.minimum[0]).toBeCloseTo(21.12, 2);
    expect(post.maximum[1] - post.minimum[1]).toBeCloseTo(12, 2);
    expect(post.maximum[2] - post.minimum[2]).toBeCloseTo(21.12, 2);
  }
  await expect(page.locator("canvas[data-floor-look]")).toHaveAttribute("aria-label", /Generated asset review/);
  return await page.evaluate(() => ({ state: window.floorLook?.state() }));
};

const variants: ReadonlyArray<AssetReview["variant"]> = ["operator", "analyst"];
const views: ReadonlyArray<AssetReview["view"]> = ["post", "floor", "desk"];
for (const variant of variants) {
  for (const view of views) {
    // @effect-diagnostics-next-line asyncFunction:off -- Actual GPU captures and context restoration are checked through Playwright's browser boundary.
    test(`${variant} ${view} installs generated assets and repeats exactly in both themes`, async ({ page }, info) => {
      const hashes: Array<string> = [];
      for (const theme of ["day", "night"] satisfies ReadonlyArray<"day" | "night">) {
        const first = await load(page, { variant, view }, theme);
        const firstHash = await page.evaluate(() => window.floorTest.hash());
        await page.locator("canvas[data-floor-look]").screenshot({ path: info.outputPath(`review-${theme}.png`) });
        const second = await load(page, { variant, view }, theme);
        expect(await page.evaluate(() => window.floorTest.hash())).toBe(firstHash);
        expect(second.state).toEqual(first.state);
        if (view === "desk") {
          await page.evaluate(() => window.floorTest.lose());
          await expect.poll(() => page.evaluate(() => window.floorTest.inspect().lost)).toBe(true);
          await page.evaluate(() => window.floorTest.restore());
          await expect.poll(() => page.evaluate(() => window.floorTest.inspect().lost)).toBe(false);
          await expect.poll(() => page.evaluate(() => window.floorTest.hash())).toBe(firstHash);
        }
        hashes.push(firstHash);
        record(theme, { ...second.state, frameSha256: firstHash });
      }
      expect(new Set(hashes).size).toBe(2);
    });
  }
}
