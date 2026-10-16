import { AgentId, ChainRef, WorldId } from "@floor/contract/identifiers";
import { WorldSnapshot } from "@floor/contract/world-stream";
import { assignAgent, createWorld } from "@floor/world";
import { expect } from "bun:test";
import { Effect, Option, Result } from "effect";
import * as THREE from "three";
import { makeInstanceSnapshots } from "../src/map/_lib/renderer/instances";
import { initialModel, update } from "../src/map/main";
import { Message } from "../src/map/message";
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

effectTest("a second occupied floor is explicitly unavailable in the first-trade viewer", () =>
  Effect.gen(function*() {
    const id = WorldId.make("synthetic-viewer-growth");
    const chain = ChainRef.make("solana:synthetic-viewer-a");
    const first = AgentId.make("synthetic-first-agent");
    const second = AgentId.make("synthetic-second-agent");
    const empty = yield* Effect.fromResult(createWorld(id, chain));
    const one = yield* Effect.fromResult(assignAgent(empty, first, chain));
    const two = yield* Effect.fromResult(assignAgent(one, second, ChainRef.make("solana:synthetic-viewer-b")));
    const snapshot = WorldSnapshot.make({
      model: two,
      chain,
      sequence: 2,
      checkpoint: Option.none(),
      agents: [first, second].map(agent => ({ agent, state: Option.none(), receipt: Option.none() })),
    });
    const next = update(
      initialModel(12, Option.none(), Option.some({ world: id, chain })),
      Message.ReceivedWorldSnapshot({ snapshot }),
    );
    expect(next.model.status._tag).toBe("Failed");
    if (next.model.status._tag === "Failed") {
      expect(next.model.status.reason).toBe("Viewing more than one occupied floor is not yet available.");
    }
    expect(next.commands ?? []).toEqual([]);
  }));
