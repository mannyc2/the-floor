import { Effect, Option, Result, Schema } from "effect";
import * as THREE from "three";
import type { Entity } from "./scene";

const Position = Schema.Struct({ x: Schema.Finite, y: Schema.Finite, z: Schema.Finite });
export const InstanceSnapshot = Schema.Struct({
  revision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  instances: Schema.Array(Schema.Struct({
    id: Schema.Int.check(Schema.isGreaterThan(0)),
    ...Position.fields,
  })),
});
export type InstanceSnapshot = typeof InstanceSnapshot.Type;
type Position = typeof Position.Type;
const decodeSnapshot = Schema.decodeUnknownEffect(InstanceSnapshot);

export class InstanceSnapshotFailure extends Schema.TaggedError<InstanceSnapshotFailure>()("InstanceSnapshotFailure", {
  phase: Schema.String,
  cause: Schema.Defect(),
}) {}

const vectorAttribute = (count: number, size: number) =>
  new THREE.InstancedBufferAttribute(new Float32Array(count * size), size).setUsage(THREE.DynamicDrawUsage);
const mix = (from: Position, to: Position, progress: number): Position => ({
  x: from.x + (to.x - from.x) * progress,
  y: from.y + (to.y - from.y) * progress,
  z: from.z + (to.z - from.z) * progress,
});
const same = (a: Position, b: Position) => a.x === b.x && a.y === b.y && a.z === b.z;

const write = (attribute: THREE.InstancedBufferAttribute, index: number, x: number, y: number, z: number) => {
  if (
    attribute.getX(index) === x && attribute.getY(index) === y
    && attribute.getZ(index) === z
  ) return 0;
  attribute.setXYZ(index, x, y, z);
  attribute.addUpdateRange(index * attribute.itemSize, 3);
  attribute.needsUpdate = true;
  return 1;
};

// Each independently animated channel owns its interval, while all channels use
// this one clock implementation. A camera or theme presentation cannot rewind a
// live position packet, and recorded negative playback still reaches its start.
const interpolationClock = (now: () => number, dirty: () => void, uniform: { value: number }) => {
  const state = { anchor: now(), offset: uniform.value * 250, rate: 0 };
  const read = () => Math.max(0, Math.min(1, (state.offset + (now() - state.anchor) * state.rate) / 250));
  const setUniform = (value: number) => {
    if (value !== uniform.value) {
      uniform.value = value;
      dirty();
    }
  };
  const start = (offset: number, rate: number) => {
    state.anchor = now();
    state.offset = offset;
    state.rate = rate;
    setUniform(read());
  };
  return {
    read,
    start,
    restart: (moving: boolean) => start(moving ? 0 : 250, moving ? 1 : 0),
    advance: () => {
      if (state.rate === 0) return;
      const value = read();
      setUniform(value);
      if ((state.rate > 0 && value === 1) || (state.rate < 0 && value === 0)) {
        state.offset = value * 250;
        state.rate = 0;
      }
    },
  };
};

