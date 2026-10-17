import { Effect, Option, Result, Schema } from "effect";
import * as THREE from "three";
import type { Entity } from "./scene";

const Position = Schema.Struct({ x: Schema.Finite, y: Schema.Finite, z: Schema.Finite });
// A slot's turn about +Y in radians; omitted, it keeps its authored heading.
const yaw = Schema.optionalKey(Schema.Finite);
const Index = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
export const InstanceSnapshot = Schema.Struct({
  revision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  instances: Schema.Array(Schema.Struct({
    id: Schema.Int.check(Schema.isGreaterThan(0)),
    ...Position.fields,
    active: Schema.optionalKey(Schema.Boolean),
    yaw,
    // Where this slot's agent stands; omitted while its place has no position.
    marker: Schema.optionalKey(Schema.Struct({
      ...Position.fields,
      yaw,
      // Which of the slot's marker meshes stands there (a live figure's pose)
      // and which colour its tinted faces take (the figure's jacket).
      variant: Schema.optionalKey(Index),
      tint: Schema.optionalKey(Index),
    })),
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
const writeFourth = (attribute: THREE.InstancedBufferAttribute, index: number, value: number) => {
  if (attribute.itemSize < 4 || attribute.getW(index) === value) return 0;
  attribute.setW(index, value);
  attribute.addUpdateRange(index * 4 + 3, 1);
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

const turn = new THREE.Matrix4();
const writeYaw = (matrices: THREE.InstancedBufferAttribute, index: number, base: Position, value: number) => {
  turn.makeRotationY(value).setPosition(base.x, base.y, base.z).toArray(matrices.array, index * 16);
  matrices.addUpdateRange(index * 16, 16);
  matrices.needsUpdate = true;
  return 1;
};
const writeTint = (geometry: THREE.BufferGeometry, index: number, value: number) => {
  const attribute = geometry.getAttribute("_TINT");
  if (!(attribute instanceof THREE.InstancedBufferAttribute) || attribute.getX(index) === value) return 0;
  attribute.setX(index, value);
  attribute.addUpdateRange(index, 1);
  attribute.needsUpdate = true;
  return 1;
};

export const makeInstanceSnapshots = (
  entities: ReadonlyArray<Entity>,
  now: () => number,
  dirty: () => void,
  interpolation: { value: number },
  recordedInterpolation = { value: 0 },
  live = false,
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
        to: vectorAttribute(mesh.count, live ? 4 : 3),
      };
      for (let index = 0; index < mesh.count; index++) attributes.from.setW(index, live ? 0 : 1);
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
      marker: entity.marker === true,
      variant: entity.variant ?? 0,
      mesh: entity.mesh,
      matrices: mesh.instanceMatrix,
      geometry,
      index,
      attributes,
      base: { x: base.x, y: base.y, z: base.z },
      from: { x: 0, y: 0, z: 0 },
      to: { x: 0, y: 0, z: 0 },
      visible: !live,
      yaw: 0,
      tint: 0,
      staged: { x: 0, y: 0, z: 0, present: false, active: false, yaw: 0, tint: 0 },
    }];
  });
  type Member = (typeof members)[number];
  const byId = new Map<number, Member>();
  // A slot can own several marker meshes (a figure's poses); one stands at a time.
  const markers = new Map<number, Map<number, Member>>();
  for (const member of members) {
    if (!member.marker) byId.set(member.id, member);
    else {
      const variants = markers.get(member.id) ?? new Map<number, Member>();
      variants.set(member.variant, member);
      markers.set(member.id, variants);
    }
  }
  const standing = (id: number) => {
    for (const member of markers.get(id)?.values() ?? []) if (member.visible) return Option.some(member);
    return Option.none<Member>();
  };
  // Staging is reusable and invisible to rendering. Validation can reject a
  // complete packet without changing accepted buffers, while avoiding thousands
  // of short-lived plans and Option wrappers on every 4 Hz arrival.
  const state = { revision: -1 };
  const stage = (
    member: Member,
    target: {
      readonly id: number;
      readonly x: number;
      readonly y: number;
      readonly z: number;
      readonly yaw?: number;
      readonly tint?: number;
    },
    active: boolean,
  ): Result.Result<void, InstanceSnapshotFailure> => {
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
    member.staged.active = active;
    member.staged.yaw = target.yaw ?? 0;
    member.staged.tint = target.tint ?? 0;
    return Result.void;
  };
  const stageSnapshot = (next: InstanceSnapshot): Result.Result<void, InstanceSnapshotFailure> => {
    // Validate the whole snapshot before writing. Identity is independent of
    // incoming order; omitted slots disappear and can return without allocating
    // geometry. A world that needs more slots remounts with a larger allocation.
    for (const member of members) member.staged.present = false;
    for (const target of next.instances) {
      const member = byId.get(target.id);
      if (!member) {
        return Result.fail(new InstanceSnapshotFailure({ phase: "identity", cause: { unknown: target.id } }));
      }
      if (member.staged.present) {
        return Result.fail(new InstanceSnapshotFailure({ phase: "identity", cause: { duplicate: target.id } }));
      }
      const staged = stage(member, target, target.active ?? false);
      if (Result.isFailure(staged)) return staged;
      const placement = target.marker;
      if (placement) {
        const marker = markers.get(target.id)?.get(placement.variant ?? 0);
        if (!marker) {
          return Result.fail(new InstanceSnapshotFailure({ phase: "identity", cause: { unknownMarker: target.id } }));
        }
        const placed = stage(marker, { id: target.id, ...placement }, false);
        if (Result.isFailure(placed)) return placed;
      }
    }
    return Result.void;
  };
  // A live slot's heading and tint change only when its agent moves or arrives.
  const restyle = (member: Member) => {
    let changes = 0;
    if (member.staged.yaw !== member.yaw) {
      changes += writeYaw(member.matrices, member.index, member.base, member.staged.yaw);
      member.yaw = member.staged.yaw;
    }
    if (member.staged.tint !== member.tint) {
      changes += writeTint(member.geometry, member.index, member.staged.tint);
      member.tint = member.staged.tint;
    }
    return changes;
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
        changes += writeFourth(member.attributes.to, member.index, Number(member.staged.active));
        changes += restyle(member);
        moving ||= !same(member.from, member.to);
      }
      if (member.visible !== visible) {
        changes += writeFourth(member.attributes.from, member.index, Number(visible));
        member.visible = visible;
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
  const snapshotLatest = Effect.fn("Renderer.latestInstanceSnapshot")(
    function*(input: Schema.Json, current: () => boolean) {
      const next = yield* decodeSnapshot(input).pipe(
        Effect.mapError(cause => new InstanceSnapshotFailure({ phase: "decode", cause })),
      );
      return yield* Effect.suspend(() => {
        // UI commands can finish out of order or after a capacity remount. Their
        // obsolete packets have no authority over the currently owned display.
        if (!current() || next.revision <= state.revision) {
          return Effect.succeed({ revision: state.revision, changedInstances: 0, changedAttributes: 0 });
        }
        const staged = stageSnapshot(next);
        return Result.isFailure(staged) ? Effect.fail(staged.failure) : Effect.succeed(commitSnapshot(next));
      });
    },
  );
  return {
    snapshot,
    snapshotLatest,
    present: (sampleTime: number, intervalStart: number, rate: number) =>
      recorded.start(sampleTime - intervalStart, rate),
    interpolation,
    revision: () => state.revision,
    advance: () => {
      positions.advance();
      recorded.advance();
    },
    // The marker's interpolated ground position, read every frame by Follow.
    marker: (id: number): Option.Option<Position> =>
      Option.map(standing(id), member => ({
        x: member.base.x + member.from.x + (member.to.x - member.from.x) * interpolation.value,
        y: member.base.y + member.from.y + (member.to.y - member.from.y) * interpolation.value,
        z: member.base.z + member.from.z + (member.to.z - member.from.z) * interpolation.value,
      })),
    positions: () =>
      members.flatMap(member => {
        if (member.marker) return [];
        const offset = mix(member.from, member.to, interpolation.value);
        return [{
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
        }];
      }),
  };
};
