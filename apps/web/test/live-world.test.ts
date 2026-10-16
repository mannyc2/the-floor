import { expect } from "bun:test";
import { Effect, Option, Result } from "effect";
import * as THREE from "three";
import { makeInstanceSnapshots } from "../src/map/_lib/renderer/instances";
import { effectTest } from "./_runtime";

const liveInstances = Effect.gen(function*() {
  const geometry = yield* Effect.acquireRelease(
    Effect.sync(() => new THREE.BoxGeometry()),
    value => Effect.sync(() => value.dispose()),
  );
  const material = yield* Effect.acquireRelease(
    Effect.sync(() => new THREE.MeshBasicMaterial()),
    value => Effect.sync(() => value.dispose()),
  );
  const mesh = yield* Effect.acquireRelease(
    Effect.sync(() => new THREE.InstancedMesh(geometry, material, 2)),
    value => Effect.sync(() => value.dispose()),
  );
  mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(10, 0, 20));
  mesh.setMatrixAt(1, new THREE.Matrix4().makeTranslation(-10, 0, -20));
  const clock = { now: 0 };
  const snapshots = makeInstanceSnapshots(
    [
      { id: 2, mesh, maybeInstance: Option.some(0) },
      { id: 3, mesh, maybeInstance: Option.some(1) },
    ],
    () => clock.now,
    () => {},
    { value: 1 },
    { value: 0 },
    true,
  );
  return { snapshots, clock };
});

effectTest("live slots stay hidden until their first canonical positions arrive", () =>
  Effect.gen(function*() {
    const { snapshots, clock } = yield* liveInstances;
    expect(snapshots.positions().map(position => position.visible)).toEqual([false, false]);
    yield* snapshots.snapshotLatest(
      { revision: 1, instances: [{ id: 2, x: 2, y: 0, z: 0, active: true }] },
      () => true,
    );
    expect(snapshots.positions().map(position => ({ x: position.x, z: position.z, visible: position.visible })))
      .toEqual([
        { x: 2, z: 0, visible: true },
        { x: -10, z: -20, visible: false },
      ]);
    expect(snapshots.interpolation.value).toBe(1);
    clock.now = 125;
    snapshots.advance();
    expect(snapshots.positions()[0]?.x).toBe(2);
  }));

effectTest("obsolete world commands cannot rewind a newer revision or a new owner", () =>
  Effect.gen(function*() {
    const { snapshots } = yield* liveInstances;
    yield* snapshots.snapshotLatest({ revision: 3, instances: [{ id: 2, x: 2, y: 0, z: 0 }] }, () => true);
    const accepted = snapshots.positions();
    const oldRevision = yield* snapshots.snapshotLatest(
      { revision: 2, instances: [{ id: 2, x: 99, y: 0, z: 0 }] },
      () => true,
    );
    expect(oldRevision).toEqual({ revision: 3, changedInstances: 0, changedAttributes: 0 });
    const oldOwner = yield* snapshots.snapshotLatest({ revision: 4, instances: [{ id: 99, x: 99, y: 0, z: 0 }] }, () =>
      false);
    expect(oldOwner).toEqual({ revision: 3, changedInstances: 0, changedAttributes: 0 });
    expect(snapshots.positions()).toEqual(accepted);
    expect(snapshots.revision()).toBe(3);
    const strict = yield* snapshots.snapshot({ revision: 2, instances: [] }).pipe(Effect.result);
    expect(Result.isFailure(strict)).toBe(true);
    if (Result.isFailure(strict)) {
      expect(strict.failure.phase).toBe("revision");
    }
  }));

effectTest("a current world command with an invalid identity still fails atomically", () =>
  Effect.gen(function*() {
    const { snapshots } = yield* liveInstances;
    yield* snapshots.snapshotLatest({ revision: 1, instances: [{ id: 2, x: 2, y: 0, z: 0 }] }, () => true);
    const accepted = snapshots.positions();
    const invalid = yield* snapshots.snapshotLatest({
      revision: 2,
      instances: [{ id: 2, x: 8, y: 0, z: 0 }, { id: 99, x: 3, y: 0, z: 0 }],
    }, () => true).pipe(Effect.result);
    expect(Result.isFailure(invalid)).toBe(true);
    if (Result.isFailure(invalid)) expect(invalid.failure.phase).toBe("identity");
    expect(snapshots.positions()).toEqual(accepted);
    expect(snapshots.revision()).toBe(1);
  }));

