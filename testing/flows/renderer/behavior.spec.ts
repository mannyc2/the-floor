import { Predicate } from "effect";
import type { Presentation } from "../../../apps/web/src/map/model";
/* oxlint-disable effecttsgo/async-function, effect/noAsyncFunction -- Playwright owns these native Promise callbacks and their awaited browser assertions. */
import { expect, frameClick, ready, record, stopDrag, test } from "./fixture";

// @effect-diagnostics-next-line asyncFunction:off -- Playwright and its serialized browser evaluations require native Promise callbacks.
test("unmount during delayed acquisition never creates a renderer", async ({ page }) => {
  await page.goto("/workbench/?delay=400");
  await page.locator("#visibility").click();
  // oxlint-disable-next-line effect/noFixedWaitInTests -- Observe beyond the requested 400 ms acquisition delay to prove cancellation prevents late allocation.
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.floorTest.ledger().acquired)).toBe(0);
  await page.locator("#visibility").click();
  await expect(page.locator("#status")).toContainText("SwiftShader");
  expect(await page.evaluate(() => window.floorTest.ledger().acquired)).toBe(1);
});

// @effect-diagnostics-next-line asyncFunction:off -- Playwright and its serialized browser evaluations require native Promise callbacks.
test("live A-B-A and real DevTools A-B-A reproduce raw frame bytes", async ({ page }, info) => {
  await ready(page);
  await frameClick(page, "#frame-a");
  const a = await page.evaluate(() => window.floorTest.hash());
  const entriesA = await page.evaluate(() => window.floorTest.entries());
  record("entriesA", entriesA);
  const checkpointA = entriesA.findLast(entry => entry.tag.includes("ClickedFrameA"));
  expect(checkpointA).toBeDefined();
  expect(checkpointA).toBeDefined();
  if (Predicate.isUndefined(checkpointA)) return;
  await page.locator("canvas").screenshot({ path: info.outputPath("frame-a.png") });
  await page.locator("#frame-b").click();
  await expect.poll(() => page.evaluate(() => window.floorTest.hash())).not.toBe(a);
  const b = await page.evaluate(() => window.floorTest.hash());
  const checkpointB = (await page.evaluate(() => window.floorTest.entries())).findLast(entry =>
    entry.tag.includes("ClickedFrameB")
  );
  expect(checkpointB).toBeDefined();
  if (Predicate.isUndefined(checkpointB)) return;
  await page.locator("#frame-a").click();
  await expect.poll(() => page.evaluate(() => window.floorTest.hash())).toBe(a);
  await page.evaluate(index => window.floorTest.jump(index), checkpointB.index);
  await expect.poll(() => page.evaluate(() => window.floorTest.inspect().paused)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.floorTest.hash())).toBe(b);
  await page.evaluate(index => window.floorTest.jump(index), checkpointA.index);
  await expect.poll(() => page.evaluate(() => window.floorTest.hash())).toBe(a);
  await page.locator("canvas").screenshot({ path: info.outputPath("replayed-a.png") });
  record("hashes", { a, b, replayedA: await page.evaluate(() => window.floorTest.hash()) });
});

// @effect-diagnostics-next-line asyncFunction:off -- Playwright and its serialized browser evaluations require native Promise callbacks.
test("Paused viewStateChanges rejects interaction and retains live acquisition", async ({ page }) => {
  await ready(page);
  await frameClick(page, "#frame-a");
  const historical = await page.evaluate(() => window.floorTest.hash());
  const generation = await page.evaluate(() => window.floorTest.inspect().generation);
  const checkpoint = (await page.evaluate(() => window.floorTest.entries())).findLast(entry =>
    entry.tag.includes("ClickedFrameA")
  );
  expect(checkpoint).toBeDefined();
  if (Predicate.isUndefined(checkpoint)) return;
  await page.locator("#frame-b").click();
  await page.evaluate(index => window.floorTest.jump(index), checkpoint.index);
  await expect.poll(() => page.evaluate(() => window.floorTest.inspect().paused)).toBe(true);
  // Pausing input precedes the acknowledged historical draw by one frame.
  await expect.poll(() => page.evaluate(() => window.floorTest.hash())).toBe(historical);
  const before = await page.evaluate(() => window.floorTest.hash());
  await page.mouse.move(450, 350);
  await page.mouse.down();
  await page.mouse.move(550, 420, { steps: 4 });
  await page.mouse.up();
  await page.mouse.wheel(0, -100);
  expect(await page.evaluate(() => window.floorTest.hash())).toBe(before);
  expect(await page.evaluate(() => window.floorTest.inspect().generation)).toBe(generation);
  await page.evaluate(() => window.floorTest.resume());
  await expect.poll(() => page.evaluate(() => window.floorTest.inspect().paused)).toBe(false);
});

