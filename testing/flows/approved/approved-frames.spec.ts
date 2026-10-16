import { BunServices } from "@effect/platform-bun";
import { Crypto, Effect, FileSystem, Schema } from "effect";
import { Hex } from "effect/encoding";
import { ReferenceScene } from "../../../apps/web/workbench/_lib/reference-scene";
import { decodePng } from "../../look/png";
import dayMaterial from "../../look/scenes/materials-day.json" with { type: "json" };
import nightMaterial from "../../look/scenes/materials-night.json" with { type: "json" };
import dayCast from "../../look/scenes/proportions-cast-day.json" with { type: "json" };
import dayFloor from "../../look/scenes/proportions-floor-day.json" with { type: "json" };
import dayPost from "../../look/scenes/proportions-post-day.json" with { type: "json" };
import nightPost from "../../look/scenes/proportions-post-night.json" with { type: "json" };
import dayReadability from "../../look/scenes/proportions-readability-day.json" with { type: "json" };
import { expect, record, test } from "../renderer/fixture";

const briefs = [dayMaterial, nightMaterial, dayPost, nightPost, dayFloor, dayCast, dayReadability];

const runHost = <A, E>(operation: Effect.Effect<A, E, FileSystem.FileSystem | Crypto.Crypto>) =>
  operation.pipe(Effect.provide(BunServices.layer), Effect.runPromise);
const readReference = Effect.fn("ApprovedFrames.readReference")(function*(path: string) {
  const fs = yield* FileSystem.FileSystem;
  const crypto = yield* Crypto.Crypto;
  const bytes = yield* fs.readFile(path);
  return { sha256: Hex.encode(yield* crypto.digest("SHA-256", bytes)), raster: yield* decodePng(bytes) };
});
// Playwright's comparator skips pixels it classifies as anti-aliased, and
// one-pixel outlines are exactly such pixels. Count every RGBA channel too.
const changedPixels = (actual: Uint8Array, expected: Uint8Array) => {
  let changed = 0;
  for (let offset = 0; offset < Math.max(actual.length, expected.length); offset += 4) {
    if ([0, 1, 2, 3].some(channel => actual[offset + channel] !== expected[offset + channel])) changed++;
  }
  return changed;
};

for (const brief of briefs) {
  test.describe(brief.id, () => {
    const config = brief.capture;
    test.use({ viewport: { width: config.width, height: config.height }, deviceScaleFactor: config.dpr });

    // @effect-diagnostics-next-line asyncFunction:off -- Playwright owns the pinned browser clock, navigation and canvas capture.
    test(`reproduces ${brief.id} with zero changed RGBA pixels`, async ({ page }) => {
      const reference = await runHost(readReference(brief.reference.image));
      expect(reference.sha256).toBe(brief.reference.imageSha256);
      // Imported JSON widens the brief's view to a string; the Schema checks it.
      const scene = await Effect.runPromise(
        Schema.decodeUnknownEffect(ReferenceScene)({ view: "view" in brief ? brief.view : "materials", rotation: 0 })
          .pipe(Effect.flatMap(Schema.encodeEffect(Schema.fromJsonString(ReferenceScene)))),
      );
      const query = new URLSearchParams(Object.entries(config).map(([key, value]) => [key, String(value)]));
      query.set("reference", scene);
      await page.clock.setFixedTime(config.fixedTimeEpochMs);
      await page.goto(`/look/?${query}`);
      await expect.poll(() => page.evaluate(() => window.floorLook?.state()._tag), { timeout: 30000 }).toBe("Ready");
      const state = await page.evaluate(() => window.floorTest.inspect());
      expect(state.renderer.toLowerCase()).toContain("swiftshader");
      expect(state.camera).toEqual(brief.camera);
      expect(state.theme).toBe(config.theme);
      const canvas = page.locator("canvas[data-floor-look]");
      await expect(canvas).toHaveScreenshot(`${brief.id}.png`, { threshold: 0, maxDiffPixels: 0 });
      const capture = await Effect.runPromise(decodePng(await canvas.screenshot({ animations: "disabled" })));
      const changed = changedPixels(capture.data, reference.raster.data);
      record("approvedFrame", { id: brief.id, width: capture.width, height: capture.height, changedPixels: changed });
      expect([capture.width, capture.height]).toEqual([reference.raster.width, reference.raster.height]);
      expect(changed).toBe(0);
    });
  });
}
