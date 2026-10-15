/* oxlint-disable effecttsgo/async-function, effect/noAsyncFunction -- Playwright owns these native Promise callbacks and their awaited browser assertions. */
import { Predicate } from "effect";
import { expect, ready, record, stopDrag, test } from "./fixture";

// @effect-diagnostics-next-line asyncFunction:off -- Playwright owns the controlled browser clock and live Model assertions.
test("moving follow keeps interpolation local and commits one settled camera", async ({ page }) => {
  await page.clock.install({ time: "2026-10-14T12:00:00Z" });
  await ready(page);
  await page.clock.pauseAt("2026-10-14T13:00:00Z");
  await page.evaluate(() => window.floorTest.followInstance(2));
  await page.clock.runFor(1000);
  const before = await page.evaluate(() => window.floorTest.inspect());
  expect(before.flying).toBe(false);
  expect(before.following).toBe(true);
  await expect.poll(() => page.evaluate(() => window.floorTest.model()))
    .toMatchObject({ presentation: { camera: before.camera }, cameraCommits: before.restCommits });
  const modelBefore = await page.evaluate(() => window.floorTest.model());
  const urlBefore = page.url();
  const target = { x: before.camera.x + 4, z: before.camera.z + 2 };
  await page.evaluate(position => window.floorTest.moveFollowInstance(2, position.x, position.z), target);
  const moving = [];
  for (const elapsedMs of [96, 192]) {
    await page.clock.runFor(96);
    const engine = await page.evaluate(() => window.floorTest.inspect());
    const model = await page.evaluate(() => window.floorTest.model());
    expect(engine.instanceInterpolation).toBeGreaterThan(0);
    expect(engine.instanceInterpolation).toBeLessThan(1);
    expect(engine.camera.x).toBeGreaterThan(before.camera.x);
    expect(engine.camera.x).toBeLessThan(target.x);
    expect(engine.camera.z).toBeGreaterThan(before.camera.z);
    expect(engine.camera.z).toBeLessThan(target.z);
    expect(engine.restCommits).toBe(before.restCommits);
    expect(model.cameraCommits).toBe(modelBefore.cameraCommits);
    expect(model.presentation.camera).toEqual(modelBefore.presentation.camera);
    expect(page.url()).toBe(urlBefore);
    moving.push({ elapsedMs, camera: engine.camera, commits: model.cameraCommits });
  }
  await page.clock.runFor(96);
  const settled = await page.evaluate(() => window.floorTest.inspect());
  expect(settled.instanceInterpolation).toBe(1);
  expect(settled.camera.x).toBeCloseTo(target.x, 6);
  expect(settled.camera.z).toBeCloseTo(target.z, 6);
  expect(settled.restCommits).toBe(before.restCommits + 1);
  await expect.poll(() => page.evaluate(() => window.floorTest.model()))
    .toMatchObject({ presentation: { camera: settled.camera }, cameraCommits: modelBefore.cameraCommits + 1 });
  await expect.poll(() => page.evaluate(() => Number(new URL(location.href).searchParams.get("x"))))
    .toBe(settled.camera.x);
  await page.clock.runFor(96);
  expect((await page.evaluate(() => window.floorTest.inspect())).restCommits).toBe(settled.restCommits);
  expect((await page.evaluate(() => window.floorTest.model())).cameraCommits).toBe(modelBefore.cameraCommits + 1);
  record("settledFollow", { source: "synthetic full instance snapshot", before, moving, settled });
  await page.clock.resume();
});

