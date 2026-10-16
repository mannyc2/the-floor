import { cameraValues } from "@floor/atlas/camera";
import type { Locator, Page, TestInfo } from "@playwright/test";
import { PNG } from "pngjs";
import { expect, retainJson, test } from "./production";

// Production exposes its camera only through the URL and its pixels, and a pick
// only through a live world's desk drawer.
const urlCamera = (url: string) => {
  const query = new URL(url).searchParams;
  return {
    x: Number(query.get("x")),
    z: Number(query.get("z")),
    extent: Number(query.get("extent")),
    rotation: Number(query.get("rotation")),
  };
};

// The heading, controls and status text sit above this full-viewport canvas.
// Hiding them only while capturing keeps hover and focus paint from imitating
// or hiding world movement; every canvas pixel is still compared exactly.
const overlays =
  ".floor-heading, .camera-rotation, .floor-connection, .map-status, .world-status { visibility: hidden !important; }";
// @effect-diagnostics-next-line asyncFunction:off -- Playwright captures the composited canvas at this native boundary.
const capture = async (canvas: Locator) => PNG.sync.read(await canvas.screenshot({ style: overlays }));
// @effect-diagnostics-next-line asyncFunction:off -- Playwright retains each compared canvas capture at this native boundary.
const canvasPixels = async (canvas: Locator, info: TestInfo, name: string) =>
  PNG.sync.read(await canvas.screenshot({ style: overlays, path: info.outputPath(`${name}.png`) }));
// @effect-diagnostics-next-line asyncFunction:off -- Playwright reads the browser's own history at this boundary.
const historyLength = async (page: Page) => await page.evaluate(() => history.length);

// Only browser input and production DOM observations cross this boundary. The
// deployed artifact has no workbench adapter or test-arranged application state.
// @effect-diagnostics-next-line asyncFunction:off -- Playwright owns navigation and DOM readiness.
const openFloor = async (page: Page, info: TestInfo) => {
  await page.goto("/");
  const canvas = page.locator("#floor-map canvas");
  await expect(canvas).toBeVisible();
  await expect(page.getByText("Synthetic desks", { exact: true })).toBeVisible();
  await expect(page.locator("#rotate-right")).toBeEnabled();
  await expect(page).toHaveURL(/[?&]rotation=0(?:&|$)/);
  const renderer = await canvas.evaluate(element => {
    if (!(element instanceof HTMLCanvasElement)) return { renderer: "missing canvas", unmasked: "" };
    const gl = element.getContext("webgl2");
    if (!gl) return { renderer: "missing WebGL2", unmasked: "" };
    const debug = gl.getExtension("WEBGL_debug_renderer_info");
    return {
      renderer: String(gl.getParameter(gl.RENDERER)),
      unmasked: debug ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : "unavailable",
    };
  });
  expect(renderer.renderer).not.toMatch(/^missing/);
  expect(await page.evaluate(() => ({ workbench: "floorTest" in window, look: "floorLook" in window }))).toEqual({
    workbench: false,
    look: false,
  });
  await retainJson(info, "production-renderer", renderer);
  return canvas;
};