// @effect-diagnostics-next-line asyncFunction:off -- Playwright and its serialized browser evaluations require native Promise callbacks.
test("DevTools fresh historical Mount is released on resume", async ({ page }) => {
  await ready(page);
  await frameClick(page, "#frame-a");
  const first = await page.evaluate(() => window.floorTest.inspect().generation);
  const checkpoint = (await page.evaluate(() => window.floorTest.entries())).findLast(entry =>
    entry.tag.includes("ClickedFrameA")
  );
  expect(checkpoint).toBeDefined();
  if (Predicate.isUndefined(checkpoint)) return;
  await page.locator("#visibility").click();
  await expect.poll(() => page.evaluate(() => window.floorTest.ledger().live)).toBe(0);
  await page.evaluate(index => window.floorTest.jump(index), checkpoint.index);
  await expect.poll(() => page.evaluate(() => window.floorTest.ledger().live)).toBe(1);
  await expect.poll(() => page.evaluate(() => window.floorTest.inspect().paused)).toBe(true);
  expect(await page.evaluate(() => window.floorTest.inspect().generation)).toBeGreaterThan(first);
  await page.evaluate(() => window.floorTest.resume());
  await expect.poll(() => page.evaluate(() => window.floorTest.ledger().live)).toBe(0);
});

// @effect-diagnostics-next-line asyncFunction:off -- Playwright and its serialized browser evaluations require native Promise callbacks.
test("grab preserves the ground anchor within one pixel on both axes", async ({ page }) => {
  await ready(page);
  const anchor = await page.evaluate(() => window.floorTest.ground(450, 400));
  await page.mouse.move(450, 400);
  await page.mouse.down();
  await page.mouse.move(590, 310, { steps: 10 });
  const projected = await page.evaluate(
    groundPoint => window.floorTest.project(groundPoint.x, 0, groundPoint.z),
    anchor,
  );
  const error = Math.hypot(projected.x - 590, projected.y - 310);
  record("grabErrorCssPx", error);
  expect(error).toBeLessThan(1);
  await stopDrag(page);
});

// @effect-diagnostics-next-line asyncFunction:off -- Playwright and its serialized browser evaluations require native Promise callbacks.
test("slow release stops dead and commits only the resting camera", async ({ page }) => {
  await ready(page);
  const before = await page.evaluate(() => window.floorTest.inspect().restCommits);
  await page.mouse.move(450, 400);
  await page.mouse.down();
  await page.mouse.move(510, 410, { steps: 12 });
  expect(await page.evaluate(() => window.floorTest.inspect().restCommits)).toBe(before);
  await stopDrag(page);
  const released = await page.evaluate(() => window.floorTest.inspect());
  // oxlint-disable-next-line effect/noFixedWaitInTests -- This observation window proves a slow release remains stationary after subsequent animation frames.
  await page.waitForTimeout(250);
  const settled = await page.evaluate(() => window.floorTest.inspect());
  expect(settled.camera).toEqual(released.camera);
  expect(settled.gliding).toBe(false);
  expect(settled.restCommits).toBe(before + 1);
  record("eventToCommit", { events: settled.pointerEvents, commits: settled.restCommits - before });
});

