import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import tokens from './atlas-tokens.json';

export type Theme = 'day' | 'night';
export type Rung = 'district' | 'works' | 'machine';
export type Technique = 'A' | 'B' | 'C';
export interface Config { technique: Technique; theme: Theme; rung: Rung; dpr: number; width: number; height: number; stalls: number; backend: 'webgl' | 'webgpu'; asset?: 'rack' }
export const defaults: Config = { technique: 'A', theme: 'day', rung: 'district', dpr: 1, width: 480, height: 360, stalls: 12, backend: 'webgl' };
export const names = tokens.color.tokens.map(token => token.name);
export function tokenColor(name: string, theme: Theme): string {
  const token = tokens.color.tokens.find(item => item.name === name);
  if (!token) throw new Error(`Unknown Atlas token ${name}`);
  const value = token.value[theme];
  return value.startsWith('{') ? tokenColor(value.slice(1, -1), theme) : value.slice(0, 7);
}
export const slot = (name: string): number => {
  const index = names.indexOf(name);
  if (index < 0) throw new Error(`Missing palette slot ${name}`);
  return index;
};
let nextSurface = 1;
function attributed(source: THREE.BufferGeometry, name: string): THREE.BufferGeometry {
  const geometry = source.index ? source.toNonIndexed() : source;
  const count = geometry.getAttribute('position').count;
  const surfaces = new Float32Array(count).fill(nextSurface++);
  // Semantic primitive surfaces remain stable when triangulation changes.
  for (const group of geometry.groups) {
    const id = nextSurface++;
    for (let vertex = group.start; vertex < Math.min(group.start + group.count, count); vertex++) surfaces[vertex] = id;
  }
  geometry.setAttribute('_SURFACE', new THREE.BufferAttribute(surfaces, 1));
  geometry.setAttribute('_MAT', new THREE.BufferAttribute(new Float32Array(count).fill(slot(name)), 1));
  geometry.clearGroups();
  return geometry;
}
function part(geometry: THREE.BufferGeometry, name: string, x: number, y: number, z: number): THREE.BufferGeometry {
  return attributed(geometry, name).translate(x, y, z);
}
const box = (w: number, h: number, d: number, x: number, y: number, z: number, name = 'tone-1') => part(new THREE.BoxGeometry(w, h, d), name, x, y, z);
const cylinder = (r: number, h: number, x: number, y: number, z: number, name = 'steel') => part(new THREE.CylinderGeometry(r, r, h, 24), name, x, y, z);
function joined(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const result = mergeGeometries(parts, false);
  if (!result) throw new Error('Primitive attribute mismatch');
  parts.forEach(geometry => geometry.dispose());
  return result;
}
export function stall(variant: number): THREE.BufferGeometry {
  const width = 2.4, depth = 1.8, postHeight = 2.3;
  const pieces = [box(width, .25, depth, 0, .125, 0), box(width, .65, .35, 0, .7, .75), box(width + .2, .13, depth + .3, 0, 2.45, 0)];
  for (const x of [-1, 1]) for (const z of [-.7, .7]) pieces.push(box(.12, postHeight, .12, x, 1.25, z));
  pieces.push(box(1.4, .28, .08, 0, 2.15, .96, 'steel'));
  if (variant === 0) pieces.push(cylinder(.42, .65, -.55, 1.1, 0));
  if (variant === 1) for (const x of [-.6, 0, .6]) pieces.push(box(.42, .55, .55, x, 1.03, -.1));
  if (variant === 2) pieces.push(box(1.7, .55, .6, 0, 1.03, -.1), cylinder(.24, .5, .6, 1.55, -.1));
  return joined(pieces);
}
function figure(x: number, z: number): THREE.BufferGeometry {
  const points = [[.14, 0], [.26, .15], [.2, .52], [.11, .62]].map(([r = 0, y = 0]) => new THREE.Vector2(r, y));
  return joined([part(new THREE.LatheGeometry(points, 16), 'steel', x, .1, z), part(new THREE.SphereGeometry(.14, 16, 8), 'tone-2', x, .83, z), box(.08, .3, .1, x - .1, .15, z), box(.08, .3, .1, x + .1, .15, z)]);
}
export interface SceneData { scene: THREE.Scene; camera: THREE.OrthographicCamera; meshes: THREE.Mesh[]; geometries: THREE.BufferGeometry[]; labels: { text: string; at: THREE.Vector3 }[] }
export function cameraFor(config: Pick<Config, 'rung' | 'width' | 'height'>): THREE.OrthographicCamera {
  const extent = config.rung === 'district' ? 21 : config.rung === 'works' ? 12 : 7;
  const target = config.rung === 'district' ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 2.5, -3.8);
  const camera = new THREE.OrthographicCamera(-extent * config.width / config.height / 2, extent * config.width / config.height / 2, extent / 2, -extent / 2, .1, 200);
  camera.position.copy(target).add(new THREE.Vector3(35.355339, 28.867513, 35.355339));
  camera.lookAt(target); camera.updateMatrixWorld();
  camera.userData = { target: target.toArray(), provisional: true };
  return camera;
}
export function makeScene(config: Config, material: THREE.Material): SceneData {
  nextSurface = 1;
  const scene = new THREE.Scene();
  const meshes: THREE.Mesh[] = [], geometries: THREE.BufferGeometry[] = [];
  const add = (name: string, geometry: THREE.BufferGeometry) => { const mesh = new THREE.Mesh(geometry, material); mesh.name = name; scene.add(mesh); meshes.push(mesh); geometries.push(geometry); return mesh; };
  const ground = [box(18, .25, 15, 0, -.15, 0, 'tone-0'), box(18, .12, 2, 0, -.12, 8.5, 'water')];
  for (let x = -8; x < 9; x += 2) for (let z = -6; z < 7; z += 2) ground.push(box(1.94, .04, 1.94, x, .005, z, 'tone-1'));
  add('paving-and-quay', joined(ground));
  for (let variant = 0; variant < 3; variant++) {
    const geometry = stall(variant), count = Math.floor((config.stalls + 2 - variant) / 3);
    const mesh = new THREE.InstancedMesh(geometry, material, count); mesh.name = `stall-variant-${variant}`;
    const matrix = new THREE.Matrix4();
    for (let i = 0; i < count; i++) { const index = i * 3 + variant; const columns = config.stalls > 12 ? 32 : 6; matrix.makeTranslation((index % columns - (columns - 1) / 2) * 2.8, .05, config.stalls > 12 ? (Math.floor(index / columns) - 15) * 2.7 : Math.floor(index / columns) * 3.3 + 1.4); mesh.setMatrixAt(i, matrix); }
    scene.add(mesh); meshes.push(mesh); geometries.push(geometry);
  }
  const rack = [box(4.1, .25, 2.4, 0, .18, -4), box(.2, 5.8, .3, -1.9, 3, -4), box(.2, 5.8, .3, 1.9, 3, -4), box(4, .25, 2.4, 0, 6, -4)];
  for (let i = 0; i < 7; i++) { const y = .8 + i * .7; rack.push(box(3.6, .12, 1.8, 0, y, -4, 'steel'), box(3.2, .07, 1.45, 0, y + .09, -4, 'water')); }
  rack.push(cylinder(.28, .45, .9, 3.6, -3.3, 'brass'), box(.06, 5.5, .06, 1.6, 3, -2.97, 'brass'), box(.28, .5, .5, 1.1, 3.36, -3.2, 'accent'));
  for (let i = 0; i < 28; i++) rack.push(box(i % 5 === 0 ? .25 : .13, .025, .035, 1.5, .45 + i * .19, -2.92, 'engraving'));
  add('depth-rack', joined(rack));
  const tide = [cylinder(.52, 1.45, -3.5, 1.15, -3.5, 'paper'), cylinder(.21, 2.8, -4.5, 1.6, -3.5, 'brass'), box(1, .06, .08, -4, 2.4, -3.5, 'brass')];
  for (let i = 0; i < 15; i++) tide.push(box(.16, .025, .05, -4.5, .4 + i * .17, -3.25, 'engraving'));
  add('tide-gauge', joined(tide));
  add('figure-one', figure(2.8, -2)); add('figure-two', figure(-2.4, -1.8));
  if(config.asset==='rack')for(const mesh of meshes)if(mesh.name!=='depth-rack')scene.remove(mesh);
  const camera=cameraFor(config);
  if(config.stalls>12){
    // The stress case must submit all stalls, not cull most of them outside a twelve-stall view.
    const bounds=new THREE.Box3();
    for(const mesh of meshes)bounds.expandByObject(mesh);
    const center=bounds.getCenter(new THREE.Vector3()),size=bounds.getSize(new THREE.Vector3());
    const extent=Math.max(size.length(),size.length()*config.height/config.width)*1.08;
    const direction=camera.position.clone().sub(new THREE.Vector3(0,1,0)).normalize();
    camera.position.copy(center).addScaledVector(direction,250);camera.lookAt(center);
    camera.left=-extent*config.width/config.height/2;camera.right=-camera.left;camera.top=extent/2;camera.bottom=-extent/2;camera.far=500;camera.updateProjectionMatrix();camera.updateMatrixWorld();
  }
  return { scene, camera, meshes:config.asset==='rack'?meshes.filter(mesh=>mesh.name==='depth-rack'):meshes, geometries, labels: [{ text: 'CANAL HALL', at: new THREE.Vector3(0, .2, 6.7) }, { text: 'DEPTH RACK', at: new THREE.Vector3(0, 6.6, -4) }] };
}

