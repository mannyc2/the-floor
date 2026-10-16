import { PaletteName } from "@floor/atlas/materials";
import * as THREE from "three";

export type Point = readonly [number, number, number];
// 1 marks a screen face and 2 a lamp aperture; night lights them flat.
type LightFace = 0 | 1 | 2;
type SocketKind = "instrument" | "logo" | "nameplate" | "figure" | "piece";

/** One mesh preserves authored boundaries while keeping static props one draw. */
export const makeGeometry = () => {
  const positions: Array<number> = [], normals: Array<number> = [];
  const surfaces: Array<number> = [], materials: Array<number> = [], lights: Array<number> = [];
  let nextSurface = 1;
  return {
    add: (source: THREE.BufferGeometry, material: PaletteName, light: LightFace = 0) => {
      const flat = source.index ? source.toNonIndexed() : source;
      if (flat !== source) source.dispose();
      const position = flat.getAttribute("position"), normal = flat.getAttribute("normal");
      const ids = new Float32Array(position.count).fill(nextSurface++);
      // Primitive groups distinguish caps and hard box faces. A cylinder's
      // continuous side remains one surface, independent of tessellation.
      for (const group of flat.groups) ids.fill(nextSurface++, group.start, group.start + group.count);
      const slot = PaletteName.literals.indexOf(material);
      for (const [index, surface] of ids.entries()) {
        positions.push(position.getX(index), position.getY(index), position.getZ(index));
        normals.push(normal.getX(index), normal.getY(index), normal.getZ(index));
        surfaces.push(surface);
        materials.push(slot);
        lights.push(light);
      }
      flat.dispose();
    },
    finish: (name: string) => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
      geometry.setAttribute("_SURFACE", new THREE.Float32BufferAttribute(surfaces, 1));
      geometry.setAttribute("_MAT", new THREE.Float32BufferAttribute(materials, 1));
      geometry.setAttribute("_LIGHT", new THREE.Float32BufferAttribute(lights, 1));
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      // The kit's material carries no lighting or colour decision. The mounted
      // Engine replaces it with the Atlas surface shader.
      const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
      mesh.name = name;
      return mesh;
    },
  };
};

export type GeometryBuilder = ReturnType<typeof makeGeometry>;
export const box = (width: number, height: number, depth: number, centre: Point) =>
  new THREE.BoxGeometry(width, height, depth).translate(...centre);
export const cylinder = (radius: number, height: number, centre: Point, segments = 24) =>
  new THREE.CylinderGeometry(radius, radius, height, segments).translate(...centre);

const radialPoint = (radius: number, angle: number, y: number): Point => [
  Math.sin(angle) * radius,
  y,
  Math.cos(angle) * radius,
];
export const annulus = (outer: number, inner: number, height: number, bottom: number, segments = 96) => {
  const positions: Array<number> = [];
  const push = (a: Point, b: Point, c: Point) => positions.push(...a, ...b, ...c);
  const geometry = new THREE.BufferGeometry();
  // Four authored surfaces keep the inner/outer walls and the flat faces
  // distinct without outlining every segment around the counter.
  for (const face of ["outer", "inner", "top", "bottom"]) {
    const first = positions.length / 3;
    for (let segment = 0; segment < segments; segment++) {
      const angle = segment * Math.PI * 2 / segments, next = (segment + 1) * Math.PI * 2 / segments;
      const ob = radialPoint(outer, angle, bottom), on = radialPoint(outer, next, bottom);
      const ot = radialPoint(outer, angle, bottom + height), ont = radialPoint(outer, next, bottom + height);
      const ib = radialPoint(inner, angle, bottom), inn = radialPoint(inner, next, bottom);
      const it = radialPoint(inner, angle, bottom + height), int = radialPoint(inner, next, bottom + height);
      if (face === "outer") {
        push(ob, on, ot);
        push(on, ont, ot);
      } else if (face === "inner") {
        push(inn, ib, int);
        push(ib, it, int);
      } else if (face === "top") {
        push(it, ot, ont);
        push(it, ont, int);
      } else {
        push(ib, on, ob);
        push(ib, inn, on);
      }
    }
    geometry.addGroup(first, positions.length / 3 - first, 0);
  }
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
};

export const socket = (
  parent: THREE.Object3D,
  name: string,
  kind: SocketKind,
  position: Point,
  maximumSize: Point,
  accepts: ReadonlyArray<string>,
  yaw = 0,
) => {
  const node = new THREE.Object3D();
  node.name = name;
  node.position.set(...position);
  node.rotation.y = yaw;
  node.userData = {
    socket: {
      kind,
      accepts: [...accepts],
      maximumSize: { width: maximumSize[0], height: maximumSize[1], depth: maximumSize[2] },
    },
  };
  parent.add(node);
  return node;
};