// @effect-diagnostics-next-line asyncFunction:off -- Playwright and its serialized browser evaluations require native Promise callbacks.
test("fast release glides and eventually stops", async ({ page }) => {
  // Own the clock before renderer acquisition so a slow GPU submission cannot
  // turn the intended fast release into a stationary hold between mouse events.
  await page.clock.install({ time: "2026-10-12T12:00:00Z" });
  const before = await ready(page);
  await page.clock.pauseAt("2026-10-12T13:00:00Z");
  await page.mouse.move(400, 400);
  await page.mouse.down();
  await page.clock.runFor(16);
  await page.mouse.move(550, 400);
  await page.clock.runFor(16);
  await page.mouse.up();
  const released = await page.evaluate(() => window.floorTest.inspect());
  await page.clock.runFor(64);
  const moving = await page.evaluate(() => window.floorTest.inspect());
  await page.clock.runFor(3000);
  const settled = await page.evaluate(() => window.floorTest.inspect());
  await page.clock.resume();
  expect(released.gliding).toBe(true);
  expect(moving.camera).not.toEqual(released.camera);
  expect(settled.gliding).toBe(false);
  expect(settled.restCommits).toBe(before.restCommits + 1);
  record("glide", { releaseIntervalMs: 16, motionObservationMs: 64, released, moving, settled });
});

// @effect-diagnostics-next-line asyncFunction:off -- Playwright and its serialized browser evaluations require native Promise callbacks.
test("wheel zoom holds cursor ground point", async ({ page }) => {
  await ready(page);
  const anchor = await page.evaluate(() => window.floorTest.ground(580, 320));
  await page.mouse.move(580, 320);
  await page.mouse.wheel(0, -120);
  await expect.poll(() => page.evaluate(() => window.floorTest.inspect().camera.extent)).toBeLessThan(21);
  const point = await page.evaluate(groundPoint => window.floorTest.project(groundPoint.x, 0, groundPoint.z), anchor);
  const error = Math.hypot(point.x - 580, point.y - 320);
  record("zoomAnchorErrorCssPx", error);
  expect(error).toBeLessThan(1);
});

// @effect-diagnostics-next-line asyncFunction:off -- Playwright and its serialized browser evaluations require native Promise callbacks.
test("two-axis trackpad wheel pans instead of zooming", async ({ page }) => {
  await ready(page);
  const before = await page.evaluate(() => window.floorTest.inspect().camera);
  await page.mouse.move(500, 400);
  await page.mouse.wheel(28, 19);
  await expect.poll(() => page.evaluate(() => window.floorTest.inspect().camera.x)).not.toBe(before.x);
  expect((await page.evaluate(() => window.floorTest.inspect())).camera.extent).toBe(before.extent);
});

// @effect-diagnostics-next-line asyncFunction:off -- Playwright and its serialized browser evaluations require native Promise callbacks.
test("soft bounds resist without allowing departure from the map", async ({ page }) => {
  await ready(page);
  await page.mouse.move(450, 400);
  await page.mouse.down();
  await page.mouse.move(3000, 2500, { steps: 5 });
  const first = await page.evaluate(() => window.floorTest.inspect().camera);
  await page.mouse.move(6000, 5000, { steps: 5 });
  const second = await page.evaluate(() => window.floorTest.inspect().camera);
  record("bounds", { first, second });
  expect(Math.max(Math.abs(second.x), Math.abs(second.z))).toBeLessThanOrEqual(37);
  expect(Math.max(Math.abs(first.x), Math.abs(first.z))).toBeGreaterThan(25);
  await stopDrag(page);
});

