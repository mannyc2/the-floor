/* oxlint-disable effecttsgo/async-function, effect/noAsyncFunction -- Playwright owns the browser callback and native asynchronous assertions. */
import { expect, ready, record, test } from "./fixture";

// @effect-diagnostics-next-line asyncFunction:off -- Playwright owns this native Promise test boundary.
test("a failed real Mount retirement quarantines later renderer acquisition", async ({ page }) => {
  await ready(page);
  const before = await page.evaluate(() => window.floorTest.ledger());
  // This labelled fault is registered on the actual renderer scope. The real
  // finalizers still release their GPU objects, context and input listeners.
  await page.evaluate(() => window.floorTest.injectRetirementFailure());
  await page.locator("#visibility").click();
  await expect.poll(() => page.evaluate(() => window.floorTest.ledger().live)).toBe(0);
  await page.locator("#visibility").click();
  await expect(page.locator("#status")).toContainText("failed:");
  await expect(page.locator("#map canvas")).toHaveCount(0);
  const after = await page.evaluate(() => window.floorTest.ledger());
  expect(after.acquired).toBe(before.acquired);
  expect(after.contexts).toBe(0);
  expect(after.listeners).toBe(0);
  record("injected retirement failure quarantines real Mount", { before, after });
});

// @effect-diagnostics-next-line asyncFunction:off -- Playwright owns this native Promise test boundary.
test("a native resize failure stops frames and camera commits until a fresh Mount", async ({ page }) => {
  await ready(page);
  const previousUrl = page.url();
  await page.locator("#fly").click();
  await expect.poll(() => new URL(page.url()).searchParams.get("extent")).toBe("12");
  await page.locator("#follow").click();
  await expect.poll(() => page.evaluate(() => window.floorTest.inspect().flying)).toBe(true);
  await page.evaluate(() => window.floorTest.injectResizeFailure());
  await expect(page.locator("#status")).toContainText("failed:");
  const failed = await page.evaluate(() => window.floorTest.inspect());
  const applied = await page.locator("#status").getAttribute("data-applied");
  const commits = await page.locator("#status").getAttribute("data-commits");
  const url = page.url();
  expect(failed.paused).toBe(true);
  expect(failed.flying).toBe(false);
  await page.locator("#frame-b").click();
  await page.locator("#fly").click();
  await page.mouse.move(450, 350);
  await page.mouse.wheel(0, -100);
  // oxlint-disable-next-line effect/noFixedWaitInTests -- Observe beyond the longest camera flight to prove failed native callbacks cannot later commit a frame or camera.
  await page.waitForTimeout(1300);
  const after = await page.evaluate(() => window.floorTest.inspect());
  expect(after.draws).toBe(failed.draws);
  expect(after.camera).toEqual(failed.camera);
  await expect(page.locator("#status")).toHaveAttribute("data-applied", applied ?? "");
  await expect(page.locator("#status")).toHaveAttribute("data-commits", commits ?? "");
  expect(page.url()).toBe(url);
  await page.goBack();
  expect(page.url()).toBe(previousUrl);
  const afterHistory = await page.evaluate(() => window.floorTest.inspect());
  expect(afterHistory.flying).toBe(false);
  expect(afterHistory.camera).toEqual(failed.camera);
  await expect(page.locator("#status")).toHaveAttribute("data-commits", commits ?? "");
  await page.locator("#visibility").click();
  await expect.poll(() => page.evaluate(() => window.floorTest.ledger().live)).toBe(0);
  await page.locator("#visibility").click();
  await expect(page.locator("#status")).toContainText("SwiftShader");
  const recovered = await page.evaluate(() => window.floorTest.inspect());
  expect(recovered.generation).toBeGreaterThan(failed.generation);
  expect(recovered.paused).toBe(false);
  record("native failure stops host until fresh Mount", { failed, after, afterHistory, recovered });
});
/* oxlint-enable effecttsgo/async-function, effect/noAsyncFunction */
