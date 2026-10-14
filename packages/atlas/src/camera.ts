import { Record as Records } from "effect";
import { synthetic } from "./tokens";

const source = "docs/decisions.md#the-look";
const recorded = <A>(value: A, reason: string) => synthetic(value, source, reason);
export const cameraValues = {
  pitchRadians: recorded(Math.PI / 6, "Recorded isometric pitch; exact camera framing remains unapproved."),
  quarterTurnRadians: recorded(Math.PI / 2, "Recorded quarter-turn interaction; no scene-framing approval."),
  horizontalOffset: recorded(35.355339, "Retain the original rounded camera basis exactly so captures do not drift."),
  verticalOffset: recorded(28.867513, "Retain the original rounded camera basis exactly so captures do not drift."),
  targetHeight: recorded(1, "Synthetic renderer target elevation; no art or physical-scale approval."),
  distance: recorded(250, "Synthetic orthographic camera offset; does not establish physical units."),
};
export const cameraRungValues = {
  building: recorded(21, "Synthetic vertical view extent; world-units-per-CSS-pixel depends on viewport height."),
  floor: recorded(12, "Synthetic vertical view extent; world-units-per-CSS-pixel depends on viewport height."),
  desk: recorded(7, "Synthetic vertical view extent; world-units-per-CSS-pixel depends on viewport height."),
};
export const cameraRungs = Records.map(cameraRungValues, entry => entry.value);
export const cameraCorners = {
  0: recorded({ x: 1, z: 1 }, "Original corner; the near positive-X/positive-Z walls and ceiling are cut away."),
  1: recorded({ x: 1, z: -1 }, "Quarter turn; the near positive-X/negative-Z walls and ceiling are cut away."),
  2: recorded({ x: -1, z: -1 }, "Half turn; the near negative-X/negative-Z walls and ceiling are cut away."),
  3: recorded({ x: -1, z: 1 }, "Three-quarter turn; the near negative-X/positive-Z walls and ceiling are cut away."),
};
export const cameraFlight = {
  defaultMs: recorded(900, "Existing interruptible synthetic camera flight duration."),
  minimumMs: recorded(600, "Recorded minimum interruptible camera flight duration."),
  maximumMs: recorded(1200, "Recorded maximum interruptible camera flight duration."),
  arc: recorded(.2, "Existing synthetic sinusoidal extent lift, without camera tuning approval."),
};

const studySource = "testing/look/scenes/proportions-post-day.json";
const study = (value: number) =>
  synthetic(value, studySource, "Recorded comparison framing, outside the Roomy proportion approval.");
export const proportionCameraValues = {
  castCentre: study(-2),
  postCentre: study(-4),
  rotation: study(0),
  floorExtent: study(78),
  postExtent: study(38),
  castExtent: study(25),
};
