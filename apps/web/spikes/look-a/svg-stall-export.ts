import { mkdir } from 'node:fs/promises';
import { BufferGeometryLoader } from 'three';
import { svgStall, SVG_KIT_UNIT } from './svg-stall';
import { svgProfileDocument } from './svg-profiles';
import { validateSvgRoute } from './svg-stall-validation';

const output = process.env.SVG_OUTPUT ?? 'work/spikes/look/svg-stall/002';
await mkdir(output, { recursive: true });
await Bun.write(`${output}/profiles.svg`, svgProfileDocument());
const report = validateSvgRoute();
const exports = [];
for (const variant of [0, 1, 2]) {
  const geometry = svgStall(variant), path = `${output}/svg-stall-${variant}.geometry.json`;
  await Bun.write(path, JSON.stringify(geometry.toJSON()) + '\n');
  const restored = new BufferGeometryLoader().parse(await Bun.file(path).json());
  for (const name of ['position', 'normal', '_SURFACE', '_MAT']) {
    if (JSON.stringify(Array.from(geometry.getAttribute(name).array)) !== JSON.stringify(Array.from(restored.getAttribute(name).array))) throw new Error(`Export changed ${name}`);
  }
  if (restored.userData.kitUnit !== SVG_KIT_UNIT) throw new Error('Export changed kit unit');
  exports.push({ variant, path, all_four_attributes_identical: true, kit_unit_preserved: true });
  geometry.dispose(); restored.dispose();
}
await Bun.write(`${output}/geometry-report.json`, JSON.stringify({ ...report, exports }, null, 2) + '\n');
console.log(JSON.stringify({ ...report, exports }, null, 2));
