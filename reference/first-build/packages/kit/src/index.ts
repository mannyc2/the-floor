import { Match, Option } from "effect";
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

export type AtlasTheme = "day" | "night";
export type KitShape = "box" | "cylinder" | "sphere" | "cone" | "ring" | "stall";
export type KitMaterial = "structure" | "paper" | "steel" | "water" | "brass" | "accent" | "frost" | "rust";
export type Point3 = readonly [number, number, number];
export interface KitPart {
  readonly shape: KitShape;
  readonly material: KitMaterial;
  readonly position: Point3;
  readonly size: Point3;
  readonly rotation?: Point3;
  readonly detail?: number;
}

export const palette = {
  day: {
    ground: "#f4f1ea",
    line: "#2b2e33",
    paper: "#fffdf7",
    steel: "#6b7480",
    water: "#9fb7c9",
    brass: "#b08a3e",
    accent: "#f0640a",
    frost: "#a9c7da",
    rust: "#9c5634",
    tones: ["#c9c4b8", "#dbd8d0", "#edebe7", "#ffffff"],
  },
  night: {
    ground: "#101318",
    line: "#d6dae0",
    paper: "#191d24",
    steel: "#8a94a0",
    water: "#4e6a80",
    brass: "#c9a24d",
    accent: "#ff7a1a",
    frost: "#cfe3f0",
    rust: "#8a4b2a",
    tones: ["#1b2028", "#252c36", "#303744", "#3a4352"],
  },
} as const;