// @effect-diagnostics-next-line asyncFunction:off -- Playwright and its serialized browser evaluations require native Promise callbacks.
test("flight has zoom-out arc and takes 600 to 1200 milliseconds", async ({ page }) => {
  await ready(page);
  // oxlint-disable-next-line effect/noGlobals -- Native monotonic timing independently measures the complete browser flight duration.
  const start = performance.now();
  await page.locator("#fly").click();
  await expect.poll(() => page.evaluate(() => window.floorTest.inspect().flying)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.floorTest.inspect().camera.extent), { intervals: [10] })
    .toBeGreaterThan(21);
  const mid = await page.evaluate(() => window.floorTest.inspect().camera);
  expect(mid.extent).toBeGreaterThan(21);
  await expect.poll(() => page.evaluate(() => window.floorTest.inspect().flying), { intervals: [20], timeout: 1600 })
    .toBe(false);
  // oxlint-disable-next-line effect/noGlobals -- Native monotonic timing independently measures the complete browser flight duration.
  const elapsed = performance.now() - start;
  record("flightElapsedMs", elapsed);
  expect(elapsed).toBeGreaterThanOrEqual(600);
  expect(elapsed).toBeLessThanOrEqual(1200);
  expect((await page.evaluate(() => window.floorTest.inspect())).camera).toEqual({
    x: 4,
    z: -4,
    extent: 12,
    rotation: 0,
  });
});

// @effect-diagnostics-next-line asyncFunction:off -- Playwright and its serialized browser evaluations require native Promise callbacks.
test("pointer input interrupts a flight and following stops on input", async ({ page }) => {
  await ready(page);
  await page.locator("#follow").click();
  await expect.poll(() => page.evaluate(() => window.floorTest.inspect().following)).toBe(true);
  await page.mouse.move(500, 400);
  await page.mouse.down();
  const interrupted = await page.evaluate(() => window.floorTest.inspect());
  expect(interrupted.flying).toBe(false);
  expect(interrupted.following).toBe(false);
  await page.mouse.move(540, 410);
  await stopDrag(page);
});

// @effect-diagnostics-next-line asyncFunction:off -- Playwright and its serialized browser evaluations require native Promise callbacks.
test("Escape goes up one zoom rung through a flight", async ({ page }) => {
  await ready(page);
  await page.evaluate(() => window.floorTest.setCamera({ x: 0, z: 0, extent: 7, rotation: 0 }));
  await page.locator("canvas").focus();
  await page.keyboard.press("Escape");
  await expect.poll(() => page.evaluate(() => window.floorTest.inspect().flying)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.floorTest.inspect().flying), { timeout: 2000 }).toBe(false);
  expect((await page.evaluate(() => window.floorTest.inspect())).camera.extent).toBe(12);
});

// @effect-diagnostics-next-line asyncFunction:off -- Playwright and its serialized browser evaluations require native Promise callbacks.
test("URL back and forward retrace flights and reload restores resting camera", async ({ page }) => {
  await ready(page);
  const initial = page.url();
  await page.locator("#fly").click();
  await expect.poll(() => new URL(page.url()).searchParams.get("extent"), { timeout: 2500 }).toBe("12");
  const target = page.url();
  await page.goBack();
  await expect.poll(() => page.evaluate(() => window.floorTest.inspect().flying)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.floorTest.inspect().flying), { timeout: 2000 }).toBe(false);
  expect(page.url()).toBe(initial);
  expect((await page.evaluate(() => window.floorTest.inspect())).camera.extent).toBe(21);
  await page.goForward();
  await expect.poll(() => page.evaluate(() => window.floorTest.inspect().camera.extent), { timeout: 2500 }).toBe(12);
  expect(page.url()).toBe(target);
  await page.reload();
  await expect(page.locator("#status")).toContainText("SwiftShader");
  expect((await page.evaluate(() => window.floorTest.inspect())).camera).toEqual({
    x: 4,
    z: -4,
    extent: 12,
    rotation: 0,
  });
});