export const makeInstanceSnapshots = (
  entities: ReadonlyArray<Entity>,
  now: () => number,
  dirty: () => void,
  interpolation: { value: number },
  recordedInterpolation = { value: 0 },
) => {
  const positions = interpolationClock(now, dirty, interpolation);
  const recorded = interpolationClock(now, dirty, recordedInterpolation);
  const buffers = new Map<number, {
    from: THREE.InstancedBufferAttribute;
    to: THREE.InstancedBufferAttribute;
  }>();
  const members = entities.flatMap(entity => {
    const mesh = entity.mesh;
    const geometry = mesh.geometry;
    if (!(mesh instanceof THREE.InstancedMesh) || Option.isNone(entity.maybeInstance)) return [];
    let attributes = buffers.get(mesh.id);
    if (!attributes) {
      attributes = {
        // Visibility shares the fourth lane to stay within WebGL's sixteen
        // vertex attributes, including Three's four-lane instance matrix.
        from: vectorAttribute(mesh.count, 4),
        to: vectorAttribute(mesh.count, 3),
      };
      for (let index = 0; index < mesh.count; index++) attributes.from.setW(index, 1);
      geometry.setAttribute("_INSTANCE_FROM", attributes.from);
      geometry.setAttribute("_INSTANCE_TO", attributes.to);
      buffers.set(mesh.id, attributes);
    }
    const index = entity.maybeInstance.value;
    const matrix = new THREE.Matrix4();
    mesh.getMatrixAt(index, matrix);
    const base = new THREE.Vector3().setFromMatrixPosition(matrix);
    return [{
      id: entity.id,
      mesh: entity.mesh,
      index,
      attributes,
      base: { x: base.x, y: base.y, z: base.z },
      from: { x: 0, y: 0, z: 0 },
      to: { x: 0, y: 0, z: 0 },
      visible: true,
      staged: { x: 0, y: 0, z: 0, present: false },
    }];
  });
  const byId = new Map(members.map(member => [member.id, member]));
  // Staging is reusable and invisible to rendering. Validation can reject a
  // complete packet without changing accepted buffers, while avoiding thousands
  // of short-lived plans and Option wrappers on every 4 Hz arrival.
  const state = { revision: -1 };
  const stageSnapshot = (next: InstanceSnapshot): Result.Result<void, InstanceSnapshotFailure> => {
    // Validate the whole snapshot before writing. Identity is independent of
    // incoming order; omitted slots disappear and can return without allocating
    // geometry. Growing this fixed scene belongs to world integration.
    for (const member of members) member.staged.present = false;
    for (const target of next.instances) {
      const member = byId.get(target.id);
      if (!member) {
        return Result.fail(new InstanceSnapshotFailure({ phase: "identity", cause: { unknown: target.id } }));
      }
      if (member.staged.present) {
        return Result.fail(new InstanceSnapshotFailure({ phase: "identity", cause: { duplicate: target.id } }));
      }
      const x = Math.fround(target.x - member.base.x);
      const y = Math.fround(target.y - member.base.y);
      const z = Math.fround(target.z - member.base.z);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        return Result.fail(new InstanceSnapshotFailure({ phase: "coordinate", cause: { overflow: target.id } }));
      }
      member.staged.x = x;
      member.staged.y = y;
      member.staged.z = z;
      member.staged.present = true;
    }
    return Result.void;
  };
  const commitSnapshot = (next: InstanceSnapshot) => {
    const amount = positions.read();
    let changedInstances = 0;
    let changedAttributes = 0;
    let moving = false;
    for (const member of members) {
      const visible = member.staged.present;
      let changes = 0;
      if (visible) {
        const { x, y, z } = member.staged;
        // A delayed packet starts at the position already on screen. Reusing
        // the previous target here would jump when delivery is not perfectly periodic.
        member.from.x = member.visible ? Math.fround(member.from.x + (member.to.x - member.from.x) * amount) : x;
        member.from.y = member.visible ? Math.fround(member.from.y + (member.to.y - member.from.y) * amount) : y;
        member.from.z = member.visible ? Math.fround(member.from.z + (member.to.z - member.from.z) * amount) : z;
        member.to.x = x;
        member.to.y = y;
        member.to.z = z;
        changes += write(member.attributes.from, member.index, member.from.x, member.from.y, member.from.z);
        changes += write(member.attributes.to, member.index, x, y, z);
        moving ||= !same(member.from, member.to);
      }
      if (member.visible !== visible) {
        member.attributes.from.setW(member.index, visible ? 1 : 0);
        member.attributes.from.addUpdateRange(member.index * 4 + 3, 1);
        member.attributes.from.needsUpdate = true;
        member.visible = visible;
        changes++;
      }
      // GPU translation can leave the authored bounds. Disabling the coarse
      // mesh cull avoids dropping moved instances without a per-frame CPU rebuild.
      member.mesh.frustumCulled = false;
      changedAttributes += changes;
      if (changes > 0) changedInstances++;
    }
    state.revision = next.revision;
    positions.restart(moving);
    if (changedAttributes > 0) dirty();
    return { revision: state.revision, changedInstances, changedAttributes };
  };
  const snapshot = Effect.fn("Renderer.instanceSnapshot")(function*(input: Schema.Json) {
    const next = yield* decodeSnapshot(input).pipe(
      Effect.mapError(cause => new InstanceSnapshotFailure({ phase: "decode", cause })),
    );
    // Reusable staging belongs to one arrival until it commits. Keeping the
    // revision check, validation, and commit in one synchronous callback prevents
    // another fiber from replacing staged values at a cooperative yield boundary.
    return yield* Effect.suspend(() => {
      if (next.revision <= state.revision) {
        return Effect.fail(
          new InstanceSnapshotFailure({
            phase: "revision",
            cause: { current: state.revision, next: next.revision },
          }),
        );
      }
      const staged = stageSnapshot(next);
      if (Result.isFailure(staged)) return Effect.fail(staged.failure);
      return Effect.succeed(commitSnapshot(next));
    });
  });
  return {
    snapshot,
    present: (sampleTime: number, intervalStart: number, rate: number) =>
      recorded.start(sampleTime - intervalStart, rate),
    interpolation,
    revision: () => state.revision,
    advance: () => {
      positions.advance();
      recorded.advance();
    },
    positions: () =>
      members.map(member => {
        const offset = mix(member.from, member.to, interpolation.value);
        return {
          id: member.id,
          x: member.base.x + offset.x,
          y: member.base.y + offset.y,
          z: member.base.z + offset.z,
          visible: member.visible,
          target: {
            x: member.base.x + member.to.x,
            y: member.base.y + member.to.y,
            z: member.base.z + member.to.z,
          },
        };
      }),
  };
};
