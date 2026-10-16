import { expect, ready, record, test } from "./fixture";

// @effect-diagnostics-next-line asyncFunction:off -- Playwright and its serialized browser evaluations require native Promise callbacks.
test("instance replacement and restoration retain baseline GPU memory", async ({ page }) => {
  await ready(page);
  const result = await page.evaluate(() => window.floorTest.reconcile());
  record("reconciliation", result);
  expect(result.steps).toBe(257);
  expect(result.after.bufferUploads.allocationCalls).toBe(result.baseline.bufferUploads.allocationCalls);
  expect(result.after.geometries).toBe(result.baseline.geometries);
  expect(result.after.textures).toBe(result.baseline.textures);
  expect(result.after.programs).toBe(result.baseline.programs);
});

// @effect-diagnostics-next-line asyncFunction:off -- Playwright and its serialized browser evaluations require native Promise callbacks.
test("partial renderer acquisition failure releases context and listeners", async ({ page }) => {
  await ready(page);
  const result = await page.evaluate(() => window.floorTest.partialAcquisition());
  record("partialAcquisition", result);
  expect(result.caught).toBe(true);
  expect(result.after.live).toBe(result.before.live);
  expect(result.after.listeners).toBe(result.before.listeners);
  expect(result.after.contexts).toBe(result.before.contexts);
  expect(result.after.released).toBe(result.before.released + 1);
});
