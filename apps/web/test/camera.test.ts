import { describe, expect } from "bun:test";
import { Effect, Option } from "effect";
import { cameraFromQuery } from "../src/map/model";
import { effectTest } from "./_runtime";

describe("Camera URL boundary", () => {
  effectTest(
    "legacy links retain their original corner and invalid rotations reject the view",
    () =>
      Effect.sync(() => {
        expect(cameraFromQuery(new URLSearchParams("x=2&z=-1&extent=18"))).toEqual(
          Option.some({ x: 2, z: -1, extent: 18, rotation: 0 }),
        );
        expect(cameraFromQuery(new URLSearchParams("x=2&z=-1&extent=18&rotation=3"))).toEqual(
          Option.some({ x: 2, z: -1, extent: 18, rotation: 3 }),
        );
        for (const rotation of ["-1", "4", "1.5", "NaN", "Infinity", "east"]) {
          expect(Option.isNone(cameraFromQuery(new URLSearchParams(`x=2&z=-1&extent=18&rotation=${rotation}`)))).toBe(
            true,
          );
        }
        expect(Option.isNone(cameraFromQuery(new URLSearchParams("rotation=3")))).toBe(true);
      }),
  );
});
