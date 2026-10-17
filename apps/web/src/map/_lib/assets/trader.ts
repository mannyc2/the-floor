import * as THREE from "three";
import { bodies, hairStyles, type TraderKit, visibility } from "./trader-kit";

// The live floor's trader, from the trader kit: one body and one hairstyle
// each, with the props every trader can hold. The kit holds both bodies and
// every hairstyle in one mesh; a trader is drawn by the variant matching its
// look, so no instance runs the vertex shader over parts it does not show.
export const traderVariants = bodies.flatMap(body => hairStyles.map(style => ({ body, style })));

// A look's variant: its body and hairstyle, as `crowd` packs them.
export const variantOf = (look: readonly [number, number, number, number]) => {
  const style = Math.round(look[3]) % 16, body = Math.floor(Math.round(look[3]) / 64);
  return Math.min(traderVariants.length - 1, Math.max(0, body * hairStyles.length + style - 1));
};

// `firstSurface` keeps its outlines clear of its station's surfaces.
export const makeTraderVariant = (firstSurface: number, kit: TraderKit, variant: (typeof traderVariants)[number]) => {
  const shown = new Set([visibility.always, visibility.body(variant.body), visibility.hair(variant.style)]);
  const keep: Array<number> = [];
  const local = new Int32Array(kit.header.vertices).fill(-1);
  for (let vertex = 0; vertex < kit.header.vertices; vertex++) {
    if (!shown.has(Math.round(kit.part[vertex * 4 + 3] ?? -1))) continue;
    local[vertex] = keep.length;
    keep.push(vertex);
  }
  const lanes = (source: Float32Array, width: number) => {
    const out = new Float32Array(keep.length * width);
    keep.forEach((vertex, index) => out.set(source.subarray(vertex * width, vertex * width + width), index * width));
    return out;
  };
  const part = lanes(kit.part, 4);
  for (let lane = 0; lane < part.length; lane += 4) part[lane] = firstSurface;
  const index: Array<number> = [];
  for (let corner = 0; corner < kit.index.length; corner += 3) {
    const a = local[kit.index[corner] ?? 0] ?? -1, b = local[kit.index[corner + 1] ?? 0] ?? -1;
    const c = local[kit.index[corner + 2] ?? 0] ?? -1;
    if (a >= 0 && b >= 0 && c >= 0) index.push(a, b, c);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(lanes(kit.position, 3), 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(lanes(kit.normal, 3), 3));
  geometry.setAttribute("_PART", new THREE.BufferAttribute(part, 4));
  geometry.setAttribute("_SKIN", new THREE.BufferAttribute(lanes(kit.skin, 4), 4));
  geometry.setIndex(index);
  return geometry;
};
