import { FloorPlace } from "@floor/contract/world";
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
// Ground areas and positions are in the viewer's frame: the world plan shifted
// so the first floor's origin sits at zero.
export const GroundArea = Schema.Struct({ x0: Schema.Finite, z0: Schema.Finite, x1: Schema.Finite, z1: Schema.Finite });
export type GroundArea = typeof GroundArea.Type;
// The figure meshes a live slot owns, in marker-variant order: seated at its
// own desk, standing at a place or another desk, walking among other posts.
export const livePoses = ["seated", "standing", "walking"] as const;
export type LivePose = (typeof livePoses)[number];
// Post slots ride in the instance snapshot beside desks, under keys clear of
// the 12-bit desk identities; a post picks as ground. A slot is drawn open or
// as an unbuilt footprint by which of its two keys the snapshot lists.
export const postKeys = { open: 100_000, blueprint: 200_000 } as const;
// What a live mount needs that a synthetic one does not. The layout's scale
// (plan units per nominal figure height H) sizes the asset kit; each floor's
// ground, the lobby, door passages, named places and lobby plots are static
// for a mount, as is the reachable extent of the world. Desks, figures and
// posts arrive in the snapshot. A layout that declares no lobby, doors or
// places leaves those lists empty.
export const LiveScene = Schema.Struct({
  unitsPerH: Schema.Finite.check(Schema.isGreaterThan(0)),
  stationsPerPost: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 12 })),
  monitorsPerPost: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 12 })),
  posts: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  rooms: Schema.Array(Schema.Struct({ areas: Schema.Array(GroundArea), blueprint: Schema.Boolean })),
  lobby: Schema.Array(GroundArea),
  doors: Schema.Array(GroundArea),
  // A place's furniture backs onto its room's outer wall; `facing` is the
  // yaw that turns +Z toward it, which an agent standing there also takes.
  places: Schema.Array(Schema.Struct({ place: FloorPlace, area: GroundArea, facing: Schema.Finite })),
  plots: Schema.Array(GroundArea),
  bounds: GroundArea,
  snapshot: Schema.Json,
});
export type LiveScene = typeof LiveScene.Type;
export const Theme = Schema.Literals(["day", "night"]);
export type Theme = typeof Theme.Type;
// A link may carry the night view; anything else opens by day.
export const themeFromQuery = (query: URLSearchParams) => Schema.decodeUnknownOption(Theme)(query.get("theme"));
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
