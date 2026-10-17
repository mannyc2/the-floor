// The trader's clip catalogue, shared by the kit's build and the crowd. Each
// clip loops; its length is a whole number of its motion-capture source's
// loops, so the seam never jumps.
export const clipNames = [
  "type",
  "phone",
  "read",
  "lean",
  "asleep",
  "idle",
  "call",
  "bid",
  "walk",
  "hurry",
  "counter",
  "talk",
  "throw",
  "cheer",
  "slump",
  "pin",
  "ring",
  "coffee",
] as const;
export type ClipName = (typeof clipNames)[number];
export const clipIndex = (name: ClipName) => clipNames.indexOf(name);

export const clipSeconds: Record<ClipName, number> = {
  type: 5,
  phone: 5.8667,
  read: 5,
  lean: 5,
  asleep: 5,
  idle: 5,
  call: 5.8667,
  bid: 2.9333,
  walk: 1.3333,
  hurry: .9333,
  counter: 5,
  talk: 2.9333,
  throw: 2.9333,
  cheer: 2,
  slump: 5,
  pin: 4,
  ring: 2.5,
  coffee: 5,
};
export const clips = clipNames.map(name => ({ name, seconds: clipSeconds[name] }));

// Figure heights covered per loop of each gait, measured from the planted
// foot of the baked clip (a test holds them to the bake); the crowd turns
// walking speed into a clip rate with these, so feet do not skate.
export const gaits = {
  walk: { unitsPerCycle: .74 },
  hurry: { unitsPerCycle: 3 },
} as const;
export const cyclesPerUnit = (gait: keyof typeof gaits) => 1 / gaits[gait].unitsPerCycle;
