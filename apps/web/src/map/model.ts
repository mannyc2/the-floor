import { Schema } from "effect";

export const EntityId = Schema.Int.check(Schema.isGreaterThan(0));
export const Rotation = Schema.Literals([0, 1, 2, 3]);
export type Rotation = typeof Rotation.Type;
export const Turn = Schema.Literals(["left", "right"]);
export type Turn = typeof Turn.Type;
export const Camera = Schema.Struct({
  x: Schema.Finite,
  z: Schema.Finite,
  extent: Schema.Finite.check(Schema.isGreaterThan(0)),
  rotation: Rotation,
});
export type Camera = typeof Camera.Type;
// Old links predate rotation; their original corner remains the default. Invalid
// rotations reject the whole view instead of silently pointing somewhere else.
export const cameraFromQuery = (query: URLSearchParams) =>
  Schema.decodeUnknownOption(Camera)({
    x: Number(query.get("x")),
    z: Number(query.get("z")),
    extent: Number(query.get("extent")),
    rotation: Number(query.get("rotation") ?? 0),
  });
export const Theme = Schema.Literals(["day", "night"]);
export type Theme = typeof Theme.Type;
export const Presentation = Schema.Struct({
  revision: Schema.Int,
  theme: Theme,
  camera: Camera,
  // Elapsed simulation milliseconds, not a wall-clock instant. Keeping this
  // offset separate from DateTime allows deterministic replay at different rates.
  sampleTime: Schema.Finite,
  playbackRate: Schema.Finite,
  previousValue: Schema.Finite,
  nextValue: Schema.Finite,
  // The interpolation interval begins in the same simulation-time coordinate.
  intervalStart: Schema.Finite,
});
export type Presentation = typeof Presentation.Type;
export class MapFault extends Schema.TaggedError<MapFault>()("MapFault", {
  phase: Schema.Literals([
    "renderer-import",
    "camera-import",
    "renderer-callback",
    "renderer-retire",
    "webgl-open",
    "camera-open",
    "camera-close",
    "camera-input",
    "camera-rotation",
    "camera-flight",
    "camera-follow-target",
    "camera-pause",
    "pick",
    "poisoned-display",
    "presentation",
    "draw",
    "advance",
    "inactive-snapshot",
    "instance-snapshot",
    "not-mounted",
    "host",
    "rendered-schema",
    "replay-observer",
  ]),
  message: Schema.String,
  cause: Schema.Defect(),
}) {}
export const fault = (phase: MapFault["phase"], cause: unknown) =>
  new MapFault({ phase, message: String(cause), cause });
