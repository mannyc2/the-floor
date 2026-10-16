import { Config, Effect } from "effect";
import { expect, record, test } from "./fixture";

const phoneRenderer = Effect.runSync(
  Config.Literals(["apple", "swiftshader"], "FLOOR_PHONE_RENDERER").pipe(
    Config.withDefault("swiftshader"),
  ),
);

test.use(phoneRenderer === "apple" ? { channel: "chrome", launchOptions: { args: ["--use-angle=metal"] } } : {});

test.describe("Sustained phone snapshots", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
  });
  for (const desks of [12, 1000]) {
    // @effect-diagnostics-next-line asyncFunction:off -- Playwright owns the browser callback and assertions.
    test(`${desks} desks receive four snapshots per second within every phone frame budget`, async ({ page }) => {
      await page.goto(`/workbench/?desks=${desks}`);
      await expect(page.locator("#status")).toContainText(phoneRenderer === "apple" ? "Apple" : "SwiftShader");
      await expect.poll(() => page.evaluate(() => window.floorTest.inspect().draws)).toBeGreaterThan(1);
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
      const result = await page.evaluate(() => window.floorTest.snapshotStream());
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
      record("stream", result);
      expect(result.count).toBe(desks);
      expect(result.received).toHaveLength(48);
      expect(result.frames.length).toBeGreaterThan(48);
      expect(result.received.every(arrival => arrival.targetsMatch)).toBe(true);
      expect(result.durationMs).toBeGreaterThanOrEqual(12000);
      for (const [index, arrival] of result.received.entries()) {
        expect(arrival.revision).toBe(index + 16);
        const frames = result.frames.filter(frame => frame.revision === arrival.revision);
        expect(frames.length).toBeGreaterThan(0);
        expect(frames.reduce((sum, frame) => sum + frame.snapshots, 0)).toBe(1);
        expect(frames.reduce((sum, frame) => sum + frame.uploadBytes, 0)).toBe(arrival.expected.bytes);
        expect(frames.reduce((sum, frame) => sum + frame.uploadCalls, 0)).toBe(arrival.expected.calls);
        expect(arrival.expected.allocationCalls).toBe(0);
        expect(frames.filter(frame => frame.snapshots === 0).every(frame => frame.uploadBytes === 0)).toBe(true);
      }
      const failures = result.frames.filter(frame =>
        !Number.isFinite(frame.cpuMs) || frame.cpuMs < 0 || frame.cpuMs > 16.7
      );
      record("frameBudgetFailures", failures);
      expect(failures).toEqual([]);
      expect(result.info.snapshotRevision).toBe(63);
      expect(result.info.instanceInterpolation).toBe(1);
    });
  }
});
