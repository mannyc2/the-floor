import { Effect, Option } from "effect";
import { MeshoptSimplifier } from "meshoptimizer";
import * as THREE from "three";
import { type Gltf, readAccessor } from "./gltf";
import type { Skeleton } from "./skeleton";

// A skinned triangle mesh in the target skeleton's joint numbering: four
// joints and weights per vertex.
export interface Mesh {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly joints: Uint8Array;
  readonly weights: Float32Array;
  readonly indices: Uint32Array;
}
export const vertexCount = (mesh: Mesh) => mesh.positions.length / 3;

// The first primitive of the named mesh, its joints renamed into `skeleton`.
export const readSkinnedMesh = (gltf: Gltf, skeleton: Skeleton, meshName: (name: string) => boolean): Mesh => {
  const mesh = gltf.document.meshes?.find(candidate => meshName(candidate.name ?? ""));
  const primitive = mesh?.primitives[0];
  const skin = gltf.document.nodes.flatMap(node => Option.toArray(Option.fromUndefinedOr(node.skin)))[0] ?? 0;
  const joints = gltf.document.skins?.[skin]?.joints ?? [];
  const rename = joints.map(joint => skeleton.names.indexOf(gltf.document.nodes[joint]?.name ?? ""));
  const attribute = (name: string) =>
    Option.match(Option.fromUndefinedOr(primitive?.attributes[name]), {
      onNone: () => new Float32Array(),
      onSome: index => readAccessor(gltf, index),
    });
  const positions = attribute("POSITION");
  const indices = Option.match(Option.fromUndefinedOr(primitive?.indices), {
    onNone: () => Uint32Array.from({ length: positions.length / 3 }, (_, i) => i),
    onSome: index => Uint32Array.from(readAccessor(gltf, index)),
  });
  return {
    positions,
    normals: attribute("NORMAL"),
    joints: Uint8Array.from(attribute("JOINTS_0"), joint => Math.max(0, rename[joint] ?? 0)),
    weights: attribute("WEIGHTS_0"),
    indices,
  };
};

export const transform = (mesh: Mesh, scale: number): Mesh => ({
  ...mesh,
  positions: mesh.positions.map(value => value * scale),
});

export const concat = (meshes: ReadonlyArray<Mesh>): Mesh => {
  const total = (pick: (mesh: Mesh) => ArrayLike<number>) => meshes.reduce((sum, mesh) => sum + pick(mesh).length, 0);
  const positions = new Float32Array(total(mesh => mesh.positions));
  const normals = new Float32Array(total(mesh => mesh.normals));
  const joints = new Uint8Array(total(mesh => mesh.joints));
  const weights = new Float32Array(total(mesh => mesh.weights));
  const indices = new Uint32Array(total(mesh => mesh.indices));
  let vertex = 0, index = 0;
  for (const mesh of meshes) {
    positions.set(mesh.positions, vertex * 3);
    normals.set(mesh.normals, vertex * 3);
    joints.set(mesh.joints, vertex * 4);
    weights.set(mesh.weights, vertex * 4);
    indices.set(mesh.indices.map(i => i + vertex), index);
    vertex += vertexCount(mesh);
    index += mesh.indices.length;
  }
  return { positions, normals, joints, weights, indices };
};

// Merges vertices that share a position (UV seams), so smoothing, slicing and
// simplification see one connected surface.
const positionKey = (positions: Float32Array, vertex: number, tolerance: number) =>
  [0, 1, 2].map(axis => Math.round((positions[vertex * 3 + axis] ?? 0) / tolerance)).join(",");

export const weld = (mesh: Mesh, tolerance = 1e-5): Mesh => {
  const first = new Map<string, number>();
  const remap = new Uint32Array(vertexCount(mesh));
  const kept: Array<number> = [];
  for (let i = 0; i < remap.length; i++) {
    const key = positionKey(mesh.positions, i, tolerance);
    if (!first.has(key)) {
      first.set(key, kept.length);
      kept.push(i);
    }
    remap[i] = first.get(key) ?? 0;
  }
  const welded = pick(mesh, kept);
  const indices: Array<number> = [];
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const a = remap[mesh.indices[t] ?? 0] ?? 0, b = remap[mesh.indices[t + 1] ?? 0] ?? 0, c = remap[mesh.indices[t + 2] ?? 0] ?? 0;
    if (a !== b && b !== c && a !== c) indices.push(a, b, c);
  }
  return withNormals({ ...welded, indices: Uint32Array.from(indices) });
};

// A new mesh holding only `vertices`, in that order; triangles are not kept.
const pick = (mesh: Mesh, vertices: ReadonlyArray<number>): Mesh => {
  const positions = new Float32Array(vertices.length * 3), normals = new Float32Array(vertices.length * 3);
  const joints = new Uint8Array(vertices.length * 4), weights = new Float32Array(vertices.length * 4);
  vertices.forEach((source, target) => {
    positions.set(mesh.positions.subarray(source * 3, source * 3 + 3), target * 3);
    normals.set(mesh.normals.subarray(source * 3, source * 3 + 3), target * 3);
    joints.set(mesh.joints.subarray(source * 4, source * 4 + 4), target * 4);
    weights.set(mesh.weights.subarray(source * 4, source * 4 + 4), target * 4);
  });
  return { positions, normals, joints, weights, indices: new Uint32Array() };
};

