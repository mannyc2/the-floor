import { expect, ready, record, test } from "./fixture";
test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });

// @effect-diagnostics-next-line asyncFunction:off -- Playwright and its serialized browser evaluations require native Promise callbacks.
test("phone touch grabs within one pixel without scrolling the page", async ({ page }) => {
  await ready(page);
  for (const rotation of [1, 2, 3, 0]) {
    await page.getByRole("button", { name: "Rotate right", exact: true }).tap();
    await expect.poll(() => page.evaluate(() => window.floorTest.inspect().camera.rotation)).toBe(rotation);
    const cdp = await page.context().newCDPSession(page);
    const anchor = await page.evaluate(() => window.floorTest.ground(190, 450));
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 190, y: 450, id: 1 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 250, y: 530, id: 1 }] });
    const point = await page.evaluate(groundPoint => window.floorTest.project(groundPoint.x, 0, groundPoint.z), anchor);
    const error = Math.hypot(point.x - 250, point.y - 530);
    record("grabErrorCssPx", error);
    expect(error).toBeLessThan(1);
    expect(await page.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual({ x: 0, y: 0 });
    // oxlint-disable-next-line effect/noFixedWaitInTests -- A stationary touch hold is the input that distinguishes slow release from a fling.
    await page.waitForTimeout(120);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  }
});

// @effect-diagnostics-next-line asyncFunction:off -- Playwright and its serialized browser evaluations require native Promise callbacks.
test("CDP pinch zoom holds the midpoint ground anchor", async ({ page }) => {
  await ready(page);
  const cdp = await page.context().newCDPSession(page);
  const anchor = await page.evaluate(() => window.floorTest.ground(195, 450));
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: 155, y: 450, id: 1 }, { x: 235, y: 450, id: 2 }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: 115, y: 450, id: 1 }, { x: 275, y: 450, id: 2 }],
  });
  const view = await page.evaluate(() => window.floorTest.inspect().camera);
  const point = await page.evaluate(groundPoint => window.floorTest.project(groundPoint.x, 0, groundPoint.z), anchor);
  const error = Math.hypot(point.x - 195, point.y - 450);
  record("pinch", { view, errorCssPx: error });
  expect(view.extent).toBeCloseTo(10.5, 6);
  expect(error).toBeLessThan(1);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
});

// @effect-diagnostics-next-line asyncFunction:off -- Playwright and its serialized browser evaluations require native Promise callbacks.
test("phone double-tap zooms toward the tapped ground point", async ({ page }) => {
  await ready(page);
  const anchor = await page.evaluate(() => window.floorTest.ground(230, 450));
  await page.touchscreen.tap(230, 450);
  await page.touchscreen.tap(230, 450);
  await expect.poll(() => page.evaluate(() => window.floorTest.inspect().camera.extent)).toBeLessThan(21);
  const point = await page.evaluate(groundPoint => window.floorTest.project(groundPoint.x, 0, groundPoint.z), anchor);
  const error = Math.hypot(point.x - 230, point.y - 450);
  record("doubleTapErrorCssPx", error);
  expect(error).toBeLessThan(1);
});

// @effect-diagnostics-next-line asyncFunction:off -- Playwright and its serialized browser evaluations require native Promise callbacks.
test("two-finger tap goes up a zoom rung", async ({ page }) => {
  await ready(page);
  const cdp = await page.context().newCDPSession(page);
  await page.evaluate(() => window.floorTest.setCamera({ x: 0, z: 0, extent: 7, rotation: 0 }));
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: 155, y: 450, id: 1 }, { x: 235, y: 450, id: 2 }],
  });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect.poll(() => page.evaluate(() => window.floorTest.inspect().flying)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.floorTest.inspect().flying), { timeout: 2500 }).toBe(false);
  expect((await page.evaluate(() => window.floorTest.inspect())).camera.extent).toBe(12);
});
