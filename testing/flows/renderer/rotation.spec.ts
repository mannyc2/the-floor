import { Predicate } from "effect";
import { expect, ready, record, stopDrag, test } from "./fixture";

const visibleWalls = [
  ["wall-west", "wall-north"],
  ["wall-west", "wall-south"],
  ["wall-east", "wall-south"],
  ["wall-east", "wall-north"],
];

for (const dpr of [1, 3]) {
  test.describe(`DPR ${dpr}`, () => {
    test.use({ deviceScaleFactor: dpr });
    test(
      "quarter turns keep their focus, change the cutaway and reproduce the original pixels",
      // @effect-diagnostics-next-line asyncFunction:off -- Playwright owns browser input and waits for the real renderer and Foldkit Model.
      async ({ page }, info) => {
        const start = await ready(page);
        const original = await page.evaluate(() => window.floorTest.hash());
        for (const rotation of [1, 2, 3, 0]) {
          await page.getByRole("button", { name: "Rotate right", exact: true }).click();
          await expect.poll(() => new URL(page.url()).searchParams.get("rotation")).toBe(String(rotation));
          const state = await page.evaluate(() => window.floorTest.inspect());
          expect(state.camera).toEqual({ ...start.camera, rotation });
          expect(state.cutaway.filter(part => part.visible).map(part => part.name)).toEqual(visibleWalls[rotation]);
          const hidden = state.cutaway.filter(part => !part.visible).map(part => part.id);
          const picks = await page.evaluate(() => {
            const { width, height } = window.floorTest.inspect();
            return Array.from({ length: 1600 }, (_, index) =>
              window.floorTest.pick(
                (index % 40 + .5) * width / 40,
                (Math.floor(index / 40) + .5) * height / 40,
              ));
          });
          expect(picks.some(id => hidden.includes(id))).toBe(false);
          for (const wall of state.cutaway.filter(part => part.visible)) expect(picks).toContain(wall.id);
          expect(picks.some(id => id >= 2 && id <= 13)).toBe(true);
          const report = await page.evaluate(() => window.floorTest.picking(2000));
          expect(report.mismatches.filter(row => row.classification === "unexplained")).toEqual([]);
          record(`rotation-${rotation}`, { state, picking: report });
          await page.locator("canvas").screenshot({ path: info.outputPath(`rotation-${rotation}.png`) });
        }
        expect(await page.evaluate(() => window.floorTest.hash())).toBe(original);
        await expect(page.locator("#status")).toHaveAttribute("data-commits", "4");
      },
    );
  });
}

for (const rotation of [0, 1, 2, 3]) {
  // @effect-diagnostics-next-line asyncFunction:off -- Playwright measures input against independent screen coordinates at each camera corner.
  test(`rotation ${rotation} preserves grab and cursor zoom anchors`, async ({ page }) => {
    await ready(page, `?x=1&z=-1&extent=21&rotation=${rotation}`);
    const anchor = await page.evaluate(() => window.floorTest.ground(450, 400));
    await page.mouse.move(450, 400);
    await page.mouse.down();
    await page.mouse.move(530, 340, { steps: 8 });
    const dragged = await page.evaluate(point => window.floorTest.project(point.x, 0, point.z), anchor);
    expect(Math.hypot(dragged.x - 530, dragged.y - 340)).toBeLessThan(1);
    await stopDrag(page);
    const zoomAnchor = await page.evaluate(() => window.floorTest.ground(580, 360));
    const before = await page.evaluate(() => window.floorTest.inspect().camera.extent);
    await page.mouse.move(580, 360);
    await page.mouse.wheel(0, -120);
    await expect.poll(() => page.evaluate(() => window.floorTest.inspect().camera.extent)).toBeLessThan(before);
    const zoomed = await page.evaluate(point => window.floorTest.project(point.x, 0, point.z), zoomAnchor);
    expect(Math.hypot(zoomed.x - 580, zoomed.y - 360)).toBeLessThan(1);
    expect(await page.evaluate(() => window.floorTest.inspect().camera.rotation)).toBe(rotation);
    record("anchors", { rotation, dragged, zoomed });
  });
}