// Area-weighted smooth vertex normals.
export const withNormals = (mesh: Mesh): Mesh => {
  const normals = new Float32Array(mesh.positions.length);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), sum = new THREE.Vector3();
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const corners = [mesh.indices[t] ?? 0, mesh.indices[t + 1] ?? 0, mesh.indices[t + 2] ?? 0];
    a.fromArray(mesh.positions, (corners[0] ?? 0) * 3);
    b.fromArray(mesh.positions, (corners[1] ?? 0) * 3).sub(a);
    c.fromArray(mesh.positions, (corners[2] ?? 0) * 3).sub(a);
    const face = b.cross(c);
    for (const corner of corners) sum.fromArray(normals, corner * 3).add(face).toArray(normals, corner * 3);
  }
  for (let v = 0; v < normals.length; v += 3) sum.fromArray(normals, v).normalize().toArray(normals, v);
  return { ...mesh, normals };
};

const neighbours = (mesh: Mesh) => {
  const sets = Array.from({ length: vertexCount(mesh) }, () => new Set<number>());
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const a = mesh.indices[t] ?? 0, b = mesh.indices[t + 1] ?? 0, c = mesh.indices[t + 2] ?? 0;
    sets[a]?.add(b).add(c);
    sets[b]?.add(a).add(c);
    sets[c]?.add(a).add(b);
  }
  return sets.map(set => [...set]);
};

// Taubin smoothing (alternating shrink and inflate steps) weighted per vertex,
// which irons out modelled detail such as muscles or a face without the
// shrinkage plain Laplacian smoothing causes.
export const smooth = (mesh: Mesh, amount: (vertex: number) => number, iterations: number): Mesh => {
  const around = neighbours(mesh);
  const strength = Float32Array.from({ length: vertexCount(mesh) }, (_, v) => amount(v));
  let positions = mesh.positions.slice();
  for (let step = 0; step < iterations * 2; step++) {
    const factor = step % 2 === 0 ? .5 : -.53;
    const next = positions.slice();
    around.forEach((list, v) => {
      const k = (strength[v] ?? 0) * factor;
      if (k === 0 || list.length === 0) return;
      for (let axis = 0; axis < 3; axis++) {
        let mean = 0;
        for (const n of list) mean += positions[n * 3 + axis] ?? 0;
        mean /= list.length;
        const value = positions[v * 3 + axis] ?? 0;
        next[v * 3 + axis] = value + k * (mean - value);
      }
    });
    positions = next;
  }
  return withNormals({ ...mesh, positions });
};

// Moves each vertex along its normal, giving cloth some thickness over the body.
export const inflate = (mesh: Mesh, amount: (vertex: number) => number): Mesh => {
  const positions = mesh.positions.slice();
  for (let v = 0; v < vertexCount(mesh); v++) {
    const k = amount(v);
    for (let axis = 0; axis < 3; axis++) positions[v * 3 + axis] = (positions[v * 3 + axis] ?? 0) + k * (mesh.normals[v * 3 + axis] ?? 0);
  }
  return withNormals({ ...mesh, positions });
};

// Blends two vertices' skins: their weights mixed per joint, the strongest
// four kept and renormalized.
const mixSkin = (joints: ArrayLike<number>, weights: ArrayLike<number>, a: number, b: number, t: number) => {
  const total = new Map<number, number>();
  for (let k = 0; k < 4; k++) {
    const ja = joints[a * 4 + k] ?? 0, jb = joints[b * 4 + k] ?? 0;
    total.set(ja, (total.get(ja) ?? 0) + (1 - t) * (weights[a * 4 + k] ?? 0));
    total.set(jb, (total.get(jb) ?? 0) + t * (weights[b * 4 + k] ?? 0));
  }
  const strongest = [...total].toSorted((x, y) => y[1] - x[1]).slice(0, 4);
  const sum = strongest.reduce((s, [, w]) => s + w, 0) || 1;
  return { joints: strongest.map(([j]) => j), weights: strongest.map(([, w]) => w / sum) };
};