// @effect-diagnostics-next-line asyncFunction:off -- Playwright drives real input and awaits the renderer's Model and frame observations.
test("moving instance follow reaches the live Model and input cancels the target subscription", async ({ page }) => {
  await ready(page);
  await page.evaluate(() => window.floorTest.followInstance(2));
  await page.evaluate(() => window.floorTest.moveFollowInstance(2, -2, -1));
  await expect.poll(() => page.evaluate(() => window.floorTest.inspect().flying)).toBe(false);
  const checkpoints = [];
  for (const target of [{ x: -2, z: -1 }, { x: 1, z: 2 }, { x: -3, z: 1 }]) {
    await page.evaluate(position => window.floorTest.moveFollowInstance(2, position.x, position.z), target);
    await expect.poll(() => page.evaluate(() => window.floorTest.inspect().camera.x)).toBeCloseTo(target.x, 6);
    await expect.poll(() => page.evaluate(() => window.floorTest.inspect().camera.z)).toBeCloseTo(target.z, 6);
    await expect.poll(() => page.evaluate(() => window.floorTest.model())).toMatchObject({
      presentation: { camera: { x: expect.closeTo(target.x, 6), z: expect.closeTo(target.z, 6) } },
    });
    const engine = await page.evaluate(() => window.floorTest.inspect());
    const model = await page.evaluate(() => window.floorTest.model());
    checkpoints.push({ target, engine: engine.camera, model: model.presentation.camera, commits: model.cameraCommits });
    expect(engine.following).toBe(true);
  }
  const canvas = page.locator("#map canvas");
  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  if (Predicate.isNull(bounds)) return;
  const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  for (const input of ["drag", "wheel", "key"]) {
    await page.evaluate(() => window.floorTest.followInstance(2));
    await expect.poll(() => page.evaluate(() => window.floorTest.inspect().flying)).toBe(false);
    await page.mouse.move(center.x, center.y);
    if (input === "drag") {
      await page.mouse.down();
      await page.mouse.move(center.x + 50, center.y + 30, { steps: 8 });
      await stopDrag(page);
    } else if (input === "wheel") {
      await page.mouse.wheel(1, 0);
    } else {
      await canvas.focus();
      await page.keyboard.press("a");
    }
    await expect.poll(() => page.evaluate(() => window.floorTest.inspect().following)).toBe(false);
    const stopped = await page.evaluate(() => window.floorTest.inspect().camera);
    await expect.poll(() => page.evaluate(() => window.floorTest.model()))
      .toMatchObject({ presentation: { camera: stopped } });
    const next = input === "drag" ? { x: 4, z: -2 } : input === "wheel" ? { x: -2, z: 3 } : { x: 5, z: 1 };
    await page.evaluate(position => window.floorTest.moveFollowInstance(2, position.x, position.z), next);
    await expect.poll(() => page.evaluate(() => window.floorTest.instances().find(instance => instance.id === 2)?.x))
      .toBeCloseTo(next.x, 6);
    expect(await page.evaluate(() => window.floorTest.inspect().camera)).toEqual(stopped);
    expect((await page.evaluate(() => window.floorTest.model())).presentation.camera).toEqual(stopped);
    checkpoints.push({
      input,
      stopped,
      model: (await page.evaluate(() => window.floorTest.model())).presentation.camera,
    });
  }
  await canvas.evaluate(element => {
    if (element instanceof HTMLCanvasElement) {
      element.addEventListener("pointermove", event => {
        element.dataset["pointerId"] = String(event.pointerId);
      }, { once: true });
    }
  });
  await page.mouse.move(center.x + 1, center.y + 1);
  await expect(canvas).toHaveAttribute("data-pointer-id", /\d+/);
  const pointerId = Number(await canvas.getAttribute("data-pointer-id"));
  const interruptions = [];
  for (const input of ["click", "key"]) {
    const interruption = await page.evaluate(
      ({ kind, id }) => window.floorTest.interruptFollow(2, kind === "click" ? "click" : "key", id),
      { kind: input, id: pointerId },
    );
    expect(interruption.following).toBe(false);
    expect(interruption.flying).toBe(false);
    expect(interruption.beforeInput).not.toEqual(interruption.initial);
    expect(interruption.afterInput).toEqual(interruption.beforeInput);
    const stopped = interruption.afterInput;
    await expect.poll(() => page.evaluate(() => window.floorTest.model()))
      .toMatchObject({ presentation: { camera: stopped } });
    await expect.poll(() => page.evaluate(() => Number(new URL(location.href).searchParams.get("x"))))
      .toBe(stopped.x);
    interruptions.push(interruption);
  }
  await page.evaluate(() => window.floorTest.followInstance(2));
  await page.evaluate(() =>
    window.floorTest.snapshot({
      revision: window.floorTest.inspect().snapshotRevision + 1,
      instances: window.floorTest.instances().filter(instance => instance.id !== 2).map(instance => ({
        id: instance.id,
        ...instance.target,
      })),
    })
  );
  await expect.poll(() => page.evaluate(() => window.floorTest.inspect().following)).toBe(false);
  const absent = await page.evaluate(() => window.floorTest.inspect().camera);
  await expect.poll(() => page.evaluate(() => window.floorTest.model()))
    .toMatchObject({ presentation: { camera: absent } });
  checkpoints.push({ input: "target-removed", stopped: absent });
  record("follow", {
    entity: 2,
    source: "synthetic full instance snapshots",
    checkpoints,
    interruptions: {
      input: "native event dispatch on first moving frame; real pointer ID captured from mouse hover",
      observations: interruptions,
    },
  });
});

