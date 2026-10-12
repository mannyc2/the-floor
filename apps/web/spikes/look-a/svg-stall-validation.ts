import * as THREE from 'three';
import { stall } from './scene';
import { svgStall } from './svg-stall';

function vertices(geometry: THREE.BufferGeometry): THREE.Vector3[] {
  const position = geometry.getAttribute('position');
  const unique = new Map<string, THREE.Vector3>();
  for (let index = 0; index < position.count; index++) {
    const point = new THREE.Vector3().fromBufferAttribute(position, index);
    unique.set(point.toArray().join(','), point);
  }
  return [...unique.values()];
}

function directedDistance(source: THREE.Vector3[], target: THREE.Vector3[]): number {
  return Math.max(...source.map(point => Math.min(...target.map(candidate => point.distanceTo(candidate)))));
}

function attributeReport(geometry: THREE.BufferGeometry) {
  const position = geometry.getAttribute('position'), surfaces = geometry.getAttribute('_SURFACE'), materials = geometry.getAttribute('_MAT');
  if (!surfaces || !materials || surfaces.count !== position.count || materials.count !== position.count) throw new Error('Missing or misaligned Atlas attributes');
  const ids = Array.from(surfaces.array), slots = Array.from(materials.array);
  const perTriangleConstant = ids.every((value, index) => value === ids[index - index % 3]) && slots.every((value, index) => value === slots[index - index % 3]);
  const validIds = ids.every(value => Number.isInteger(value) && value > 0);
  const validSlots = slots.every(value => Number.isInteger(value) && value >= 0);
  if (!perTriangleConstant || !validIds || !validSlots) throw new Error('Invalid Atlas face attributes');
  return { triangles: position.count / 3, surfaceGroups: new Set(ids).size, paletteSlots: [...new Set(slots)].sort((a, b) => a - b), perTriangleConstant, validIds, validSlots, kitUnit: geometry.userData.kitUnit ?? 'source mesh convention recorded in shared scene' };
}

function semanticEdges(geometry: THREE.BufferGeometry): string[] {
  const positions = geometry.getAttribute('position'), surfaces = geometry.getAttribute('_SURFACE');
  const edges = new Map<string, Set<number>>();
  const key = (index: number) => [positions.getX(index), positions.getY(index), positions.getZ(index)].map(value => Math.round(value * 1e5)).join(',');
  for (let index = 0; index < positions.count; index += 3) {
    for (const [a, b] of [[index, index + 1], [index + 1, index + 2], [index + 2, index]]) {
      if (a === undefined || b === undefined) throw new Error('Incomplete triangle edge');
      const edge = [key(a), key(b)].sort().join('|');
      const groups = edges.get(edge) ?? new Set<number>(); groups.add(surfaces.getX(index)); edges.set(edge, groups);
    }
  }
  return [...edges.entries()].filter(([, groups]) => groups.size > 1).map(([edge]) => edge).sort();
}

export function validateSvgRoute() {
  const variants = [];
  for (const variant of [0, 1, 2]) {
    const svgStart = performance.now(), svg = svgStall(variant), svgMs = performance.now() - svgStart;
    // The preexisting generator enters only the comparison; SVG construction imports neither its code nor its triangles.
    const threeStart = performance.now(), generated = stall(variant), threeMs = performance.now() - threeStart;
    const svgPoints = vertices(svg), threePoints = vertices(generated);
    const maximumVertexError = Math.max(directedDistance(svgPoints, threePoints), directedDistance(threePoints, svgPoints));
    const svgAttributes = attributeReport(svg), threeAttributes = attributeReport(generated);
    const svgEdges = semanticEdges(svg), threeEdges = semanticEdges(generated);
    const semanticBoundaryParity = JSON.stringify(svgEdges) === JSON.stringify(threeEdges);
    if (maximumVertexError > 1e-6 || !semanticBoundaryParity || svgAttributes.triangles !== threeAttributes.triangles || JSON.stringify(svgAttributes.paletteSlots) !== JSON.stringify(threeAttributes.paletteSlots)) throw new Error(`SVG variant ${variant} differs: vertexError=${maximumVertexError}, semanticParity=${semanticBoundaryParity}`);
    variants.push({ variant, svg_runtime_ms: svgMs, three_runtime_ms: threeMs, maximum_bidirectional_vertex_error_world: maximumVertexError, svg: svgAttributes, three: threeAttributes, svg_unique_vertices: svgPoints.length, three_unique_vertices: threePoints.length, semantic_boundary_edge_count: svgEdges.length, semantic_boundary_parity: semanticBoundaryParity });
    svg.dispose(); generated.dispose();
  }
  return { variants, method: 'Independently authored SVG M/L/Z profiles extruded or revolved; original generator is imported only by the validation module. Bidirectional vertex-set distance <=1e-6 world units, triangle counts, palette slots, and semantic boundary edge sets are checked. Boundary comparison rounds coordinates to1e-5; numerical IDs and triangle diagonals may differ.', limits: ['Runtime is not authoring effort.', 'This checks geometry and semantic boundaries; it does not choose asset art direction or establish production budgets.'] };
}
