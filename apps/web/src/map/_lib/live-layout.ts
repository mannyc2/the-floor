import { AgentState } from "@floor/contract/agents";
import { FloorPlace } from "@floor/contract/world";

// The live floor's dimensions in figure heights (H), shared by the viewer's
// placement, which must not load three.js, and the renderer's kit and crowd.

// A seated trader: the stool's seat top, the hip's distance in front of the
// counter edge, how far under the worktop the knees reach, and the foot ring.
export const seating = { seat: .405, counterEdge: .1, kneeClearance: .27, footRing: .2 } as const;

// The post: its counter edge (an apothem of the faceted counter), worktop,
// depth and overhang; the plinth; where visitors crowd; and the pitch at which
// the viewer draws a layout's closest posts.
export const postLayout = {
  counterEdge: .98,
  worktop: .54,
  depth: .4,
  overhang: .19,
  plinth: 1.3,
  // Stools, bins and anyone standing within the plinth stand on its top.
  plinthHeight: .012,
  crowd: 1.42,
  pitch: 2.9,
} as const;

// From the counter edge: a seated trader's hip, and where one stands to work
// the counter, a step back from the stool.
export const traderReach = { seated: seating.counterEdge, standing: .3 } as const;

// What a figure is doing where it is, as the renderer's crowd reads it: at its
// own desk, beside another's, in a post's crowd, at a named place or in the
// lobby. States follow the agent's reported state; zero is none reported.
export const traderKinds = ["seat", "visit", "post", "place", "lobby"] as const;
export type TraderKind = (typeof traderKinds)[number];
export const traderStates = ["unreported", ...AgentState.literals] as const;
export const traderPlaces = FloorPlace.literals;
