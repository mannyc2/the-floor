import { Array, Effect } from "effect";
import { MeasurementError } from "./pixels";

export interface Point {
  readonly x: number;
  readonly y: number;
}
export interface Segment {
  readonly a: Point;
  readonly b: Point;
}
const cross = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
const half = Effect.fnUntraced(function*(points: ReadonlyArray<Point>) {
  const result: Array<Point> = [];
  for (const point of points) {
    while (result.length >= 2) {
      const a = yield* Effect.fromOption(Array.get(result, result.length - 2));
      const b = yield* Effect.fromOption(Array.get(result, result.length - 1));
      if (cross(a, b, point) > 1e-9) break;
      result.pop();
    }
    result.push(point);
  }
  return result;
});
const hull = Effect.fnUntraced(function*(points: ReadonlyArray<Point>) {
  const unique = [...new Map(points.map((point) => [`${point.x.toFixed(10)},${point.y.toFixed(10)}`, point])).values()]
    .toSorted((left, right) => left.x - right.x || left.y - right.y);
  const lower = yield* half(unique), upper = yield* half(unique.toReversed());
  lower.pop();
  upper.pop();
  return lower.concat(upper);
});
const distance = (point: Point, segment: Segment) => {
  const dx = segment.b.x - segment.a.x, dy = segment.b.y - segment.a.y, length = dx * dx + dy * dy;
  const t = length === 0
    ? 0
    : Math.max(0, Math.min(1, ((point.x - segment.a.x) * dx + (point.y - segment.a.y) * dy) / length));
  return Math.hypot(point.x - segment.a.x - t * dx, point.y - segment.a.y - t * dy);
};

export const validateConvexSilhouette = Effect.fnUntraced(
  function*(vertices: ReadonlyArray<Point>, projection: ReadonlyArray<Segment>) {
    const allPoints = [...vertices, ...projection.flatMap((segment) => [segment.a, segment.b])];
    if (allPoints.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
      return yield* new MeasurementError({
        operation: "validateConvexSilhouette",
        invariant: "Projected vertices and endpoints must be finite CSS coordinates",
      });
    }
    const boundary = yield* hull(vertices);
    if (boundary.length < 3 || projection.length === 0) {
      return yield* new MeasurementError({
        operation: "validateConvexSilhouette",
        invariant: "Nondegenerate convex vertices and at least one projected edge are required",
      });
    }
    const edges: Array<Segment> = [];
    for (let index = 0; index < boundary.length; index += 1) {
      const a = yield* Effect.fromOption(Array.get(boundary, index));
      const b = yield* Effect.fromOption(Array.get(boundary, (index + 1) % boundary.length));
      edges.push({ a, b });
    }
    let maxDistance = 0, samples = 0, maxOutside = 0;
    for (const edge of edges) {
      const count = Math.ceil(Math.hypot(edge.b.x - edge.a.x, edge.b.y - edge.a.y) * 10);
      for (let sample = 0; sample <= count; sample += 1) {
        const t = count === 0 ? 0 : sample / count;
        const point = { x: edge.a.x + (edge.b.x - edge.a.x) * t, y: edge.a.y + (edge.b.y - edge.a.y) * t };
        maxDistance = Math.max(maxDistance, Math.min(...projection.map((segment) => distance(point, segment))));
        samples += 1;
      }
    }
    for (const segment of projection) {
      for (const point of [segment.a, segment.b]) {
        for (const edge of edges) {
          maxOutside = Math.max(
            maxOutside,
            -cross(edge.a, edge.b, point) / Math.hypot(edge.b.x - edge.a.x, edge.b.y - edge.a.y),
          );
        }
      }
    }
    // This inherited tolerance checks numerical agreement, not art quality.
    return {
      pass: maxDistance <= 0.0001 && maxOutside <= 0.0001,
      boundary,
      samples,
      maxSilhouetteDistanceCssPx: maxDistance,
      maxProjectionOutsideHullCssPx: maxOutside,
      engineeringToleranceCssPx: 0.0001,
    };
  },
);
