import { PaletteName, syntheticPalette } from "@floor/atlas/materials";
import { Option } from "effect";
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { GroundArea, Theme } from "../../model";
export { syntheticPalette } from "@floor/atlas/materials";

export const names = PaletteName.literals;
export const slot = (name: string): Option.Option<number> => {
  const index = names.findIndex(item => item === name);
  return index < 0 ? Option.none() : Option.some(index);
};
export const tokenColor = (name: PaletteName, theme: Theme): number => syntheticPalette.colors[name][theme];
export interface SceneConfig {
  readonly width: number;
  readonly height: number;
  readonly desks: number;
  // A live scene draws the world's floors instead of the synthetic test room.
  readonly live?: { readonly floors: ReadonlyArray<GroundArea> };
}
export interface Entity {
  readonly id: number;
  readonly mesh: THREE.Mesh;
  readonly maybeInstance: Option.Option<number>;
  // An agent marker shares its desk's identity, so picking either selects the
  // same agent without spending a second slot of the 12-bit entity channel.
  readonly marker?: boolean;
}
interface Boundary {
  readonly name: string;
  readonly id: number;
  readonly mesh: THREE.Mesh;
  readonly outward: THREE.Vector3;
}

const joined = (parts: Array<THREE.BufferGeometry>) => {
  // Every part has the same scalar attributes and all callers provide geometry.
  const geometry = mergeGeometries(parts, false);
  parts.forEach(part => part.dispose());
  return geometry;
};

