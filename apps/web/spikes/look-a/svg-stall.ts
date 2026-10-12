import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import tokens from './atlas-tokens.json';
import { STALL_RECTANGLE_PROFILE, STALL_REVOLUTION_PROFILE, svgPathPoints } from './svg-profiles';

export const SVG_KIT_UNIT = 'provisional stand-in unit; not a Part B choice';
export interface SvgStallParameters { width: number; depth: number; postHeight: number }
export const SVG_STALL_PARAMETERS: SvgStallParameters = { width: 2.4, depth: 1.8, postHeight: 2.3 };
type PrimitiveKind = 'extruded' | 'revolved';

function attributedPart(source: THREE.BufferGeometry, kind: PrimitiveKind, paletteName: string, surfaceBase: number): THREE.BufferGeometry {
  const input = source.index ? source.toNonIndexed() : source;
  const position = input.getAttribute('position');
  const positions: number[] = [], normals: number[] = [], surfaces: number[] = [], materials: number[] = [];
  const palette = tokens.color.tokens.findIndex(token => token.name === paletteName);
  if (palette < 0) throw new Error(`Missing palette token ${paletteName}`);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let index = 0; index < position.count; index += 3) {
    a.fromBufferAttribute(position, index); b.fromBufferAttribute(position, index + 1); c.fromBufferAttribute(position, index + 2);
    const normal = b.clone().sub(a).cross(c.clone().sub(a));
    // Revolution endpoints lie on the axis. Those collapsed triangles carry no surface area.
    if (normal.lengthSq() < 1e-18) continue;
    normal.normalize();
    let face: number;
    if (kind === 'revolved') face = Math.abs(normal.y) > .999 ? (normal.y > 0 ? 1 : 2) : 0;
    else if (Math.abs(normal.x) > .999) face = normal.x > 0 ? 0 : 1;
    else if (Math.abs(normal.y) > .999) face = normal.y > 0 ? 2 : 3;
    else face = normal.z > 0 ? 4 : 5;
    for (const point of [a, b, c]) {
      positions.push(point.x, point.y, point.z);
      // The cap remains flat and the wall remains smooth regardless of SVG triangulation.
      const vertexNormal = kind === 'revolved' && face === 0 ? new THREE.Vector3(point.x, 0, point.z).normalize() : normal;
      normals.push(vertexNormal.x, vertexNormal.y, vertexNormal.z);
      surfaces.push(surfaceBase + face); materials.push(palette);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('_SURFACE', new THREE.Float32BufferAttribute(surfaces, 1));
  geometry.setAttribute('_MAT', new THREE.Float32BufferAttribute(materials, 1));
  input.dispose(); if (input !== source) source.dispose();
  return geometry;
}

/** Independently authored SVG profiles and assembly dimensions; no generator triangles are imported. */
export function svgStall(variant: number, parameters: SvgStallParameters = SVG_STALL_PARAMETERS): THREE.BufferGeometry {
  if (![0, 1, 2].includes(variant)) throw new Error('Expected stall variant 0, 1, or 2');
  const { width, depth, postHeight } = parameters;
  const pieces: THREE.BufferGeometry[] = [];
  let nextSurface = 1;
  const extrude = (w: number, h: number, d: number, x: number, y: number, z: number, material = 'tone-1') => {
    const shape = new THREE.Shape(svgPathPoints(STALL_RECTANGLE_PROFILE).map(point => new THREE.Vector2(point.x * w, point.y * h)));
    const source = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false, steps: 1, curveSegments: 1 }).translate(0, 0, -d / 2);
    const geometry = attributedPart(source, 'extruded', material, nextSurface).translate(x, y, z);
    nextSurface += 6; pieces.push(geometry);
  };
  const revolve = (radius: number, height: number, x: number, y: number, z: number, material = 'steel') => {
    const profile = svgPathPoints(STALL_REVOLUTION_PROFILE).map(point => new THREE.Vector2(point.x * radius, point.y * height));
    const geometry = attributedPart(new THREE.LatheGeometry(profile, 24), 'revolved', material, nextSurface).translate(x, y, z);
    nextSurface += 3; pieces.push(geometry);
  };
  extrude(width, .25, depth, 0, .125, 0);
  extrude(width, .65, .35, 0, .7, .75);
  extrude(width + .2, .13, depth + .3, 0, 2.45, 0);
  for (const x of [-1, 1]) for (const z of [-.7, .7]) extrude(.12, postHeight, .12, x, 1.25, z);
  extrude(1.4, .28, .08, 0, 2.15, .96, 'steel');
  if (variant === 0) revolve(.42, .65, -.55, 1.1, 0);
  if (variant === 1) for (const x of [-.6, 0, .6]) extrude(.42, .55, .55, x, 1.03, -.1);
  if (variant === 2) { extrude(1.7, .55, .6, 0, 1.03, -.1); revolve(.24, .5, .6, 1.55, -.1); }
  const geometry = mergeGeometries(pieces, false);
  pieces.forEach(piece => piece.dispose());
  if (!geometry) throw new Error('SVG profile attribute mismatch');
  geometry.userData = { kitUnit: SVG_KIT_UNIT, route: 'SVG profiles extruded/revolved', variant, parameters, sourceProfiles: [STALL_RECTANGLE_PROFILE, STALL_REVOLUTION_PROFILE] };
  return geometry;
}
