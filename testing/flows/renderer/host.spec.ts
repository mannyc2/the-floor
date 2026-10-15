import { expect, test } from "@playwright/test";

// @effect-diagnostics-next-line asyncFunction:off -- Playwright and its serialized browser evaluations require native Promise callbacks.
test("real Mount draws Technique B and keyed move retains the acquisition", async ({ page }) => {
  const errors: Array<string> = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("/workbench/");
  await expect(page.locator("#status")).toContainText("SwiftShader");
  await expect.poll(() => page.evaluate(() => window.floorTest.inspect().draws)).toBeGreaterThan(1);
  const before = await page.evaluate(() => window.floorTest.inspect());
  expect(before.webgl2).toBe(true);
  await page.locator("#reorder").click();
  expect(await page.evaluate(() => window.floorTest.inspect().generation)).toBe(before.generation);
  await page.locator("#visibility").click();
  await expect.poll(() => page.evaluate(() => window.floorTest.ledger().live)).toBe(0);
  const final = await page.evaluate(() => window.floorTest.ledger());
  expect(final.listeners).toBe(0);
  expect(final.contexts).toBe(0);
  expect(final.history.every(record => record.geometries === 0 && record.textures === 0 && record.contextLost)).toBe(
    true,
  );
  expect(errors).toEqual([]);
});