// @effect-diagnostics-next-line asyncFunction:off -- Playwright supplies matched native pointer gestures and waits for their measured observations.
test("camera drag comparison measures local input and real Foldkit Model presentation", async ({ page }) => {
  const results = [];
  for (const mode of ["local", "model", "model", "local"]) {
    await ready(page);
    await page.evaluate(value => window.floorTest.startCameraComparison(value === "model" ? "model" : "local"), mode);
    const canvas = page.locator("#map canvas");
    const bounds = await canvas.boundingBox();
    expect(bounds).not.toBeNull();
    if (Predicate.isNull(bounds)) return;
    const origin = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    await page.mouse.move(origin.x, origin.y);
    await page.mouse.down();
    for (const index of Array.from({ length: 24 }, (_, item) => item + 1)) {
      await page.mouse.move(origin.x + index * 3, origin.y + index);
      await expect.poll(() => page.evaluate(() => window.floorTest.cameraComparison().pending)).toBe(false);
    }
    await stopDrag(page);
    const result = await page.evaluate(() => window.floorTest.finishCameraComparison());
    const model = await page.evaluate(() => window.floorTest.model());
    const rendered = await page.evaluate(() => window.floorTest.inspect().camera);
    expect(result.failure).toBeNull();
    expect(result.samples).toHaveLength(24);
    expect(result.samples.every(sample => !sample.coalesced && Predicate.isNumber(sample.latencyMs))).toBe(true);
    expect(result.modelUpdates).toBe(mode === "model" ? 24 : 0);
    await expect.poll(() => page.evaluate(() => window.floorTest.model()))
      .toMatchObject({ presentation: { camera: rendered } });
    results.push({ ...result, modelCommits: model.cameraCommits, finalCamera: rendered });
  }
  record("comparison", {
    endpoint:
      "native pointer handler entry to the shared renderer draw-end callback after both passes; excludes observer callback cost",
    limits:
      "Serial acknowledged small drags; excludes compositor latency and inertial release; desktop SwiftShader, not a real phone",
    order: "local, model, model, local",
    results,
  });
});

// @effect-diagnostics-next-line asyncFunction:off -- Playwright observes the real fixed-follow button and mounted presentation queue.
test("completed fixed follow releases camera ownership to later presentations", async ({ page }) => {
  await ready(page);
  await page.getByRole("button", { name: "Follow", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.floorTest.inspect())).toMatchObject({
    camera: { x: -4, z: -3 },
    flying: false,
    following: false,
  });
  const settled = await page.evaluate(() => window.floorTest.inspect());
  await expect.poll(() => page.evaluate(() => window.floorTest.model()))
    .toMatchObject({ presentation: { camera: settled.camera } });
  const presentation = (await page.evaluate(() => window.floorTest.model())).presentation;
  const next = { ...presentation, revision: presentation.revision + 1, camera: { ...settled.camera, x: 3, z: 2 } };
  await page.evaluate(value => window.floorTest.present(value), next);
  await expect.poll(() => page.evaluate(() => window.floorTest.inspect().camera)).toEqual(next.camera);
  record("fixedFollowReleased", { settled, applied: await page.evaluate(() => window.floorTest.inspect()) });
});
