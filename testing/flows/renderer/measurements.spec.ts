/* oxlint-disable effecttsgo/async-function, effect/noAsyncFunction -- Playwright owns these native Promise callbacks and their awaited browser assertions. */
import type { Presentation } from "../../../apps/web/src/map/model";
import { expect, ready, record, test } from "./fixture";
const p95 = (values: ReadonlyArray<number>) => values.toSorted((a, b) => a - b)[Math.ceil(values.length * .95) - 1];
[1, 2, 3].forEach(dpr =>
  test.describe(`DPR ${dpr}`, () => {
    test.use({ viewport: { width: 640, height: 480 }, deviceScaleFactor: dpr });
    [21, 12, 7].forEach(extent =>
      ["day", "night"].forEach(theme => {
        // @effect-diagnostics-next-line asyncFunction:off -- Playwright and its serialized browser evaluations require native Promise callbacks.
        test(`Technique B ${theme} extent ${extent} DPR ${dpr} twenty identical renders`, async ({ page }) => {
          await ready(page, "?desks=1000");
          if (theme === "night") {
            await page.locator("#theme").click();
            await expect.poll(() => page.evaluate(() => window.floorTest.inspect().theme)).toBe("night");
          }
          await page.evaluate(
            size => window.floorTest.setCamera({ x: -23.8, z: 43.2, extent: size, rotation: 0 }),
            extent,
          );
          // @effect-diagnostics-next-line asyncFunction:off -- Playwright and its serialized browser evaluations require native Promise callbacks.
          const hashes = await page.evaluate(async () => {
            const draws: Array<string> = [];
            // Sequential actual GPU renders and raw readback, not twenty hashes of
            // one cached array. Each cell has a fresh Mount; repeats keep that Mount.
            for (const iteration of Array.from({ length: 20 }, (_, index) => index)) {
              window.floorTest.draw();
              draws[iteration] = await window.floorTest.hash();
            }
            return draws;
          });
          await page.evaluate(() => window.floorTest.mask(true));
          const line = await page.evaluate(() => window.floorTest.line());
          record("matrixCell", {
            desks: 1000,
            theme,
            extent,
            dpr,
            hashes,
            line,
            acquisitionPolicy: "one fresh Mount per cell; 20 forced renders on that Mount",
          });
          expect(new Set(hashes).size).toBe(1);
          expect(line.centerDistanceCssPx).toBeLessThanOrEqual(1.25);
          expect(line.widthCssPx).toBeGreaterThanOrEqual(.75);
          expect(line.widthCssPx).toBeLessThanOrEqual(1.25);
          await page.evaluate(() => window.floorTest.mask(false));
        });
      })
    );
  })
);
[1, 3].forEach(dpr =>
  test.describe(`Picking DPR ${dpr}`, () => {
    test.use({ viewport: { width: 640, height: 480 }, deviceScaleFactor: dpr });
    // @effect-diagnostics-next-line asyncFunction:off -- Playwright and its serialized browser evaluations require native Promise callbacks.
    test(`ten thousand ID picks versus BVH DPR ${dpr}`, async ({ page }, info) => {
      await ready(page, "?desks=1000&extent=21&x=0&z=0");
      await page.evaluate(() => window.floorTest.mask(true));
      const results = await page.evaluate(() => window.floorTest.picking(10000));
      record("picking", results);
      expect(results.count).toBe(10000);
      expect(results.nonzero).toBeGreaterThan(1000);
      expect(results.lineSamples).toBeGreaterThan(100);
      expect(results.mismatches.filter(row => row.classification === "unexplained")).toEqual([]);
      await page.evaluate(() => window.floorTest.mask(false));
      await page.locator("canvas").screenshot({ path: info.outputPath(`picking-dpr-${dpr}.png`) });
    });
  })
);

