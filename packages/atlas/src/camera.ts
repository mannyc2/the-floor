// Keep the original rounded basis so existing captures do not drift.
export const cameraValues = {
  pitchRadians: Math.PI / 6,
  quarterTurnRadians: Math.PI / 2,
  "horizontalOffset": 35.355339,
  "verticalOffset": 28.867513,
  "targetHeight": 1,
  "distance": 250,
} as const;
export const cameraRungs = { building: 21, floor: 12, desk: 7 } as const;
export const cameraCorners = {
  0: { x: 1, z: 1 },
  1: { x: 1, z: -1 },
  2: { x: -1, z: -1 },
  3: { x: -1, z: 1 },
} as const;
export const cameraFlight = {
  "defaultMs": 900,
  "minimumMs": 600,
  "maximumMs": 1200,
  "arc": 0.2,
} as const;
export const proportionCameraValues = {
  "castCentre": -2,
  "postCentre": -4,
  "rotation": 0,
  "floorExtent": 78,
  "postExtent": 38,
  "castExtent": 25,
} as const;