const vertexShader = `
  varying vec3 faceNormal;
  void main() {
    faceNormal = normalize(mat3(instanceMatrix) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  }
`;
const fragmentShader = `
  uniform vec3 tone0;
  uniform vec3 tone1;
  uniform vec3 tone2;
  uniform vec3 tone3;
  uniform vec3 pigment;
  uniform float isStructure;
  varying vec3 faceNormal;
  void main() {
    vec3 n = normalize(faceNormal);
    vec3 tone = n.y > 0.35 ? tone3 : (n.x > 0.2 ? tone2 : (n.z > -0.2 ? tone1 : tone0));
    float shade = n.y > 0.35 ? 1.0 : (n.x > 0.2 ? 0.87 : (n.z > -0.2 ? 0.73 : 0.6));
    gl_FragColor = vec4(mix(pigment * shade, tone, isStructure), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const stallGeometry = (): THREE.BufferGeometry => {
  // A stall is one shared model, so its miniature gauge does not become separate draw work.
  const parts: THREE.BufferGeometry[] = [
    new THREE.BoxGeometry(3.8, 0.6, 3.4).translate(0, 0.48, 0),
    new THREE.BoxGeometry(2.9, 1.9, 2.6).translate(0, 1.75, 0),
    new THREE.BoxGeometry(3.8, 0.22, 3.5).translate(0, 3.4, 0),
    new THREE.CylinderGeometry(0.16, 0.16, 0.95, 6).translate(-1, 1.65, 1.48),
  ];
  for (const x of [-1.65, 1.65]) {
    for (const z of [-1.4, 1.4]) parts.push(new THREE.BoxGeometry(0.12, 3, 0.12).translate(x, 2, z));
  }
  const merged = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  return merged;
};

const geometryFor = (shape: KitShape): THREE.BufferGeometry =>
  Match.value(shape).pipe(
    Match.when("box", () => new THREE.BoxGeometry(1, 1, 1)),
    Match.when("cylinder", () => new THREE.CylinderGeometry(0.5, 0.5, 1, 16)),
    Match.when("sphere", () => new THREE.SphereGeometry(0.5, 12, 8)),
    Match.when("cone", () => new THREE.CylinderGeometry(0.1, 0.5, 1, 12)),
    Match.when("ring", () => new THREE.TorusGeometry(0.43, 0.07, 4, 24)),
    Match.when("stall", stallGeometry),
    Match.exhaustive,
  );

interface Batch {
  readonly key: string;
  readonly capacity: number;
  readonly free: number[];
  nextIndex: number;
  readonly mesh: THREE.InstancedMesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  readonly edges: THREE.LineSegments<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  readonly material: KitMaterial;
  readonly detail: number;
  readonly tones: readonly THREE.Color[];
  readonly pigment: THREE.Color;
  readonly ink: THREE.Color;
  readonly opacity: { value: number };
}
interface Instance {
  readonly batch: Batch;
  readonly index: number;
  readonly part: KitPart;
}
export interface KitPartUpdate {
  readonly key: string;
  readonly part: Option.Option<KitPart>;
}
const batchKey = (part: KitPart): string => `${part.shape}:${part.material}:${part.detail ?? 0}`;
const samePoint = (left: Point3, right: Point3): boolean =>
  left === right || (left[0] === right[0] && left[1] === right[1] && left[2] === right[2]);
const sameTransform = (left: KitPart, right: KitPart): boolean =>
  samePoint(left.position, right.position) && samePoint(left.size, right.size)
  && samePoint(left.rotation ?? [0, 0, 0], right.rotation ?? [0, 0, 0]);

/** Shared geometry and batched edge instances keep a busy quay independent of its part count. */
export class KitScene {
  readonly group = new THREE.Group();
  private readonly batches: Batch[] = [];
  private readonly batchesByKey = new Map<string, Batch>();
  private readonly instances = new Map<string, Instance>();
  private readonly geometries = new Map<KitShape, THREE.BufferGeometry>();
  private readonly transform = new THREE.Object3D();
  private readonly hidden = new THREE.Matrix4().makeScale(0, 0, 0);

  get partCount(): number {
    return this.instances.size;
  }

  constructor(parts: readonly KitPart[], theme: AtlasTheme, keys?: readonly string[]) {
    const groups = new Map<string, { readonly part: KitPart; readonly key: string }[]>();
    for (const [index, part] of parts.entries()) {
      const key = batchKey(part);
      const group = groups.get(key) ?? [];
      group.push({ part, key: keys?.[index] ?? `part:${index}` });
      groups.set(key, group);
    }
    const dummy = new THREE.Object3D();
    for (const group of groups.values()) {
      const first = group[0]?.part;
      if (!first) continue;
      let geometry = this.geometries.get(first.shape);
      if (!geometry) {
        geometry = geometryFor(first.shape);
        this.geometries.set(first.shape, geometry);
      }
      const tones = [new THREE.Color(), new THREE.Color(), new THREE.Color(), new THREE.Color()];
      const pigment = new THREE.Color();
      const shader = new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: {
          tone0: { value: tones[0] },
          tone1: { value: tones[1] },
          tone2: { value: tones[2] },
          tone3: { value: tones[3] },
          pigment: { value: pigment },
          isStructure: { value: first.material === "structure" ? 1 : 0 },
        },
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      });
      // Small spare capacity lets a measured part change material without reallocating the whole island.
      const capacity = group.length + 32;
      const mesh = new THREE.InstancedMesh(geometry, shader, capacity);
      mesh.count = group.length;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      group.forEach(({ part }, index) => {
        dummy.position.set(...part.position);
        dummy.scale.set(...part.size);
        dummy.rotation.set(...(part.rotation ?? [0, 0, 0]));
        dummy.updateMatrix();
        mesh.setMatrixAt(index, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      // Instances move within the atlas; a stale aggregate bound must never hide a newly changed reading.
      mesh.frustumCulled = false;
      const sourceEdges = new THREE.EdgesGeometry(geometry, first.shape === "cylinder" ? 22 : 28);
      const edgesGeometry = new THREE.InstancedBufferGeometry();
      edgesGeometry.setAttribute("position", sourceEdges.getAttribute("position"));
      edgesGeometry.setAttribute("edgeMatrix", mesh.instanceMatrix);
      edgesGeometry.instanceCount = group.length;
      const ink = new THREE.Color();
      const opacity = { value: 0.7 };
      const edgesMaterial = new THREE.ShaderMaterial({
        uniforms: { ink: { value: ink }, opacity },
        vertexShader: `attribute mat4 edgeMatrix;
          void main() { gl_Position = projectionMatrix * modelViewMatrix * edgeMatrix * vec4(position, 1.0); }`,
        fragmentShader: `uniform vec3 ink; uniform float opacity;
          void main() { gl_FragColor = vec4(ink, opacity);
          #include <colorspace_fragment>
          }`,
        transparent: true,
        depthWrite: false,
      });
      const edges = new THREE.LineSegments(edgesGeometry, edgesMaterial);
      // The edge source has unit bounds, while its instances occupy the whole island.
      edges.frustumCulled = false;
      edges.renderOrder = 2;
      this.group.add(mesh, edges);
      const batch: Batch = {
        key: batchKey(first),
        capacity,
        free: [],
        nextIndex: group.length,
        mesh,
        edges,
        material: first.material,
        detail: first.detail ?? 0,
        tones,
        pigment,
        ink,
        opacity,
      };
      this.batches.push(batch);
      this.batchesByKey.set(batch.key, batch);
      group.forEach(({ part, key }, index) => this.instances.set(key, { part, index, batch }));
      sourceEdges.dispose();
    }
    this.setTheme(theme);
  }

  /** A failed capacity check leaves the current frame intact so the caller can rebuild a changed topology. */
  update(updates: readonly KitPartUpdate[]): boolean {
    if (new Set(updates.map(update => update.key)).size !== updates.length) return false;
    if (!this.canUpdate(updates)) return false;
    const dirty = new Set<Batch>();
    this.removeChangedInstances(updates, dirty);
    this.writeChangedInstances(updates, dirty);
    for (const batch of dirty) batch.mesh.instanceMatrix.needsUpdate = true;
    return true;
  }

  private canUpdate(updates: readonly KitPartUpdate[]): boolean {
    const released = new Map<Batch, number>();
    const required = new Map<Batch, number>();
    for (const update of updates) {
      const previous = this.instances.get(update.key);
      const nextKey = Option.map(update.part, batchKey);
      if (previous && !Option.contains(nextKey, previous.batch.key)) {
        released.set(previous.batch, (released.get(previous.batch) ?? 0) + 1);
      }
      if (Option.isSome(nextKey) && (!previous || previous.batch.key !== nextKey.value)) {
        const batch = this.batchesByKey.get(nextKey.value);
        if (!batch) return false;
        required.set(batch, (required.get(batch) ?? 0) + 1);
      }
    }
    for (const [batch, count] of required) {
      if (count > batch.free.length + batch.capacity - batch.nextIndex + (released.get(batch) ?? 0)) return false;
    }
    return true;
  }

  private removeChangedInstances(updates: readonly KitPartUpdate[], dirty: Set<Batch>): void {
    for (const update of updates) {
      const previous = this.instances.get(update.key);
      if (previous && !Option.contains(Option.map(update.part, batchKey), previous.batch.key)) {
        previous.batch.mesh.setMatrixAt(previous.index, this.hidden);
        previous.batch.mesh.instanceMatrix.addUpdateRange(previous.index * 16, 16);
        previous.batch.free.push(previous.index);
        dirty.add(previous.batch);
        this.instances.delete(update.key);
      }
    }
  }

  private writeChangedInstances(updates: readonly KitPartUpdate[], dirty: Set<Batch>): void {
    for (const update of updates) {
      if (Option.isNone(update.part)) continue;
      const part = update.part.value;
      const previous = this.instances.get(update.key);
      const batch = this.batchesByKey.get(batchKey(part));
      if (!batch) continue;
      const index = previous?.index
        ?? Option.getOrElse(Option.fromUndefinedOr(batch.free.pop()), () => batch.nextIndex++);
      if (!previous || !sameTransform(previous.part, part)) {
        this.transform.position.set(...part.position);
        this.transform.scale.set(...part.size);
        this.transform.rotation.set(...(part.rotation ?? [0, 0, 0]));
        this.transform.updateMatrix();
        batch.mesh.setMatrixAt(index, this.transform.matrix);
        batch.mesh.instanceMatrix.addUpdateRange(index * 16, 16);
        batch.mesh.count = Math.max(batch.mesh.count, index + 1);
        batch.edges.geometry.instanceCount = batch.mesh.count;
        dirty.add(batch);
      }
      this.instances.set(update.key, { batch, index, part });
    }
  }

  setTheme(theme: AtlasTheme): void {
    const colors = palette[theme];
    for (const batch of this.batches) {
      colors.tones.forEach((color, index) => {
        batch.tones[index]?.set(color);
      });
      batch.pigment.set(batch.material === "structure" ? colors.paper : colors[batch.material]);
      batch.ink.set(colors.line);
      batch.opacity.value = theme === "night" ? 0.7 : 0.66;
    }
  }

  setDetail(detail: number): void {
    for (const batch of this.batches) {
      const visible = batch.detail <= detail;
      batch.mesh.visible = visible;
      batch.edges.visible = visible;
    }
  }

  dispose(): void {
    for (const batch of this.batches) {
      batch.mesh.dispose();
      batch.mesh.material.dispose();
      batch.edges.geometry.dispose();
      batch.edges.material.dispose();
    }
    for (const geometry of this.geometries.values()) geometry.dispose();
    this.instances.clear();
    this.batchesByKey.clear();
    this.group.clear();
  }
}

export const kitParts = ["box", "cylinder", "sphere", "cone", "ring", "stall"] as const;
