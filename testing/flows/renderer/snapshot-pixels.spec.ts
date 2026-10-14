/* oxlint-disable effecttsgo/async-function, effect/noAsyncFunction -- Playwright owns this native Promise callback and its awaited browser assertions. */
import { expect, ready, record, test } from "./fixture";

const readWitness = (elapsedMs: number | "restored-real-clock") => {
  const interpolation = window.floorTest.inspect().instanceInterpolation;
  const authoredOrigin = { x: -7.9, y: Math.fround(.05) + 1.28, z: Math.fround(1.4) + .55 };
  // This interior tabletop point comes from the authored desk geometry, not
  // the instance-position helper or the shader's transform implementation.
  const sample = (offset: number) => {
    const world = { ...authoredOrigin, x: authoredOrigin.x + offset };
    const screen = window.floorTest.project(world.x, world.y, world.z);
    return { world, screen, picked: window.floorTest.pick(screen.x, screen.y) };
  };
  return {
    elapsedMs,
    interpolation,
    original: sample(0),
    interpolated: sample(6 * interpolation),
    destination: sample(6),
  };
};

// @effect-diagnostics-next-line asyncFunction:off -- Playwright owns the browser callback and assertions.
test("snapshot interpolation moves actual ID pixels and preserves visibility after context restoration", async ({ page }) => {
  await page.clock.install({ time: "2026-10-14T12:00:00Z" });
  await ready(page);
  await page.clock.pauseAt("2026-10-14T13:00:00Z");
  const original = { id: 2, x: -7, y: Math.fround(.05), z: Math.fround(1.4) };
  const destination = { ...original, x: -1 };
  // A complete snapshot isolates the known desk face from other desks while
  // retaining the real service, buffer updates, color pass, and ID pass.
  await page.evaluate(input => window.floorTest.snapshotOnce(input), { revision: 1, instances: [original] });
  const initial = await page.evaluate(readWitness, 0);
  record("initialPixels", initial);
  expect(initial.original.picked).toBe(2);
  expect(initial.destination.picked).not.toBe(2);

  await page.evaluate(input => window.floorTest.snapshotOnce(input), { revision: 2, instances: [destination] });
  const start = await page.evaluate(readWitness, 0);
  record("startPixels", start);
  expect(start.interpolation).toBe(0);
  expect(start.original.picked).toBe(2);
  expect(start.destination.picked).not.toBe(2);

  await page.clock.runFor(125);
  const middle = await page.evaluate(readWitness, 125);
  record("middlePixels", middle);
  // The displayed frame belongs to the last RAF before 125 ms, so retain its
  // measured uniform while independently locating the expected geometry.
  expect(middle.interpolation).toBeGreaterThan(.4);
  expect(middle.interpolation).toBeLessThan(.6);
  expect(middle.interpolated.picked).toBe(2);
  expect(middle.original.picked).not.toBe(2);
  expect(middle.destination.picked).not.toBe(2);

  // 256 ms includes the first scheduled RAF after the 250 ms endpoint.
  await page.clock.runFor(131);
  const settled = await page.evaluate(readWitness, 256);
  record("settledPixels", settled);
  expect(settled.interpolation).toBe(1);
  expect(settled.destination.picked).toBe(2);
  expect(settled.original.picked).not.toBe(2);

  await page.evaluate(input => window.floorTest.snapshotOnce(input), { revision: 3, instances: [] });
  const removed = await page.evaluate(readWitness, 256);
  record("removedPixels", removed);
  expect(removed.destination.picked).not.toBe(2);
  expect(removed.original.picked).not.toBe(2);

  await page.evaluate(input => window.floorTest.snapshotOnce(input), { revision: 4, instances: [destination] });
  const returned = await page.evaluate(readWitness, 256);
  record("returnedPixels", returned);
  expect(returned.destination.picked).toBe(2);
  expect(returned.original.picked).not.toBe(2);

  await page.clock.resume();
  const beforeRestore = await page.evaluate(() => window.floorTest.hash());
  await page.evaluate(() => window.floorTest.lose());
  await expect.poll(() => page.evaluate(() => window.floorTest.inspect().lost)).toBe(true);
  await page.evaluate(() => window.floorTest.restore());
  await expect.poll(() => page.evaluate(() => window.floorTest.inspect().lost)).toBe(false);
  await expect.poll(() => page.evaluate(() => window.floorTest.hash())).toBe(beforeRestore);
  const restored = await page.evaluate<ReturnType<typeof readWitness>, Parameters<typeof readWitness>[0]>(
    readWitness,
    "restored-real-clock",
  );
  record("restoredPixels", restored);
  expect(restored.destination.picked).toBe(2);
  expect(restored.original.picked).not.toBe(2);
});
