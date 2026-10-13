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
export const Marker = Schema.Struct({ id: Schema.String, x: Schema.Finite, kind: Schema.Literals(["box", "sphere"]) });
export type Marker = typeof Marker.Type;
export const Snapshot = Schema.Struct({ revision: Schema.Int, markers: Schema.Array(Marker) });
export type Snapshot = typeof Snapshot.Type;
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
export const Envelope = Schema.Struct({
  generation: Schema.Int.check(Schema.isGreaterThan(0)),
  sequence: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  mode: Schema.Literals(["Live", "Paused"]),
  presentation: Presentation,
});
export type Envelope = typeof Envelope.Type;
export const Receipt = Schema.Struct({ generation: Schema.Int, sequence: Schema.Int });
export type Receipt = typeof Receipt.Type;
export class MapFault extends Schema.TaggedError<MapFault>()("MapFault", {
  phase: Schema.String,
  message: Schema.String,
  cause: Schema.Defect(),
}) {}
export const fault = (phase: string, cause: unknown) => new MapFault({ phase, message: String(cause), cause });