export function exportScene(data: SceneData) {
  const output: { name: string; positions: number[]; normals: number[]; surfaceIds: number[]; materialSlots: number[] }[] = [];
  for (const mesh of data.meshes) {
    const instances = mesh instanceof THREE.InstancedMesh ? mesh.count : 1;
    for (let instance = 0; instance < instances; instance++) {
      const matrix = new THREE.Matrix4();
      if (mesh instanceof THREE.InstancedMesh) mesh.getMatrixAt(instance, matrix);
      const geometry = mesh.geometry.clone().applyMatrix4(matrix);
      output.push({ name: `${mesh.name}-${instance}`, positions: Array.from(geometry.getAttribute('position').array), normals: Array.from(geometry.getAttribute('normal').array), surfaceIds: Array.from(geometry.getAttribute('_SURFACE').array), materialSlots: Array.from(geometry.getAttribute('_MAT').array) });
      geometry.dispose();
    }
  }
  const cameras = Object.fromEntries(['district', 'works', 'machine'].map(rung => {
    const checked: Rung = rung === 'district' ? 'district' : rung === 'works' ? 'works' : 'machine';
    const camera = cameraFor({ rung: checked, width: 480, height: 360 });
    return [rung, { matrixWorld: camera.matrixWorld.toArray(), projectionMatrix: camera.projectionMatrix.toArray(), left: camera.left, right: camera.right, top: camera.top, bottom: camera.bottom, near: camera.near, far: camera.far }];
  }));
  return { kitUnit: 'provisional stand-in unit; not a Part B choice', meshes: output, cameras, viewport: { width: 480, height: 360 }, palette: names.map(name => ({ name, day: tokenColor(name, 'day'), night: tokenColor(name, 'night') })), stallParameters: { width: 2.4, depth: 1.8, postHeight: 2.3, variants: 3 } };
}
