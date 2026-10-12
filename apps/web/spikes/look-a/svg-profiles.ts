import { Vector2 } from 'three';

export const STALL_RECTANGLE_PROFILE = 'M -0.5 -0.5 L 0.5 -0.5 L 0.5 0.5 L -0.5 0.5 Z';
export const STALL_REVOLUTION_PROFILE = 'M 0 -0.5 L 1 -0.5 L 1 0.5 L 0 0.5';
export const FIGURE_RADIAL_PROFILE = 'M 0.14 0 L 0.26 0.15 L 0.2 0.52 L 0.11 0.62';

/** The authored SVGs use absolute polygonal paths; rejecting curves avoids hidden tessellation changes. */
export function svgPathPoints(path: string): Vector2[] {
  const tokenPattern = /[MLZ]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g;
  if (path.replace(tokenPattern, '').replace(/[\s,]/g, '')) throw new Error('Only absolute SVG M/L/Z paths are supported');
  const tokens = path.match(tokenPattern) ?? [];
  const points: Vector2[] = [];
  let command: 'M' | 'L' | undefined;
  for (let index = 0; index < tokens.length;) {
    const token = tokens[index];
    if (token === 'M' || token === 'L') { command = token; index++; continue; }
    if (token === 'Z') {
      const first = points[0], last = points.at(-1);
      if (!first || !last) throw new Error('Cannot close an empty SVG profile');
      if (!first.equals(last)) points.push(first.clone());
      command = undefined; index++; continue;
    }
    if (!command || (points.length === 0 && command !== 'M')) throw new Error('SVG profile must start with M');
    const next = tokens[index + 1];
    if (token === undefined || next === undefined || /[MLZ]/.test(next)) throw new Error('SVG coordinate pair is incomplete');
    const x = Number(token), y = Number(next);
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('SVG coordinates must be finite');
    points.push(new Vector2(x, y)); command = 'L'; index += 2;
  }
  if (points.length < 2) throw new Error('SVG profile needs at least two points');
  return points;
}

export function svgProfileDocument(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-0.6 -0.6 1.8 1.3"><path id="stall-rectangle" d="${STALL_RECTANGLE_PROFILE}"/><path id="stall-revolution" d="${STALL_REVOLUTION_PROFILE}"/><path id="figure-radial" d="${FIGURE_RADIAL_PROFILE}"/></svg>\n`;
}