test.describe("Phone profile", () => {
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
  // @effect-diagnostics-next-line asyncFunction:off -- Playwright and its serialized browser evaluations require native Promise callbacks.
  test("1000-desk phone CPU frame cost target memory and readback latency", async ({ page }) => {
    await ready(page, "?desks=1000");
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    // @effect-diagnostics-next-line asyncFunction:off -- Playwright and its serialized browser evaluations require native Promise callbacks.
    const result = await page.evaluate(async () => {
      Array.from({ length: 10 }, () => window.floorTest.draw());
      const frames = Array.from({ length: 120 }, () => window.floorTest.draw().cpuMs);
      const synchronous = Array.from({ length: 50 }, () => {
        // oxlint-disable-next-line effect/noGlobals -- Serialized browser diagnostics require the native performance clock to measure actual readback latency.
        const start = performance.now();
        window.floorTest.pick(195, 422);
        // oxlint-disable-next-line effect/noGlobals -- Serialized browser diagnostics require the native performance clock to measure actual readback latency.
        return performance.now() - start;
      });
      const asynchronous: Array<number> = [];
      for (const iteration of Array.from({ length: 30 }, (_, index) => index)) {
        // oxlint-disable-next-line effect/noGlobals -- Serialized browser diagnostics require the native performance clock to measure actual readback latency.
        const start = performance.now();
        await window.floorTest.pickAsync(195, 422);
        // oxlint-disable-next-line effect/noGlobals -- Serialized browser diagnostics require the native performance clock to measure actual readback latency.
        asynchronous[iteration] = performance.now() - start;
      }
      return { info: window.floorTest.inspect(), frames, synchronous, asynchronous };
    });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    record("profile", {
      ...result,
      cpuP95Ms: p95(result.frames),
      syncP95Ms: p95(result.synchronous),
      asyncP95Ms: p95(result.asynchronous),
    });
    expect(result.info.targetBytes).toBe(47399040);
    // Two retained room walls each add a color and an ID draw; the near walls
    // and ceiling remain absent from both passes.
    expect(result.info.calls).toBe(21);
    // Submission time is recorded, not equated to GPU completion or a real phone.
    expect(result.frames.every(Number.isFinite)).toBe(true);
  });
});

// @effect-diagnostics-next-line asyncFunction:off -- Playwright and its serialized browser evaluations require native Promise callbacks.
test("GPU interpolation advances without repeated attribute uploads", async ({ page }) => {
  // Own both the monotonic clock and RAF before the renderer captures them.
  // Wall-clock polling can miss the entire 250 ms interval under GPU load.
  await page.clock.install({ time: "2026-10-12T12:00:00Z" });
  await ready(page);
  await page.clock.pauseAt("2026-10-12T13:00:00Z");
  const frame: Presentation = {
    revision: 2,
    theme: "day",
    camera: { x: 0, z: 0, extent: 21, rotation: 0 },
    sampleTime: 0,
    playbackRate: 1,
    previousValue: 0,
    nextValue: .8,
    intervalStart: 0,
  };
  await page.evaluate(presentation => window.floorTest.present(presentation), frame);
  await page.clock.runFor(64);
  const before = await page.evaluate(() => window.floorTest.inspect());
  const beforeHash = await page.evaluate(() => window.floorTest.hash());
  await page.clock.runFor(64);
  const after = await page.evaluate(() => window.floorTest.inspect());
  const afterHash = await page.evaluate(() => window.floorTest.hash());
  await page.clock.resume();
  expect(before.revision).toBe(frame.revision);
  expect(before.interpolation).toBeGreaterThan(.05);
  expect(before.interpolation).toBeLessThan(1);
  expect(after.interpolation).toBeGreaterThan(before.interpolation);
  expect(after.interpolation - before.interpolation).toBeCloseTo(64 / 250, 5);
  expect(after.interpolation).toBeLessThan(1);
  expect(afterHash).not.toBe(beforeHash);
  expect(after.cumulativeUploadCalls).toBe(before.cumulativeUploadCalls);
  expect(after.cumulativeUploadArrayBytes).toBe(before.cumulativeUploadArrayBytes);
  expect(after.uploadCalls).toBe(0);
  expect(after.uploadBytes).toBe(0);
  record("interpolation", {
    before,
    after,
    beforeHash,
    afterHash,
    elapsedBrowserMs: 64,
    mechanism: "one global interpolation uniform; per-instance previous/next attributes",
  });
});

// @effect-diagnostics-next-line asyncFunction:off -- Playwright and its serialized browser evaluations require native Promise callbacks.
test("recorded Foldkit checkpoints replay exactly at 1x and 10x", async ({ page }) => {
  await ready(page);
  const result = await page.evaluate(() => window.floorTest.replay());
  record("replay", result);
  expect(result.one.checkpoints).toHaveLength(5);
  expect(result.ten.checkpoints).toHaveLength(5);
  expect(result.one.checkpoints.every(point => point.hash === point.expected)).toBe(true);
  expect(result.ten.checkpoints.every(point => point.hash === point.expected)).toBe(true);
  expect(result.ten.elapsedMs).toBeLessThan(result.one.elapsedMs);
});