export const createScene = (config: SceneConfig, material: THREE.Material) => {
  const counter = { surface: 1 };
  const geometries: Array<THREE.BufferGeometry> = [];
  const meshes: Array<THREE.Mesh> = [];
  const entities: Array<Entity> = [];
  const boundaries: Array<Boundary> = [];
  const scene = new THREE.Scene();
  scene.name = "synthetic-unapproved-desk-scene";
  const kitUnit = 1;

  const attributed = (geometry: THREE.BufferGeometry, materialSlot: number, animatedPart = false) => {
    const count = geometry.getAttribute("position").count;
    const surfaces = new Float32Array(count).fill(counter.surface++);
    geometry.groups.forEach(group => {
      const id = counter.surface++;
      // Box and cylinder groups own separate face vertices. Preserve their
      // indices so shared triangle corners are shaded once, without welding
      // across normals or authored surface boundaries.
      for (let offset = group.start; offset < group.start + group.count; offset++) {
        const vertex = geometry.index ? geometry.index.getX(offset) : offset;
        surfaces[vertex] = id;
      }
    });
    geometry.setAttribute("_SURFACE", new THREE.BufferAttribute(surfaces, 1));
    geometry.setAttribute("_MAT", new THREE.BufferAttribute(new Float32Array(count).fill(materialSlot), 1));
    geometry.setAttribute("_LINE", new THREE.BufferAttribute(new Float32Array(count), 1));
    geometry.setAttribute(
      "_ANIMATED",
      new THREE.BufferAttribute(new Float32Array(count).fill(animatedPart ? 1 : 0), 1),
    );
    geometry.clearGroups();
    return geometry;
  };
  const part = (
    geometry: THREE.BufferGeometry,
    materialSlot: number,
    x: number,
    y: number,
    z: number,
    animatedPart = false,
  ) => attributed(geometry, materialSlot, animatedPart).translate(x * kitUnit, y * kitUnit, z * kitUnit);
  const box = (
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    materialSlot = 5,
    animatedPart = false,
  ) => part(new THREE.BoxGeometry(w * kitUnit, h * kitUnit, d * kitUnit), materialSlot, x, y, z, animatedPart);
  const cylinder = (r: number, h: number, x: number, y: number, z: number, materialSlot = 2) =>
    part(new THREE.CylinderGeometry(r * kitUnit, r * kitUnit, h * kitUnit, 24), materialSlot, x, y, z);
  const add = (name: string, id: number, geometry: THREE.BufferGeometry) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    meshes.push(mesh);
    geometries.push(geometry);
    entities.push({ id, mesh, maybeInstance: Option.none() });
    scene.add(mesh);
    return mesh;
  };
  const monitor = (variant: number) => {
    const geometry = box(.75 + variant * .1, .52, .1, 0, 1.7, -.48, 2);
    if (config.live) {
      const normals = geometry.getAttribute("normal");
      const materials = geometry.getAttribute("_MAT");
      for (let index = 0; index < normals.count; index++) {
        if (normals.getZ(index) > 0) materials.setX(index, -1);
      }
    }
    return geometry;
  };
  const desk = (variant: number) =>
    joined([
      box(2.4, .16, 1.8, 0, 1.2, 0),
      ...[-1, 1].flatMap(x => [-.7, .7].map(z => box(.12, 1.1, .12, x, .6, z, 2))),
      monitor(variant),
      box(.12, .24, .12, 0, 1.38, -.48, 2),
      box(.5, .04, .3, -.58 + variant * .08, 1.31, .25, 3),
      box(.65, .13, .65, .3, .65, 1.1),
      box(.65, .65, .12, .3, 1.02, 1.4),
      box(.12, .58, .12, .3, .29, 1.1, 2),
    ]);
  const columns = config.desks > 12 ? 32 : 6;
  const rows = Math.ceil(config.desks / columns);
  const width = Math.max(18, columns * 2.8);
  // The large synthetic field's row placement is intentionally stable for its
  // measured frontmost leg. Include the chair overhang when enclosing it.
  const depth = config.desks > 12
    ? Math.max(15, 2 * (Math.max(15 * 2.7 + .9, (rows - 16) * 2.7 + 1.46) + .5))
    : 15;
  if (!config.live) add("synthetic-floor", 1, box(width, .25, depth, 0, -.15, 0, 4));
  else if (config.live.floors.length > 0) {
    // Every floor's ground in one mesh: floors never move while a mount lives,
    // and a new floor changes renderer capacity, which remounts.
    add(
      "synthetic-floor",
      1,
      joined(
        config.live.floors.map(area =>
          box(area.x1 - area.x0, .25, area.z1 - area.z0, (area.x0 + area.x1) / 2, -.15, (area.z0 + area.z1) / 2, 4)
        ),
      ),
    );
  }
  Array.from({ length: 3 }, (_variantValue, variant) => {
    const geometry = desk(variant);
    const count = Math.floor((config.desks + 2 - variant) / 3);
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.name = `synthetic-desk-variant-${variant}`;
    const matrix = new THREE.Matrix4();
    Array.from({ length: count }, (_instanceValue, i) => {
      const index = i * 3 + variant;
      matrix.makeTranslation(
        (index % columns - (columns - 1) / 2) * 2.8,
        .05,
        config.desks > 12 ? (Math.floor(index / columns) - 15) * 2.7 : Math.floor(index / columns) * 3.3 + 1.4,
      );
      mesh.setMatrixAt(i, matrix);
      entities.push({ id: index + 2, mesh, maybeInstance: Option.some(i) });
    });
    meshes.push(mesh);
    geometries.push(geometry);
    scene.add(mesh);
  });
  if (config.live) {
    // The existing synthetic cylinder, standing on the floor, marks where each
    // desk's agent is. It is not a figure design; reconciled offsets place it.
    const geometry = cylinder(.52, 1.45, 0, .725, 0, 3);
    const mesh = new THREE.InstancedMesh(geometry, material, config.desks);
    mesh.name = "synthetic-agent-marker";
    Array.from({ length: config.desks }, (_instanceValue, index) => {
      mesh.setMatrixAt(index, new THREE.Matrix4());
      entities.push({ id: index + 2, mesh, maybeInstance: Option.some(index), marker: true });
    });
    meshes.push(mesh);
    geometries.push(geometry);
    scene.add(mesh);
  }
  const gaugeId = config.desks + 2;
  add(
    "synthetic-interpolation-gauge",
    gaugeId,
    joined([
      box(4.1, .25, 2.4, 0, .18, -4),
      box(.2, 5.8, .3, -1.9, 3, -4),
      box(.2, 5.8, .3, 1.9, 3, -4),
      box(4, .25, 2.4, 0, 6, -4),
      box(3.6, 4.8, .12, 0, 3, -4),
      box(.06, 5.5, .06, 1.6, 3, -2.97, 2),
      box(.28, .5, .5, 1.1, 3.36, -3.2, 2, true),
      ...Array.from({ length: 28 }, (_, i) => box(i % 5 === 0 ? .25 : .13, .025, .035, 1.5, .45 + i * .19, -2.92, 1)),
    ]),
  );
  add("synthetic-cylinder", gaugeId + 1, cylinder(.52, 1.45, -3.5, 1.15, -3.5, 3));
  add("synthetic-primitive-box", gaugeId + 2, box(.7, 1.1, .7, 2.8, .6, -2));
  add("synthetic-primitive-sphere", gaugeId + 3, part(new THREE.SphereGeometry(.5, 16, 8), 5, -2.4, .55, -1.8));

  // The complete shell is synthetic verification geometry. All five authored
  // surfaces exist; camera-facing ones are omitted from every render pass.
  const boundary = (name: string, id: number, geometry: THREE.BufferGeometry, outward: THREE.Vector3) => {
    boundaries.push({ name, id, mesh: add(`synthetic-${name}`, id, geometry), outward });
  };
  boundary("wall-east", gaugeId + 4, box(.2, 7, depth, width / 2, 3.5, 0, 6), new THREE.Vector3(1, 0, 0));
  boundary("wall-west", gaugeId + 5, box(.2, 7, depth, -width / 2, 3.5, 0, 6), new THREE.Vector3(-1, 0, 0));
  boundary("wall-south", gaugeId + 6, box(width, 7, .2, 0, 3.5, depth / 2, 6), new THREE.Vector3(0, 0, 1));
  boundary("wall-north", gaugeId + 7, box(width, 7, .2, 0, 3.5, -depth / 2, 6), new THREE.Vector3(0, 0, -1));
  boundary("ceiling", gaugeId + 8, box(width, .2, depth, 0, 7, 0, 7), new THREE.Vector3(0, 1, 0));

  // Measurement props and the synthetic room cannot obscure canonical desks
  // that arrive outside the renderer workbench's original rectangular field.
  if (config.live) {
    entities.filter(entity => entity.id >= gaugeId).forEach(entity => {
      entity.mesh.visible = false;
    });
  }

  meshes.forEach(mesh => {
    const instanceCount = mesh instanceof THREE.InstancedMesh
      ? mesh.count
      : mesh.geometry.getAttribute("position").count;
    const members = entities.filter(entity => entity.mesh === mesh);
    const ids = new Float32Array(instanceCount);
    members.forEach(entity => {
      if (Option.isSome(entity.maybeInstance)) ids[entity.maybeInstance.value] = entity.id;
      else ids.fill(entity.id);
    });
    const attribute = (array: Float32Array) =>
      mesh instanceof THREE.InstancedMesh
        ? new THREE.InstancedBufferAttribute(array, 1).setUsage(THREE.DynamicDrawUsage)
        : new THREE.BufferAttribute(array, 1).setUsage(THREE.DynamicDrawUsage);
    mesh.geometry.setAttribute("_ENTITY", attribute(ids));
    mesh.geometry.setAttribute("_PALETTE", attribute(new Float32Array(instanceCount).fill(-1)));
    mesh.geometry.setAttribute("_PREVIOUS", attribute(new Float32Array(instanceCount)));
    mesh.geometry.setAttribute("_NEXT", attribute(new Float32Array(instanceCount)));
    mesh.geometry.computeBoundingBox();
  });
  scene.updateMatrixWorld(true);
  return {
    scene,
    meshes,
    geometries,
    entities,
    boundaries,
    cutaway: (towardCamera: THREE.Vector3) => {
      // Camera masking must not overwrite authored visibility or workbench asset
      // isolation when a later resize reapplies the resting camera.
      boundaries.forEach(partition => {
        partition.mesh.layers.set(partition.outward.dot(towardCamera) <= 0 ? 0 : 1);
      });
    },
    gaugeId,
    syntheticCylinder: { center: { x: -3.5, y: 1.15, z: -3.5 }, radius: .52, height: 1.45 },
  };
};