// @effect-diagnostics-next-line asyncFunction:off -- Playwright owns keyboard input and observes settled URL/Model commits.
test("keyboard turns wrap, ignore repeats and interrupt follow and active drag", async ({ page }) => {
  await ready(page);
  await page.locator("canvas").focus();
  await page.keyboard.press("q");
  await expect(page.locator("#status")).toHaveAttribute("data-commits", "1");
  expect(new URL(page.url()).searchParams.get("rotation")).toBe("3");
  await page.locator("canvas").dispatchEvent("keydown", { key: "e", repeat: true });
  expect(await page.evaluate(() => window.floorTest.inspect().camera.rotation)).toBe(3);
  await page.locator("#follow").click();
  await expect.poll(() => page.evaluate(() => window.floorTest.inspect().following)).toBe(true);
  await page.locator("canvas").focus();
  await page.keyboard.press("e");
  const turned = await page.evaluate(() => window.floorTest.inspect());
  expect(turned.camera.rotation).toBe(0);
  expect(turned.flying).toBe(false);
  expect(turned.following).toBe(false);
  await page.mouse.move(450, 400);
  await page.mouse.down();
  await page.mouse.move(470, 410);
  await page.keyboard.press("e");
  const interrupted = await page.evaluate(() => window.floorTest.inspect().camera);
  await page.mouse.move(550, 430);
  await page.mouse.up();
  expect(await page.evaluate(() => window.floorTest.inspect().camera)).toEqual(interrupted);
  expect(interrupted.rotation).toBe(1);
  await expect(page.locator("#status")).toHaveAttribute("data-commits", "3");
});

// @effect-diagnostics-next-line asyncFunction:off -- Playwright drives native history and reload without writing camera state.
test("rotation survives reload, back and forward with its matching cutaway", async ({ page }) => {
  await ready(page, "?x=2&z=-1&extent=18&rotation=2");
  const original = await page.evaluate(() => window.floorTest.hash());
  await page.getByRole("button", { name: "Rotate left", exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("rotation")).toBe("1");
  const turned = await page.evaluate(() => window.floorTest.hash());
  await page.reload();
  await expect(page.locator("#status")).toContainText("SwiftShader");
  expect(await page.evaluate(() => window.floorTest.hash())).toBe(turned);
  await page.goBack();
  await expect.poll(() => page.evaluate(() => window.floorTest.hash()), { timeout: 2500 }).toBe(original);
  expect(await page.evaluate(() => window.floorTest.inspect().camera)).toEqual({
    x: 2,
    z: -1,
    extent: 18,
    rotation: 2,
  });
  await page.goForward();
  await expect.poll(() => page.evaluate(() => window.floorTest.hash()), { timeout: 2500 }).toBe(turned);
  expect(new URL(page.url()).searchParams.get("rotation")).toBe("1");
});

// @effect-diagnostics-next-line asyncFunction:off -- Playwright drives actual DevTools history and GPU context restoration.
test("rotation replays exact pixels, ignores paused input and survives context restoration", async ({ page }) => {
  await ready(page);
  await page.getByRole("button", { name: "Rotate right", exact: true }).click();
  await expect(page.locator("#status")).toHaveAttribute("data-commits", "1");
  const first = await page.evaluate(() => window.floorTest.hash());
  const checkpoint = (await page.evaluate(() => window.floorTest.entries())).findLast(entry =>
    entry.tag.includes("RestedCamera")
  );
  expect(checkpoint).toBeDefined();
  if (Predicate.isUndefined(checkpoint)) return;
  await page.getByRole("button", { name: "Rotate right", exact: true }).click();
  await expect(page.locator("#status")).toHaveAttribute("data-commits", "2");
  const second = await page.evaluate(() => window.floorTest.hash());
  await page.evaluate(index => window.floorTest.jump(index), checkpoint.index);
  await expect.poll(() => page.evaluate(() => window.floorTest.inspect().paused)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.floorTest.hash())).toBe(first);
  await page.locator("canvas").focus();
  await page.keyboard.press("e");
  expect(await page.evaluate(() => window.floorTest.hash())).toBe(first);
  await page.evaluate(() => window.floorTest.resume());
  await expect.poll(() => page.evaluate(() => window.floorTest.hash())).toBe(second);
  await page.evaluate(() => window.floorTest.lose());
  await expect.poll(() => page.evaluate(() => window.floorTest.inspect().lost)).toBe(true);
  await page.evaluate(() => window.floorTest.restore());
  await expect.poll(() => page.evaluate(() => window.floorTest.inspect().lost)).toBe(false);
  await expect.poll(() => page.evaluate(() => window.floorTest.hash())).toBe(second);
  expect(await page.evaluate(() => window.floorTest.inspect().camera.rotation)).toBe(2);
});