// @effect-diagnostics-next-line asyncFunction:off -- Playwright owns the real input sequence and observations.
test("production camera commits one drag, keeps a turn on reload and goes up a rung", async ({ page }, info) => {
  const canvas = await openFloor(page, info);
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  const entries = await historyLength(page);
  const beforeUrl = page.url();
  const beforePixels = await canvasPixels(canvas, info, "world-before-drag");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 70, box.y + box.height / 2 + 40, { steps: 8 });
  const draggingPixels = await canvasPixels(canvas, info, "world-during-drag");
  expect([draggingPixels.width, draggingPixels.height]).toEqual([beforePixels.width, beforePixels.height]);
  expect(draggingPixels.data.equals(beforePixels.data)).toBe(false);
  expect(page.url()).toBe(beforeUrl);
  expect(await historyLength(page)).toBe(entries);
  // oxlint-disable-next-line effect/noFixedWaitInTests -- A stationary hold is the user's slow-release gesture, preventing a glide.
  await page.waitForTimeout(120);
  await page.mouse.up();
  await expect(page).not.toHaveURL(beforeUrl);
  expect(await historyLength(page)).toBe(entries + 1);
  const settledUrl = page.url();
  expect(urlCamera(settledUrl)).not.toEqual(urlCamera(beforeUrl));
  // oxlint-disable-next-line effect/noFixedWaitInTests -- This bounded observation window detects duplicate commits after the gesture has settled.
  await page.waitForTimeout(300);
  expect(page.url()).toBe(settledUrl);
  expect(await historyLength(page)).toBe(entries + 1);

  await page.locator("#rotate-right").click();
  await expect(page).toHaveURL(/[?&]rotation=1(?:&|$)/);
  const rotatedUrl = page.url();
  expect(await historyLength(page)).toBe(entries + 2);
  const rotatedPixels = await canvasPixels(canvas, info, "world-before-reload");
  await page.reload();
  await expect(page.getByText("Synthetic desks", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(rotatedUrl);
  // The reloaded page must reach the same exact frame; poll only until its first draw.
  // @effect-diagnostics-next-line asyncFunction:off -- Playwright polls this native screenshot Promise.
  await expect.poll(async () => (await capture(canvas)).data.equals(rotatedPixels.data)).toBe(true);
  const reloadedPixels = await canvasPixels(canvas, info, "world-after-reload");
  await retainJson(info, "production-reload-pixels", {
    before: { width: rotatedPixels.width, height: rotatedPixels.height },
    after: { width: reloadedPixels.width, height: reloadedPixels.height },
    changedChannels: rotatedPixels.data.reduce(
      (count, value, index) => count + (value === reloadedPixels.data[index] ? 0 : 1),
      0,
    ),
    url: page.url(),
  });
  expect(reloadedPixels.data.equals(rotatedPixels.data)).toBe(true);

  await canvas.dblclick({ position: { x: box.width / 2, y: box.height / 2 } });
  await expect.poll(() => urlCamera(page.url()).extent).toBeCloseTo(12.6);
  await canvas.focus();
  await page.keyboard.press("Escape");
  await expect.poll(() => urlCamera(page.url()).extent).toBe(21);
  expect(urlCamera(page.url()).rotation).toBe(1);
  await retainJson(info, "production-camera-result", { beforeUrl, settledUrl, rotatedUrl, finalUrl: page.url() });
});

test.describe("phone production renderer", () => {
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });

  // @effect-diagnostics-next-line asyncFunction:off -- Playwright owns CDP touch input and browser observations.
  test("touch moves the world and commits once without scrolling the page", async ({ page, context }, info) => {
    const canvas = await openFloor(page, info);
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;
    const entries = await historyLength(page);
    const beforeUrl = page.url();
    const beforeScroll = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
    const beforePixels = await canvasPixels(canvas, info, "world-before-touch");
    const cdp = await context.newCDPSession(page);
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2, id: 1 };
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ ...point, x: point.x + 45, y: point.y + 60 }],
    });
    const touchingPixels = await canvasPixels(canvas, info, "world-during-touch");
    expect([touchingPixels.width, touchingPixels.height]).toEqual([beforePixels.width, beforePixels.height]);
    expect(touchingPixels.data.equals(beforePixels.data)).toBe(false);
    expect(page.url()).toBe(beforeUrl);
    expect(await page.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual(beforeScroll);
    // oxlint-disable-next-line effect/noFixedWaitInTests -- Holding the touch stationary before release selects the slow-release gesture.
    await page.waitForTimeout(120);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect(page).not.toHaveURL(beforeUrl);
    expect(await historyLength(page)).toBe(entries + 1);
    expect(await page.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual(beforeScroll);
    await retainJson(info, "production-touch-result", { beforeUrl, afterUrl: page.url(), beforeScroll });
    await cdp.detach();
  });
});

// A preview stage's seed Worker, or the locally served pair, writes the native world
// test's synthetic fixture before this flow runs. The flow only opens the page and clicks.
const seeded = {
  world: "synthetic-world",
  chain: "solana:synthetic-fork",
  agent: "synthetic-agent",
  receipt: "synthetic-receipt",
};

// @effect-diagnostics-next-line asyncFunction:off -- Playwright owns the real click and drawer observations.
test("a click picks the seeded synthetic desk and opens its labelled drawer", async ({ page }, info) => {
  await page.goto(`/?${new URLSearchParams({ world: seeded.world, chain: seeded.chain })}`);
  await expect(page.getByText("World connected", { exact: true })).toBeVisible();
  await expect(page.getByText("Rendering live world", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: `Open desk for ${seeded.agent}`, exact: true })).toBeVisible();
  const drawer = page.getByRole("complementary", { name: "Agent desk" });
  await expect(drawer).toHaveCount(0);
  const canvas = page.locator("#map canvas");
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  const entries = await historyLength(page);
  const beforeUrl = page.url();
  // The first canonical desk's tabletop, projected with the production camera
  // basis as the first-trade flow does. The click goes through GPU picking.
  const distance = Math.hypot(
    cameraValues.horizontalOffset,
    cameraValues.horizontalOffset,
    cameraValues.verticalOffset,
  );
  const upHorizontal = -cameraValues.verticalOffset / distance / Math.SQRT2;
  const upVertical = Math.SQRT2 * cameraValues.horizontalOffset / distance;
  const position = {
    x: box.width / 2 + Math.SQRT2 * box.height / 21,
    y: box.height / 2 - (2 * upHorizontal + .33 * upVertical) * box.height / 21,
  };
  // A pick before the world's first frame is drawn is ignored, so repeat the same click until one lands.
  // @effect-diagnostics-next-line asyncFunction:off -- Playwright retries this native click and observation.
  await expect(async () => {
    await canvas.click({ position });
    await expect(drawer).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15000 });
  await expect(drawer.getByRole("heading", { name: seeded.agent, exact: true })).toBeVisible();
  await expect(drawer.locator("[data-receipt-outcome]")).toHaveText("Refused");
  await expect(drawer.getByText(seeded.receipt, { exact: true })).toBeVisible();
  await expect(drawer.getByText("Synthetic world-delivery fixture; no transaction was executed", { exact: true }))
    .toBeVisible();
  await expect(drawer.getByText("Policy unconfirmed", { exact: true })).toBeVisible();
  await expect(drawer.getByText("Owner synthetic-owner · request synthetic-request", { exact: true })).toBeVisible();
  await expect(drawer.locator("[data-transaction]")).toHaveText("No transaction reported");
  // A pick selects; it is not a camera commit.
  expect(page.url()).toBe(beforeUrl);
  expect(await historyLength(page)).toBe(entries);
  await page.screenshot({ path: info.outputPath("production-pick.png") });
  await retainJson(info, "production-pick-result", { url: page.url(), position, ...seeded });
});
