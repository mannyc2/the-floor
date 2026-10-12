/* oxlint-disable effecttsgo/async-function, effect/noAsyncFunction -- Playwright owns these native Promise callbacks and their awaited browser assertions. */
import { BunServices } from "@effect/platform-bun";
import { expect, test as base } from "@playwright/test";
import type { Page } from "@playwright/test";
import { Effect, FileSystem, Schema } from "effect";

// oxlint-disable-next-line effect/noUnknownParameters -- This report boundary serializes diagnostic outputs with the Schema.Unknown JSON codec; it does not consume them as domain inputs.
const saveReport = (title: string, report: unknown) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem;
    const directory = "work/flows/renderer-checks";
    yield* fs.makeDirectory(directory, { recursive: true });
    const body = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(report);
    yield* fs.writeFileString(`${directory}/${title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.json`, body);
  }).pipe(
    // oxlint-disable-next-line effecttsgo/strict-effect-provide -- The Playwright report adapter owns its filesystem service.
    Effect.provide(BunServices.layer),
    // oxlint-disable-next-line effect/noEffectRunInTests -- Playwright owns the native Promise boundary for saving diagnostic artifacts.
    Effect.runPromise,
  );

import type { makeWorkbenchApi } from "../../../apps/web/workbench/api";
type BrowserProbe = ReturnType<typeof makeWorkbenchApi>;

const measurements = new Map<string, Array<{ name: string; value: unknown }>>();
// oxlint-disable-next-line effect/noUnknownParameters -- Measurements retain arbitrary typed renderer outputs for later inspection without asserting a shared domain shape.
export const record = (name: string, value: unknown) => {
  const title = base.info().title;
  const existing = measurements.get(title) ?? [];
  existing.push({ name, value });
  measurements.set(title, existing);
};
export const test = base.extend<{ audit: void }>({
  // @effect-diagnostics-next-line asyncFunction:off -- Playwright and its serialized browser evaluations require native Promise callbacks.
  audit: [async ({ page }, use, info) => {
    const errors: Array<string> = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => {
      if (message.type() === "error") errors.push(message.text());
    });
    await use();
    // oxlint-disable-next-line effect/noTryCatch -- Playwright teardown must retain the report even when a native assertion throws.
    try {
      if (await page.locator("#controls").count() > 0) {
        await page.evaluate(() => window.floorTest.resume());
        if (await page.locator("#map").count() > 0) await page.locator("#visibility").click();
        await expect.poll(() => page.evaluate(() => window.floorTest.ledger().live)).toBe(0);
        const ledger = await page.evaluate(() => window.floorTest.ledger());
        record("teardown", ledger);
        expect(ledger.contexts).toBe(0);
        expect(ledger.listeners).toBe(0);
        expect(ledger.history.every(row => row.geometries === 0 && row.textures === 0 && row.contextLost)).toBe(true);
      }
      expect(errors).toEqual([]);
    } finally {
      const report = {
        check: info.title,
        status: info.status,
        errors,
        assertions: info.errors.map(error => error.message),
        measurements: measurements.get(info.title) ?? [],
      };
      await saveReport(info.title, report);
    }
  }, { auto: true }],
});
export { expect };
// @effect-diagnostics-next-line asyncFunction:off -- Playwright and its serialized browser evaluations require native Promise callbacks.
export const ready = async (page: Page, query = ""): Promise<ReturnType<BrowserProbe["inspect"]>> => {
  await page.goto(`/workbench/${query}`);
  await expect(page.locator("#status")).toContainText("SwiftShader");
  await expect.poll(() => page.evaluate(() => window.floorTest.inspect().draws)).toBeGreaterThan(1);
  return await page.evaluate(() => window.floorTest.inspect());
};
// @effect-diagnostics-next-line asyncFunction:off -- Playwright and its serialized browser evaluations require native Promise callbacks.
export const stopDrag = async (page: Page) => {
  // oxlint-disable-next-line effect/noFixedWaitInTests -- A stationary 120 ms hold is the slow-release input, not a readiness delay.
  await page.waitForTimeout(120);
  await page.mouse.up();
};
export const initial = {
  revision: 1,
  theme: "day",
  camera: { x: 0, z: 0, extent: 21 },
  sampleTime: 0,
  playbackRate: 0,
  previousValue: 0,
  nextValue: 0,
  intervalStart: 0,
};

// @effect-diagnostics-next-line asyncFunction:off -- Playwright owns the native Promise callback for acknowledged frame input.
export const frameClick = async (page: Page, selector: string) => {
  const applied = Number(await page.locator("#status").getAttribute("data-applied"));
  await page.locator(selector).click();
  // @effect-diagnostics-next-line asyncFunction:off -- Playwright awaits a native locator read in this polling callback.
  await expect.poll(async () => Number(await page.locator("#status").getAttribute("data-applied"))).toBeGreaterThan(
    applied,
  );
};
