import { Option } from "effect";
import * as THREE from "three";
import { type Gltf, readAccessor } from "./gltf";

// The sources share one 65-joint humanoid skeleton. The body file supplies
// its hierarchy, rest pose and inverse bind matrices; an animation file only
// supplies keyframes, matched to joints by name.

export interface Local {
  readonly translation: THREE.Vector3;
  readonly rotation: THREE.Quaternion;
  readonly scale: THREE.Vector3;
}
export interface Skeleton {
  readonly names: ReadonlyArray<string>;
  // Each joint's parent joint, or -1 under the skeleton's base.
  readonly parents: ReadonlyArray<number>;
  // The transform of the nodes above the root joint.
  readonly base: THREE.Matrix4;
  readonly rest: ReadonlyArray<Local>;
  readonly inverseBind: ReadonlyArray<THREE.Matrix4>;
}

const localOf = (node: Gltf["document"]["nodes"][number]): Local => ({
  translation: new THREE.Vector3(...(node.translation ?? [0, 0, 0])),
  rotation: new THREE.Quaternion(...(node.rotation ?? [0, 0, 0, 1])),
  scale: new THREE.Vector3(...(node.scale ?? [1, 1, 1])),
});
const matrixOf = (local: Local) => new THREE.Matrix4().compose(local.translation, local.rotation, local.scale);

export const readSkeleton = (gltf: Gltf): Skeleton => {
  const { nodes } = gltf.document;
  const skin = gltf.document.skins?.[0];
  const joints = skin?.joints ?? [];
  const parentNode = new Map<number, number>();
  nodes.forEach((node, index) => node.children?.forEach(child => parentNode.set(child, index)));
  const parents = joints.map(node => joints.indexOf(parentNode.get(node) ?? -1));
  // The nodes above the root joint, root-most last.
  const above: Array<number> = [];
  for (let node = parentNode.get(joints[0] ?? -1) ?? -1; node >= 0; node = parentNode.get(node) ?? -1) above.push(node);
  const base = above.reduce((matrix, node) => matrix.premultiply(matrixOf(localOf(nodes[node] ?? {}))), new THREE.Matrix4());
  const binds = Option.match(Option.fromUndefinedOr(skin?.inverseBindMatrices), {
    onNone: () => new Float32Array(),
    onSome: accessor => readAccessor(gltf, accessor),
  });
  return {
    names: joints.map(node => nodes[node]?.name ?? `joint${node}`),
    parents,
    base,
    rest: joints.map(node => localOf(nodes[node] ?? {})),
    inverseBind: joints.map((_, index) => new THREE.Matrix4().fromArray(binds, index * 16)),
  };
};

// The same skeleton with some joints moved in their parent's frame (a
// proportion change), its bind pose recomputed from the new rest pose.
export const reproportion = (skeleton: Skeleton, scales: Readonly<Record<string, number>>): Skeleton => {
  const rest = skeleton.rest.map((local, index) => ({
    ...local,
    translation: local.translation.clone().multiplyScalar(scales[skeleton.names[index] ?? ""] ?? 1),
  }));
  const moved = { ...skeleton, rest };
  return { ...moved, inverseBind: worldOf(moved, rest).map(world => world.clone().invert()) };
};

// World matrices from local transforms, parents before children.
export const worldOf = (skeleton: Skeleton, locals: ReadonlyArray<Local>) => {
  const world: Array<THREE.Matrix4> = [];
  skeleton.parents.forEach((parent, index) => {
    const matrix = Option.match(Option.fromUndefinedOr(locals[index] ?? skeleton.rest[index]), {
      onNone: () => new THREE.Matrix4(),
      onSome: matrixOf,
    });
    world.push(matrix.premultiply(parent < 0 ? skeleton.base : world[parent] ?? skeleton.base));
  });
  return world;
};

interface Track {
  readonly joint: number;
  readonly path: "translation" | "rotation" | "scale";
  readonly times: Float32Array;
  readonly values: Float32Array;
  readonly step: boolean;
}
export interface Animation {
  readonly name: string;
  readonly seconds: number;
  readonly tracks: ReadonlyArray<Track>;
}

type Channel = NonNullable<Gltf["document"]["animations"]>[number]["channels"][number];
type Sampler = NonNullable<Gltf["document"]["animations"]>[number]["samplers"][number];
const paths = ["translation", "rotation", "scale"] as const;
const isPath = (path: string): path is Track["path"] => paths.some(known => known === path);

// One channel as a track on a skeleton joint, if it keys a joint's transform.
const trackOf = (gltf: Gltf, skeleton: Skeleton, channel: Channel, sampler: Sampler): Option.Option<Track> => {
  const path = channel.target.path;
  const joint = Option.fromUndefinedOr(channel.target.node).pipe(
    Option.flatMap(node => Option.fromUndefinedOr(gltf.document.nodes[node]?.name)),
    Option.map(name => skeleton.names.indexOf(name)),
    Option.filter(index => index >= 0),
  );
  if (Option.isNone(joint) || !isPath(path)) return Option.none();
  // Cubic-spline keys store in-tangent, value and out-tangent; only the
  // values are kept, sampled linearly.
  const values = readAccessor(gltf, sampler.output);
  const times = readAccessor(gltf, sampler.input);
  const width = path === "rotation" ? 4 : 3;
  return Option.some({
    joint: joint.value,
    path,
    times,
    values: sampler.interpolation === "CUBICSPLINE"
      ? Float32Array.from({ length: times.length * width }, (_, i) =>
        values[Math.floor(i / width) * width * 3 + width + (i % width)] ?? 0)
      : values,
    step: sampler.interpolation === "STEP",
  });
};

export const readAnimations = (gltf: Gltf, skeleton: Skeleton): ReadonlyArray<Animation> =>
  (gltf.document.animations ?? []).map(animation => {
    const tracks = animation.channels.flatMap(channel =>
      Option.toArray(
        Option.flatMap(Option.fromUndefinedOr(animation.samplers[channel.sampler]), sampler =>
          trackOf(gltf, skeleton, channel, sampler)),
      )
    );
    const seconds = Math.max(0, ...tracks.map(track => track.times[track.times.length - 1] ?? 0));
    return { name: animation.name ?? "", seconds, tracks };
  });

// Local transforms at `time` seconds: keyed joints from the animation, the
// rest of the skeleton at rest.
export const sample = (skeleton: Skeleton, animation: Animation, time: number): Array<Local> => {
  const locals = skeleton.rest.map(rest => ({
    translation: rest.translation.clone(),
    rotation: rest.rotation.clone(),
    scale: rest.scale.clone(),
  }));
  for (const track of animation.tracks) {
    const { times, values } = track;
    const last = times.length - 1;
    let k = 0;
    while (k < last && (times[k + 1] ?? 0) <= time) k++;
    const t0 = times[k] ?? 0, t1 = times[Math.min(k + 1, last)] ?? t0;
    const alpha = track.step || t1 <= t0 ? 0 : Math.min(1, Math.max(0, (time - t0) / (t1 - t0)));
    const next = Math.min(k + 1, last);
    Option.map(Option.fromUndefinedOr(locals[track.joint]), local => {
      if (track.path === "rotation") {
        const a = new THREE.Quaternion().fromArray(values, k * 4);
        local.rotation.copy(a.slerp(new THREE.Quaternion().fromArray(values, next * 4), alpha));
      } else {
        const a = new THREE.Vector3().fromArray(values, k * 3);
        local[track.path].copy(a.lerp(new THREE.Vector3().fromArray(values, next * 3), alpha));
      }
    });
  }
  return locals;
};
