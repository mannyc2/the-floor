import { describe, expect } from "bun:test";
import { Effect, Option, Result } from "effect";
import * as THREE from "three";
import { makeInstanceSnapshots } from "../src/map/_lib/renderer/instances";
import { effectTest } from "./_runtime";

const fixture = () => {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshBasicMaterial();
  const mesh = new THREE.InstancedMesh(geometry, material, 3);
  const positions = [10, 20, 30].map((x, index) => {
    mesh.setMatrixAt(index, new THREE.Matrix4().makeTranslation(x, 0, 0));
    return { id: index + 1, x, y: 0, z: 0 };
  });
  const clock = { now: 0, dirty: 0 };
  const snapshots = makeInstanceSnapshots(
    positions.map((position, index) => ({ id: position.id, mesh, maybeInstance: Option.some(index) })),
    () => clock.now,
    () => {
      clock.dirty++;
    },
    { value: 1 },
  );
  const buffers = () =>
    ["_INSTANCE_FROM", "_INSTANCE_TO"].map(name => {
      const attribute = geometry.getAttribute(name);
      return { values: Array.from(attribute.array), version: "version" in attribute ? attribute.version : -1 };
    });
  return { snapshots, clock, positions, buffers };
};

describe("Complete instance snapshots", () => {
  effectTest("wire order cannot change identity and stable targets do not dirty buffers", () =>
    Effect.gen(function*() {
      const { snapshots, clock, positions, buffers } = fixture();
      const receipt = yield* snapshots.snapshot({ revision: 0, instances: positions.toReversed() });
      expect(receipt).toEqual({ revision: 0, changedInstances: 0, changedAttributes: 0 });
      expect(clock.dirty).toBe(0);
      expect(snapshots.positions().map(position => position.target.x)).toEqual([10, 20, 30]);
      const before = buffers();
      yield* snapshots.snapshot({ revision: 1, instances: positions });
      expect(buffers()).toEqual(before);
      expect(clock.dirty).toBe(0);
    }));

  effectTest("late invalid identity, duplicate, overflow and revision errors are atomic", () =>
    Effect.gen(function*() {
      const { snapshots, positions, buffers } = fixture();
      yield* snapshots.snapshot({ revision: 4, instances: positions });
      const before = { buffers: buffers(), positions: snapshots.positions() };
      const first = { id: 1, x: 99, y: 0, z: 0 };
      const rejected = [
        { phase: "identity", input: { revision: 5, instances: [first, { id: 99, x: 0, y: 0, z: 0 }] } },
        { phase: "identity", input: { revision: 5, instances: [first, first] } },
        { phase: "coordinate", input: { revision: 5, instances: [first, { id: 2, x: 1e40, y: 0, z: 0 }] } },
        { phase: "revision", input: { revision: 4, instances: [first] } },
        { phase: "decode", input: { revision: 5, instances: [first, { id: 2, x: "bad", y: 0, z: 0 }] } },
      ];
      for (const { phase, input } of rejected) {
        const result = yield* Effect.result(snapshots.snapshot(input));
        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) expect(result.failure.phase).toBe(phase);
        expect(snapshots.revision()).toBe(4);
        expect({ buffers: buffers(), positions: snapshots.positions() }).toEqual(before);
      }
      yield* snapshots.snapshot({ revision: 5, instances: positions.toReversed() });
      expect(snapshots.positions()).toEqual(before.positions);
    }));

  effectTest(
    "an interrupted interpolation starts at the visible position and uploads no frame deltas",
    () =>
      Effect.gen(function*() {
        const { snapshots, clock, positions, buffers } = fixture();
        yield* snapshots.snapshot({
          revision: 0,
          instances: positions.map(position => ({ ...position, x: position.x + 4 })),
        });
        clock.now = 125;
        snapshots.advance();
        expect(snapshots.positions().map(position => position.x)).toEqual([12, 22, 32]);
        yield* snapshots.snapshot({
          revision: 1,
          instances: positions.map(position => ({ ...position, x: position.x + 8 })),
        });
        expect(snapshots.positions().map(position => position.x)).toEqual([12, 22, 32]);
        const afterSnapshot = buffers();
        clock.now = 250;
        snapshots.advance();
        expect(snapshots.positions().map(position => position.x)).toEqual([15, 25, 35]);
        expect(buffers()).toEqual(afterSnapshot);
        clock.now = 375;
        snapshots.advance();
        expect(snapshots.positions().map(position => position.x)).toEqual([18, 28, 38]);
        const settledDirty = clock.dirty;
        clock.now = 500;
        snapshots.advance();
        expect(clock.dirty).toBe(settledDirty);
        expect(buffers()).toEqual(afterSnapshot);
      }),
  );

  effectTest(
    "omitted identities hide and reappear at their destination without a phantom flight",
    () =>
      Effect.gen(function*() {
        const { snapshots, clock, positions } = fixture();
        const omitted = yield* snapshots.snapshot({
          revision: 0,
          instances: positions.filter(position => position.id !== 2),
        });
        expect(omitted.changedInstances).toBe(1);
        expect(snapshots.positions().map(position => position.visible)).toEqual([true, false, true]);
        clock.now = 100;
        yield* snapshots.snapshot({
          revision: 1,
          instances: positions.map(position => position.id === 2 ? { ...position, x: 40 } : position),
        });
        expect(snapshots.positions().map(position => ({ x: position.x, visible: position.visible }))).toEqual([
          { x: 10, visible: true },
          { x: 40, visible: true },
          { x: 30, visible: true },
        ]);
        expect(snapshots.interpolation.value).toBe(1);
      }),
  );
});
