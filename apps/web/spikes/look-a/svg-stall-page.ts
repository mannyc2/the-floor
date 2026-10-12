import * as THREE from 'three';
import { createRenderer } from './renderer';
import { defaults, stall } from './scene';
import { svgStall, SVG_KIT_UNIT } from './svg-stall';
import { validateSvgRoute } from './svg-stall-validation';

interface RouteImage { id: string; route: 'three' | 'svg'; variant: number; renderer: string; triangles: number; kitUnit: string; camera: { matrixWorld: number[]; projectionMatrix: number[] } }
interface SvgRouteAPI { ready: boolean; error: string | null; images: RouteImage[]; validation: ReturnType<typeof validateSvgRoute> | null; mask: (value: boolean) => Promise<void>; dispose: () => void }
declare global { interface Window { svgRoute: SvgRouteAPI } }

const mounts: { active: ReturnType<typeof createRenderer>; geometry: THREE.BufferGeometry }[] = [];
window.svgRoute = { ready: false, error: null, images: [], validation: null, async mask(value) { for (const { active } of mounts) { active.mask(value); await active.waitForGPU(); } }, dispose() { for (const { active, geometry } of mounts) { active.dispose(); geometry.dispose(); } } };
const host = document.querySelector('main'), status = document.querySelector('#status');
if (!(host instanceof HTMLElement) || !(status instanceof HTMLElement)) throw new Error('Missing route comparison mount');

try {
  window.svgRoute.validation = validateSvgRoute();
  console.info('svg-route:geometry-validated', JSON.stringify(window.svgRoute.validation));
  for (const variant of [0, 1, 2]) {
    const label = document.createElement('span'); label.textContent = `Variant ${variant + 1}`; host.append(label);
    for (const route of ['three', 'svg'] as const) {
      const id = `${route}-${variant}`, cell = document.createElement('div'); cell.className = 'cell'; cell.id = id; host.append(cell);
      const active = createRenderer({ ...defaults, technique: 'B', width: 64, height: 64, dpr: 1 }, cell);
      const material = active.data.meshes[0]?.material;
      if (!material) throw new Error('Missing shared surface material');
      const geometry = route === 'svg' ? svgStall(variant) : stall(variant);
      const mesh = new THREE.Mesh(geometry, material); mesh.name = `${route}-stall-${variant}`; mesh.userData.kitUnit = SVG_KIT_UNIT;
      active.data.scene.clear(); active.data.scene.add(mesh);
      const camera = active.data.camera, target = new THREE.Vector3(0, 1.25, 0);
      camera.left = -2.1; camera.right = 2.1; camera.top = 2.1; camera.bottom = -2.1;
      camera.position.copy(target).add(new THREE.Vector3(35.355339, 28.867513, 35.355339)); camera.lookAt(target); camera.updateProjectionMatrix(); camera.updateMatrixWorld();
      active.draw(); await active.waitForGPU(); mounts.push({ active, geometry });
      const image: RouteImage = { id, route, variant, renderer: active.rendererString, triangles: geometry.getAttribute('position').count / 3, kitUnit: SVG_KIT_UNIT, camera: { matrixWorld: camera.matrixWorld.toArray(), projectionMatrix: camera.projectionMatrix.toArray() } };
      window.svgRoute.images.push(image); console.info('svg-route:rendered', JSON.stringify(image));
    }
  }
  window.svgRoute.ready = true;
  status.textContent = 'Geometry and semantic boundaries match. Technical comparison; owner pick pending.';
} catch (error) { const message = error instanceof Error ? error.message : String(error); window.svgRoute.error = message; status.textContent = message; console.error('svg-route:failed', message); }
window.addEventListener('pagehide', () => window.svgRoute.dispose(), { once: true });