// @effect-diagnostics-next-line asyncFunction:off -- Playwright and its serialized browser evaluations require native Promise callbacks.
test("panning retains GPU counts and uploads no instance attributes", async ({ page }) => {
  await ready(page, "?desks=1000");
  const before = await page.evaluate(() => window.floorTest.inspect());
  await page.mouse.move(450, 400);
  await page.mouse.down();
  await page.mouse.move(520, 430, { steps: 20 });
  const during = await page.evaluate(() => window.floorTest.inspect());
  record("memory", { before, during });
  expect(during.geometries).toBe(before.geometries);
  expect(during.textures).toBe(before.textures);
  expect(during.programs).toBe(before.programs);
  expect(during.cumulativeUploadCalls).toBe(before.cumulativeUploadCalls);
  expect(during.cumulativeUploadArrayBytes).toBe(before.cumulativeUploadArrayBytes);
  expect(during.uploadBytes).toBe(0);
  expect(during.uploadCalls).toBe(0);
  await stopDrag(page);
});

// @effect-diagnostics-next-line asyncFunction:off -- Playwright and its serialized browser evaluations require native Promise callbacks.
test("context loss and restoration reproduce the same frame", async ({ page }) => {
  await ready(page);
  const before = await page.evaluate(() => window.floorTest.hash());
  await page.evaluate(() => window.floorTest.lose());
  await expect.poll(() => page.evaluate(() => window.floorTest.inspect().lost)).toBe(true);
  await page.evaluate(() => window.floorTest.restore());
  await expect.poll(() => page.evaluate(() => window.floorTest.inspect().lost)).toBe(false);
  await expect.poll(() => page.evaluate(() => window.floorTest.hash())).toBe(before);
  record("restoredHash", before);
});

// @effect-diagnostics-next-line asyncFunction:off -- Playwright and its serialized browser evaluations require native Promise callbacks.
test("ID-target selection and no-hit clearing cross the real Foldkit message boundary", async ({ page }) => {
  await ready(page);
  const target = await page.evaluate(() => {
    const points = Array.from(
      { length: 100 },
      (_, index) => ({ x: 300 + (index % 10) * 30, y: 200 + Math.floor(index / 10) * 30 }),
    );
    return points.map(point => ({ ...point, id: window.floorTest.pick(point.x, point.y) })).find(point => point.id > 1);
  });
  expect(target).toBeDefined();
  if (Predicate.isUndefined(target)) return;
  await page.mouse.click(target.x, target.y);
  await expect(page.locator("#status")).toHaveAttribute("data-selection", String(target.id));
  expect((await page.evaluate(() => window.floorTest.entries())).some(entry => entry.tag.includes("SelectedEntity")))
    .toBe(true);
  const background = await page.evaluate(() => {
    const points = Array.from(
      { length: 100 },
      (_, index) => ({ x: 30 + (index % 10) * 84, y: 100 + Math.floor(index / 10) * 45 }),
    );
    return points.find(point => window.floorTest.pick(point.x, point.y) === 0);
  });
  expect(background).toBeDefined();
  if (Predicate.isUndefined(background)) return;
  await page.mouse.click(background.x, background.y);
  await expect(page.locator("#status")).toHaveAttribute("data-selection", "");
  record("picked", target);
  record("background cleared selection", background);
});

// @effect-diagnostics-next-line asyncFunction:off -- Playwright owns the browser's asynchronous rendering boundary.
test("a submitted presentation owns its values before the next animation frame", async ({ page }) => {
  await ready(page);
  // @effect-diagnostics-next-line asyncFunction:off -- Awaiting presentation acceptance resumes before the next native animation frame.
  await page.evaluate(async () => {
    const input = {
      revision: 77,
      theme: "day",
      camera: { x: 2, z: -1, extent: 18, rotation: 0 },
      sampleTime: 0,
      playbackRate: 0,
      previousValue: 0,
      nextValue: 0,
      intervalStart: 0,
    } satisfies Presentation;
    await window.floorTest.present(input);
    input.revision = 999;
    input.camera.x = 999;
    input.camera.extent = 999;
  });
  await expect.poll(() => page.evaluate(() => window.floorTest.inspect().revision)).toBe(77);
  expect((await page.evaluate(() => window.floorTest.inspect())).camera).toEqual({
    x: 2,
    z: -1,
    extent: 18,
    rotation: 0,
  });
});
