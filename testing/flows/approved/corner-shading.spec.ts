import { materialPalette } from "@floor/atlas/materials";
import { Effect, Schema } from "effect";
import { Rotation } from "../../../apps/web/src/map/model";
import { ReferenceScene } from "../../../apps/web/workbench/_lib/reference-scene";
import dayMaterial from "../../look/scenes/materials-day.json" with { type: "json" };
import { expect, record, test } from "../renderer/fixture";

test.use({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1 });

// The picked material scene at every quarter turn. Face interiors and entity
// ids are specified independently of the shader, so reading actual pixels
// catches a reversed view-space rule or a band that follows the room.
for (const rotation of Rotation.literals) {
  for (const theme of ["day", "night"] satisfies ReadonlyArray<"day" | "night">) {
    // @effect-diagnostics-next-line asyncFunction:off -- Playwright owns the real renderer capture at each corner.
    test(`corner ${rotation} ${theme} shows the top, a dark right side and a light left side`, async ({ page }) => {
      const reference = await Effect.runPromise(
        Schema.encodeEffect(Schema.fromJsonString(ReferenceScene))({ view: "materials", rotation }),
      );
      const query = new URLSearchParams(
        Object.entries({ ...dayMaterial.capture, theme }).map(([key, value]) => [key, String(value)]),
      );
      query.set("reference", reference);
      await page.clock.setFixedTime(dayMaterial.capture.fixedTimeEpochMs);
      await page.goto(`/look/?${query}`);
      await expect.poll(() => page.evaluate(() => window.floorLook?.state()._tag), { timeout: 30000 }).toBe("Ready");
      const state = await page.evaluate(() => window.floorTest.inspect());
      expect(state.renderer).toContain("SwiftShader");
      expect(state.camera.rotation).toBe(rotation);
      expect(state.theme).toBe(theme);
      // The camera's right vector is (corner z, 0, -corner x), so the visible
      // x-face is dark at even corners and the visible z-face at odd ones.
      const xSign = rotation < 2 ? 1 : -1;
      const zSign = rotation === 0 || rotation === 3 ? 1 : -1;
      const xDark = rotation % 2 === 0;
      const probes = [
        { name: "top", x: 0, y: 4.27, z: 0, entity: 3004, color: materialPalette.colors["timber-3"][theme] },
        {
          name: "x-side",
          x: 3.45 * xSign,
          y: .95,
          z: 0,
          entity: xSign === 1 ? 3032 : 3084,
          color: materialPalette.colors[xDark ? "timber-1" : "timber-2"][theme],
        },
        {
          name: "z-side",
          x: 0,
          y: .95,
          z: 3.45 * zSign,
          entity: zSign === 1 ? 3006 : 3058,
          color: materialPalette.colors[xDark ? "timber-2" : "timber-1"][theme],
        },
      ];
      const samples = await page.evaluate(points => {
        const { width, height, dpr } = window.floorTest.inspect();
        const bytes = window.floorTest.frame();
        return points.map(point => {
          const screen = window.floorTest.project(point.x, point.y, point.z);
          const x = Math.floor(screen.x * dpr), y = Math.floor(screen.y * dpr);
          const offset = ((height * dpr - 1 - y) * width * dpr + x) * 4;
          return {
            inViewport: x >= 0 && y >= 0 && x < width * dpr && y < height * dpr,
            entity: window.floorTest.pick(screen.x, screen.y),
            rgba: bytes.slice(offset, offset + 4),
          };
        });
      }, probes);
      record("cornerFacePixels", { rotation, theme, probes, samples });
      expect(samples).toEqual(probes.map(probe => ({
        inViewport: true,
        entity: probe.entity,
        rgba: [probe.color >> 16 & 255, probe.color >> 8 & 255, probe.color & 255, 255],
      })));
    });
  }
}