const markedInstances = Effect.gen(function*() {
  const geometry = yield* Effect.acquireRelease(
    Effect.sync(() => new THREE.BoxGeometry()),
    value => Effect.sync(() => value.dispose()),
  );
  const material = yield* Effect.acquireRelease(
    Effect.sync(() => new THREE.MeshBasicMaterial()),
    value => Effect.sync(() => value.dispose()),
  );
  const desks = yield* Effect.acquireRelease(
    Effect.sync(() => new THREE.InstancedMesh(geometry, material, 2)),
    value => Effect.sync(() => value.dispose()),
  );
  const markers = yield* Effect.acquireRelease(
    Effect.sync(() => new THREE.InstancedMesh(geometry.clone(), material, 1)),
    value => Effect.sync(() => value.dispose()),
  );
  const clock = { now: 0 };
  const snapshots = makeInstanceSnapshots(
    [
      { id: 2, mesh: desks, maybeInstance: Option.some(0) },
      { id: 3, mesh: desks, maybeInstance: Option.some(1) },
      { id: 2, mesh: markers, maybeInstance: Option.some(0), marker: true },
    ],
    () => clock.now,
    () => {},
    { value: 1 },
    { value: 0 },
    true,
  );
  return { snapshots, clock };
});

effectTest("an agent marker shares its desk's slot and moves on the position clock", () =>
  Effect.gen(function*() {
    const { snapshots, clock } = yield* markedInstances;
    expect(Option.isNone(snapshots.marker(2))).toBe(true);
    yield* snapshots.snapshotLatest({
      revision: 1,
      instances: [{ id: 2, x: 2, y: 0, z: 0, marker: { x: 2.3, y: 0, z: 2 } }, { id: 3, x: 4, y: 0, z: 0 }],
    }, () => true);
    // Desk positions are unaffected by the marker sharing their identity.
    expect(snapshots.positions().map(position => [position.id, position.x])).toEqual([[2, 2], [3, 4]]);
    expect(snapshots.marker(2)).toEqual(Option.some({ x: Math.fround(2.3), y: 0, z: 2 }));
    expect(Option.isNone(snapshots.marker(3))).toBe(true);
    yield* snapshots.snapshotLatest({
      revision: 2,
      instances: [{ id: 2, x: 2, y: 0, z: 0, marker: { x: 0, y: 0, z: 0 } }, { id: 3, x: 4, y: 0, z: 0 }],
    }, () => true);
    // A move starts where the marker stands and reaches its target in one interval.
    expect(snapshots.interpolation.value).toBe(0);
    expect(snapshots.marker(2)).toEqual(Option.some({ x: Math.fround(2.3), y: 0, z: 2 }));
    clock.now = 125;
    snapshots.advance();
    expect(Option.map(snapshots.marker(2), position => position.z)).toEqual(Option.some(1));
    clock.now = 250;
    snapshots.advance();
    expect(snapshots.marker(2)).toEqual(Option.some({ x: 0, y: 0, z: 0 }));
    // An unpositioned place removes the marker; the desk stays.
    yield* snapshots.snapshotLatest({ revision: 3, instances: [{ id: 2, x: 2, y: 0, z: 0 }] }, () => true);
    expect(Option.isNone(snapshots.marker(2))).toBe(true);
    expect(snapshots.positions()[0]?.visible).toBe(true);
    // A marker for a slot without one fails the whole packet.
    const invalid = yield* snapshots.snapshotLatest({
      revision: 4,
      instances: [{ id: 2, x: 9, y: 0, z: 0 }, { id: 3, x: 4, y: 0, z: 0, marker: { x: 1, y: 0, z: 1 } }],
    }, () => true).pipe(Effect.result);
    expect(Result.isFailure(invalid)).toBe(true);
    if (Result.isFailure(invalid)) expect(invalid.failure.phase).toBe("identity");
    expect(snapshots.revision()).toBe(3);
    expect(snapshots.positions()[0]?.x).toBe(2);
  }));
