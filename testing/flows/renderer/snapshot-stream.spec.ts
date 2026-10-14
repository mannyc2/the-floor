/* oxlint-disable effecttsgo/async-function, effect/noAsyncFunction -- Playwright owns these native Promise callbacks and their awaited browser assertions. */
import { expect, ready, record, test } from "./fixture";

// @effect-diagnostics-next-line asyncFunction:off -- Playwright owns the browser callback and assertions.
test("snapshot identity diff uploads exact sparse ranges and leaves stable frames untouched", async ({ page }) => {
  await page.clock.install({ time: "2026-10-14T12:00:00Z" });
  await ready(page);
  await page.clock.pauseAt("2026-10-14T13:00:00Z");
  const original = await page.evaluate(() => window.floorTest.instances().map(({ id, x, y, z }) => ({ id, x, y, z })));
  const moved = original.map(instance =>
    instance.id === 2 || instance.id === 8 ? { ...instance, x: instance.x + .5 } : instance
  );
  const changed = await page.evaluate(input => window.floorTest.snapshotOnce(input), {
    revision: 1,
    instances: moved.toReversed(),
  });
  record("sparse", changed);
  // IDs 2 and 8 share a variant but occupy nonadjacent slots. Only their
  // three-float destinations change; no whole-array or matrix upload is needed.
  expect(changed.receipt.changedInstances).toBe(2);
  expect(changed.after.bufferUploads.bytes - changed.before.bufferUploads.bytes).toBe(24);
  expect(changed.after.bufferUploads.calls - changed.before.bufferUploads.calls).toBe(2);
  expect(changed.expected.bytes).toBe(24);
  expect(changed.expected.calls).toBe(2);
  expect(changed.after.geometries).toBe(changed.before.geometries);
  await page.clock.runFor(128);
  const middle = await page.evaluate(() => ({
    info: window.floorTest.inspect(),
    positions: window.floorTest.instances(),
  }));
  expect(middle.info.instanceInterpolation).toBeGreaterThan(.4);
  expect(middle.info.instanceInterpolation).toBeLessThan(.6);
  expect(middle.info.bufferUploads).toEqual(changed.after.bufferUploads);
  const first = middle.positions.find(instance => instance.id === 2);
  expect(first?.x).toBeGreaterThan(original[0]?.x ?? Infinity);
  expect(first?.x).toBeLessThan(moved[0]?.x ?? -Infinity);
  await page.clock.runFor(144);
  const settled = await page.evaluate(input => window.floorTest.snapshotOnce(input), { revision: 2, instances: moved });
  expect(settled.after.bufferUploads.bytes - settled.before.bufferUploads.bytes).toBe(24);
  const stable = await page.evaluate(input => window.floorTest.snapshotOnce(input), {
    revision: 3,
    instances: moved.toReversed(),
  });
  record("stable", stable);
  expect(stable.receipt.changedInstances).toBe(0);
  expect(stable.draw.drawn).toBe(false);
  expect(stable.after.bufferUploads).toEqual(stable.before.bufferUploads);
  const removed = await page.evaluate(input => window.floorTest.snapshotOnce(input), {
    revision: 4,
    instances: moved.filter(instance => instance.id !== 2),
  });
  expect(removed.after.bufferUploads.bytes - removed.before.bufferUploads.bytes).toBe(4);
  expect(removed.instances.find(instance => instance.id === 2)?.visible).toBe(false);
  const returned = await page.evaluate(input => window.floorTest.snapshotOnce(input), {
    revision: 5,
    instances: moved,
  });
  expect(returned.after.bufferUploads.bytes - returned.before.bufferUploads.bytes).toBe(4);
  expect(returned.instances.find(instance => instance.id === 2)?.visible).toBe(true);
  expect(returned.after.geometries).toBe(changed.before.geometries);
  await page.clock.resume();
});

// @effect-diagnostics-next-line asyncFunction:off -- Playwright owns the browser callback and assertions.
test("invalid complete snapshots preserve accepted instance buffers", async ({ page }) => {
  await ready(page);
  const instances = await page.evaluate(() => window.floorTest.instances().map(({ id, x, y, z }) => ({ id, x, y, z })));
  await page.evaluate(input => window.floorTest.snapshotOnce(input), { revision: 1, instances });
  const before = await page.evaluate(() => ({
    info: window.floorTest.inspect(),
    positions: window.floorTest.instances(),
  }));
  for (
    const invalid of [
      { revision: 2, instances: [...instances, { id: 2, x: 0, y: 0, z: 0 }] },
      { revision: 2, instances: [...instances, { id: 5000, x: 0, y: 0, z: 0 }] },
      { revision: 2, instances: instances.map(instance => ({ ...instance, x: 1e100 })) },
      { revision: 1, instances: [] },
    ]
  ) {
    await expect(page.evaluate(input => window.floorTest.snapshot(input), invalid)).rejects.toThrow();
    const after = await page.evaluate(() => ({
      info: window.floorTest.inspect(),
      positions: window.floorTest.instances(),
    }));
    expect(after.positions).toEqual(before.positions);
    expect(after.info.snapshotRevision).toBe(1);
    expect(after.info.bufferUploads).toEqual(before.info.bufferUploads);
  }
  record("unchangedAfterRejection", before);
});

// @effect-diagnostics-next-line asyncFunction:off -- Playwright owns the browser callback and assertions.
test("GPU buffer accounting distinguishes allocations from exact typed source ranges", async ({ page }) => {
  await ready(page);
  const report = await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    const gl = canvas?.getContext("webgl2");
    const buffer = gl?.createBuffer();
    if (!gl || !buffer) return { available: false };
    const before = window.floorTest.inspect().bufferUploads;
    gl.bindBuffer(gl.COPY_WRITE_BUFFER, buffer);
    gl.bufferData(gl.COPY_WRITE_BUFFER, 64, gl.DYNAMIC_DRAW);
    const allocated = window.floorTest.inspect().bufferUploads;
    const floats = new Float32Array([1, 2, 3, 4, 5, 6]);
    gl.bufferSubData(gl.COPY_WRITE_BUFFER, 0, floats, 1, 2);
    gl.bufferSubData(gl.COPY_WRITE_BUFFER, 8, new Uint16Array([10, 20, 30, 40]), 1, 0);
    gl.bufferData(gl.COPY_WRITE_BUFFER, floats, gl.DYNAMIC_DRAW, 2, 3);
    gl.bufferSubData(gl.COPY_WRITE_BUFFER, 0, new DataView(new ArrayBuffer(8)), 2, 0);
    const after = window.floorTest.inspect().bufferUploads;
    const error = gl.getError();
    gl.deleteBuffer(buffer);
    return { available: true, before, allocated, after, error };
  });
  record("bufferRanges", report);
  expect(report.available).toBe(true);
  expect(report.error).toBe(0);
  if (report.before) {
    expect(report.allocated.bytes).toBe(report.before.bytes);
    expect(report.allocated.allocationBytes - report.before.allocationBytes).toBe(64);
    expect(report.after.bytes - report.before.bytes).toBe(32);
    expect(report.after.calls - report.before.calls).toBe(5);
    expect(report.after.updateBytes - report.before.updateBytes).toBe(20);
    expect(report.after.allocationBytes - report.before.allocationBytes).toBe(76);
  }
});