// @effect-diagnostics-next-line asyncFunction:off -- Playwright queues real UI events before the renderer's next frame to reproduce the ordering failure.
test("an already queued theme frame cannot undo an immediate turn", async ({ page }) => {
  const before = await ready(page);
  await page.evaluate(() => {
    document.getElementById("theme")?.click();
    document.getElementById("rotate-right")?.click();
  });
  await expect(page.locator("#status")).toHaveAttribute("data-commits", "1");
  await expect.poll(() => page.evaluate(() => window.floorTest.inspect().theme)).toBe("night");
  await expect.poll(() => page.evaluate(() => window.floorTest.inspect().draws)).toBeGreaterThan(before.draws + 1);
  const state = await page.evaluate(() => window.floorTest.inspect());
  expect(state.camera.rotation).toBe(1);
  expect(new URL(page.url()).searchParams.get("rotation")).toBe("1");
  expect(state.cutaway.filter(part => part.visible).map(part => part.name)).toEqual(visibleWalls[1]);
  record("settled after queued presentation", state);
  const beforeReset = await ready(page);
  await page.evaluate(() => {
    document.getElementById("rotate-right")?.click();
    document.getElementById("frame-a")?.click();
  });
  await expect(page.locator("#status")).toHaveAttribute("data-commits", "1");
  await expect.poll(() => page.evaluate(() => window.floorTest.inspect().draws)).toBeGreaterThan(beforeReset.draws + 1);
  expect(await page.evaluate(() => window.floorTest.inspect().camera.rotation)).toBe(1);
  expect(new URL(page.url()).searchParams.get("rotation")).toBe("1");
  expect(await page.locator("#map").getAttribute("data-frame")).toContain("\"rotation\":1");
});

// @effect-diagnostics-next-line asyncFunction:off -- Playwright exercises the actual look adapter and ResizeObserver, without arranging mesh visibility.
test("camera cutaway preserves isolated rack visibility across resize", async ({ page }) => {
  await page.setViewportSize({ width: 256, height: 256 });
  await page.goto(
    "/look/?technique=B&backend=webgl&theme=day&rung=desk&asset=rack&dpr=1&width=256&height=256&desks=12&seed=439041101&fixedTimeEpochMs=1791806460000",
  );
  await expect.poll(() => page.evaluate(() => window.floorLook?.state()._tag)).toBe("Ready");
  expect(await page.evaluate(() => window.floorTest.inspect().cutaway.some(part => part.visible))).toBe(false);
  await page.setViewportSize({ width: 280, height: 280 });
  await expect.poll(() => page.evaluate(() => window.floorTest.inspect().width)).toBe(280);
  expect(await page.evaluate(() => window.floorTest.inspect().cutaway.some(part => part.visible))).toBe(false);
  const picked = await page.evaluate(() =>
    Array.from({ length: 1600 }, (_, index) =>
      window.floorTest.pick(
        (index % 40 + .5) * 7,
        (Math.floor(index / 40) + .5) * 7,
      ))
  );
  expect(picked).toContain(14);
  expect(picked.filter(id => id !== 0 && id !== 14)).toEqual([]);
});