// Cuts every triangle that `field` changes sign across, along its zero set,
// so paint boundaries follow the field rather than the source's edges. Only
// triangles centred `within` the cut's band are cut; earlier cuts along the
// band's own edges keep any triangle from straddling it.
// The triangles replacing (a, b, c) once its edges are cut where the field's
// signs differ; `cut` returns the vertex on an edge's zero crossing.
const splitTriangle = (
  tri: readonly [number, number, number],
  signs: ReadonlyArray<number>,
  cut: (a: number, b: number) => number,
): ReadonlyArray<number> => {
  // The lone vertex: alone on its side, the other two opposite or on the cut.
  const lone = signs.findIndex(sign => sign !== 0 && signs.filter(other => other === sign).length === 1);
  const a = tri[lone] ?? 0, b = tri[(lone + 1) % 3] ?? 0, c = tri[(lone + 2) % 3] ?? 0;
  const sb = signs[(lone + 1) % 3] ?? 0, sc = signs[(lone + 2) % 3] ?? 0;
  if (sb === 0) return [a, b, cut(a, c), b, c, cut(a, c)];
  if (sc === 0) return [a, cut(a, b), c, cut(a, b), b, c];
  const ab = cut(a, b), ac = cut(a, c);
  return [a, ab, ac, ab, b, c, ab, c, ac];
};

// Cuts every triangle that `field` changes sign across, along its zero set,
// so paint boundaries follow the field rather than the source's edges. Only
// triangles centred `within` the cut's band are cut; earlier cuts along the
// band's own edges keep any triangle from straddling it.
export const slice = (
  mesh: Mesh,
  field: (x: number, y: number, z: number) => number,
  within: (x: number, y: number, z: number) => boolean = () => true,
): Mesh => {
  const positions = Array.from(mesh.positions), normals = Array.from(mesh.normals);
  const joints = Array.from(mesh.joints), weights = Array.from(mesh.weights);
  const at = (v: number, axis: number) => positions[v * 3 + axis] ?? 0;
  const values: Array<number> = Array.from({ length: vertexCount(mesh) }, (_, v) => field(at(v, 0), at(v, 1), at(v, 2)));
  const cuts = new Map<string, number>();
  const cut = (a: number, b: number) => {
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    if (cuts.has(key)) return cuts.get(key) ?? 0;
    const t = (values[a] ?? 0) / ((values[a] ?? 0) - (values[b] ?? 0));
    const v = positions.length / 3;
    for (let axis = 0; axis < 3; axis++) {
      positions.push(at(a, axis) * (1 - t) + at(b, axis) * t);
      normals.push((normals[a * 3 + axis] ?? 0) * (1 - t) + (normals[b * 3 + axis] ?? 0) * t);
    }
    const skin = mixSkin(joints, weights, a, b, t);
    for (let k = 0; k < 4; k++) {
      joints.push(skin.joints[k] ?? 0);
      weights.push(skin.weights[k] ?? 0);
    }
    values.push(0);
    cuts.set(key, v);
    return v;
  };
  const indices: Array<number> = [];
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const tri = [mesh.indices[t] ?? 0, mesh.indices[t + 1] ?? 0, mesh.indices[t + 2] ?? 0] as const;
    const signs = tri.map(v => Math.sign(values[v] ?? 0));
    const centre = [0, 1, 2].map(axis => tri.reduce((sum, v) => sum + at(v, axis), 0) / 3);
    const crossed = signs.some(sign => sign > 0) && signs.some(sign => sign < 0);
    indices.push(
      ...(crossed && within(centre[0] ?? 0, centre[1] ?? 0, centre[2] ?? 0) ? splitTriangle(tri, signs, cut) : tri),
    );
  }
  return {
    positions: Float32Array.from(positions),
    normals: Float32Array.from(normals),
    joints: Uint8Array.from(joints),
    weights: Float32Array.from(weights),
    indices: Uint32Array.from(indices),
  };
};

// Splits the mesh by a per-triangle label: each label's triangles get their
// own vertices, so a vertex never mixes two paints.
export const separate = (mesh: Mesh, labelOf: (triangle: number) => number) => {
  const parts = new Map<number, { vertices: Map<number, number>; indices: Array<number> }>();
  for (let t = 0; t < mesh.indices.length / 3; t++) {
    const label = labelOf(t);
    const part = parts.get(label) ?? { vertices: new Map<number, number>(), indices: [] };
    parts.set(label, part);
    for (let k = 0; k < 3; k++) {
      const v = mesh.indices[t * 3 + k] ?? 0;
      if (!part.vertices.has(v)) part.vertices.set(v, part.vertices.size);
      part.indices.push(part.vertices.get(v) ?? 0);
    }
  }
  return new Map([...parts].map(([label, part]) => [label, { ...pick(mesh, [...part.vertices.keys()]), indices: Uint32Array.from(part.indices) }]));
};

// Simplifies one part to about `ratio` of its triangles. Its open borders,
// shared with neighbouring paints, stay exactly in place.
export const simplify = Effect.fnUntraced(function*(mesh: Mesh, ratio: number, error: number) {
  yield* Effect.promise(() => MeshoptSimplifier.ready);
  const target = Math.max(3, Math.floor(mesh.indices.length * ratio / 3) * 3);
  const [indices] = MeshoptSimplifier.simplify(mesh.indices, mesh.positions, 3, target, error, ["LockBorder"]);
  const used = [...new Set(indices)];
  const local = new Map(used.map((v, i) => [v, i]));
  return { ...pick(mesh, used), indices: indices.map(v => local.get(v) ?? 0) } satisfies Mesh;
});
