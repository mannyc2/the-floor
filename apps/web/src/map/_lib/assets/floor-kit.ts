import type { PaletteName } from "@floor/atlas/materials";
import * as THREE from "three";
import { postLayout, seating, traderReach } from "../live-layout";
import { box, cylinder, makeGeometry, type Point } from "./geometry";

// The live floor's post and stations, after the picked post, floor and
// agents-at-work frames: a faceted timber counter on a low plinth, traders on
// tall stools shoulder to shoulder around it, a beige CRT, phone, keyboard and
// papers at every station, binders on the inner shelf, and a crown of hanging
// monitors on a steel frame. Authored at H = 1; the scene scales it.

type Kit = ReturnType<typeof makeGeometry>;
const tau = Math.PI * 2;

// A faceted ring of `sides` flat facets, facet k centred on bearing
// phase + k·2π/sides (x = sin, z = cos). Each facet face is its own surface,
// so the outline draws the seams between stations.
const facetedRing = (
  sides: number,
  outerApothem: number,
  innerApothem: number,
  bottom: number,
  top: number,
  phase: number,
  faces: { readonly outer: boolean; readonly inner: boolean; readonly seams?: boolean } = { outer: true, inner: true },
) => {
  // Without seams the whole ring is one surface: a plinth reads as one floor.
  const seams = faces.seams ?? true;
  const positions: Array<number> = [];
  const geometry = new THREE.BufferGeometry();
  const corner = (apothem: number, angle: number, y: number): Point => {
    const radius = apothem / Math.cos(Math.PI / sides);
    return [Math.sin(angle) * radius, y, Math.cos(angle) * radius];
  };
  const quad = (a: Point, b: Point, c: Point, d: Point) => {
    const first = positions.length / 3;
    // Corners run clockwise seen from outside; triangles wind counter-clockwise.
    positions.push(...a, ...c, ...b, ...a, ...d, ...c);
    if (seams) geometry.addGroup(first, 6, 0);
  };
  for (let side = 0; side < sides; side++) {
    const centre = phase + side * tau / sides;
    const left = centre - Math.PI / sides, right = centre + Math.PI / sides;
    const ob = (angle: number) => corner(outerApothem, angle, bottom),
      ot = (angle: number) => corner(outerApothem, angle, top);
    const ib = (angle: number) => corner(innerApothem, angle, bottom),
      it = (angle: number) => corner(innerApothem, angle, top);
    quad(it(left), it(right), ot(right), ot(left));
    if (faces.outer) quad(ob(left), ot(left), ot(right), ob(right));
    if (faces.inner && innerApothem > 0) quad(ib(right), it(right), it(left), ib(left));
  }
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
};

// A small deterministic spread for clutter, so every viewer draws the same post.
const jitter = (seed: number) => {
  let state = seed * 2654435761 >>> 0;
  return () => {
    state = Math.imul(state ^ state >>> 15, 2246822519) >>> 0;
    state = Math.imul(state ^ state >>> 13, 3266489917) >>> 0;
    return ((state ^ state >>> 16) >>> 0) / 4294967296;
  };
};

const binderColors: ReadonlyArray<PaletteName> = [
  "jacket-navy-0",
  "jacket-crimson-0",
  "jacket-kelly-0",
  "jacket-mustard-0",
  "plastic-0",
  "jacket-slate-0",
];

// A CRT monitor on its swivel: beige casing, screen toward +Z. `light` marks
// the face the shader lights (1 a desk screen, the post decides crowns).
const crt = (kit: Kit, at: Point, yaw: number, pitch: number, size: number, casing: PaletteName) => {
  const place = (geometry: THREE.BufferGeometry) =>
    geometry.rotateX(-pitch).rotateY(yaw).translate(at[0], at[1], at[2]);
  const w = .21 * size, h = .17 * size, d = .2 * size;
  kit.add(place(box(w, h, d * .55, [0, 0, d * .2])), casing);
  kit.add(place(box(w * .78, h * .76, d * .5, [0, -h * .02, -d * .3])), casing);
  kit.add(place(box(w * .8, h * .74, .006, [0, h * .02, d * .48 + .003])), "glass-0", 1);
};

// The post body: plinth, counter, inner shelf and cabinet, pole and crown.
export const makeLivePost = (stations: number, monitors: number) => {
  const kit = makeGeometry();
  const { counterEdge, worktop, depth, overhang, plinth } = postLayout;
  // Facet k faces the station on bearing π/2 + k·2π/n, as the canonical rings
  // place stations; any one facet phase serves every post.
  const phase = Math.PI / 2;
  const inner = counterEdge - depth;
  kit.add(
    facetedRing(stations, plinth, 0, 0, postLayout.plinthHeight, phase, { outer: true, inner: false, seams: false }),
    "timber-1",
  );
  kit.add(facetedRing(stations, counterEdge, inner, worktop - .035, worktop, phase), "timber-2");
  kit.add(
    facetedRing(stations, counterEdge - overhang, counterEdge - overhang - .05, .07, worktop - .035, phase),
    "timber-0",
  );
  kit.add(
    facetedRing(stations, counterEdge - overhang + .012, counterEdge - overhang - .05, .022, .07, phase),
    "steel-0",
  );
  // The inner shelf, a step up behind the screens, and the binders on it.
  kit.add(
    facetedRing(stations, inner + .02, inner - .17, .022, worktop + .12, phase, {
      outer: true,
      inner: true,
      seams: false,
    }),
    "timber-0",
  );
  const random = jitter(stations * 31 + monitors);
  for (let side = 0; side < stations; side++) {
    const centre = phase + side * tau / stations;
    let along = -.12 + random() * .04;
    while (along < .1) {
      const width = .022 + random() * .02, height = .09 + random() * .05;
      const lean = random() < .2 ? (random() - .5) * .5 : 0;
      const at = inner - .08;
      kit.add(
        box(width, height, .085, [0, height / 2, 0]).rotateZ(lean).rotateY(centre).translate(
          Math.sin(centre) * at + Math.cos(centre) * along,
          worktop + .12,
          Math.cos(centre) * at - Math.sin(centre) * along,
        ),
        binderColors[Math.floor(random() * binderColors.length)] ?? "plastic-0",
      );
      along += width + .004 + (random() < .15 ? .04 : 0);
    }
  }
  kit.add(facetedRing(stations, .3, 0, .022, .64, phase, { outer: true, inner: false, seams: false }), "timber-1");
  kit.add(cylinder(.045, 1.1, [0, 1.19, 0], 10), "steel-1");
  // The crown: a tight cluster of monitors hung in two tiers from a small
  // steel frame on the pole, screens tilted down toward the traders.
  const frameY = 1.92;
  kit.add(cylinder(.035, .45, [0, frameY + .1, 0], 8), "steel-1");
  kit.add(facetedRing(monitors, .3, .27, frameY - .02, frameY + .02, 0), "steel-1");
  for (let index = 0; index < monitors; index++) {
    const angle = index * tau / monitors + .2;
    const low = index % 2 === 1;
    const reach = low ? .27 : .34, y = low ? 1.4 : 1.64;
    kit.add(box(.012, frameY - y - .1, .012, [0, (frameY + y + .1) / 2, .28]).rotateY(angle), "steel-1");
    crt(
      kit,
      [Math.sin(angle) * reach, y, Math.cos(angle) * reach],
      angle,
      .3,
      1.3,
      index % 3 === 0 ? "steel-2" : "plastic-0",
    );
  }
  const root = new THREE.Group();
  root.add(kit.finish("live_post_body"));
  return root;
};

export const liveStationVariants = 4;

// One station: origin on the floor below the middle of its counter facet's
// outer edge, +Z toward its trader. Worktop things, then the stool and floor
// things on the trader's side.
export const makeLiveStation = (variant: number, stations: number) => {
  const kit = makeGeometry();
  const random = jitter(variant * 977 + 13);
  const { worktop, depth, counterEdge } = postLayout;
  const half = counterEdge * Math.tan(Math.PI / stations) - .03;
  // The facet narrows toward the post: the farthest a thing `width` wide can
  // sit from the station's centre line at depth `z`.
  const reach = (z: number, width: number) => (counterEdge + z) * Math.tan(Math.PI / stations) - .02 - width / 2;
  const top = worktop;
  const mirror = variant % 2 === 0 ? 1 : -1;
  // The screen sits back on the worktop, angled toward its trader.
  crt(kit, [mirror * .03, top + .1, -depth + .14], mirror * -.08, .06, 1, variant === 2 ? "steel-2" : "plastic-0");
  kit.add(box(.08, .02, .08, [mirror * .03, top + .01, -depth + .15]), "plastic-0");
  kit.add(box(.17, .014, .06, [mirror * -.01, top + .007, -.1]).rotateY(mirror * .05), "plastic-0");
  // Phone and its handset.
  const phoneX = mirror * -Math.min(.19, reach(-.2, .09));
  kit.add(box(.075, .032, .09, [phoneX, top + .016, -.15]), "shoe-0");
  kit.add(box(.085, .022, .026, [phoneX, top + .043, -.175]), "shoe-0");
  // Papers: a stack and a few loose slips, different at every variant.
  const stackX = mirror * Math.min(.17, reach(-.26, .12));
  const sheets = 2 + Math.floor(random() * 4);
  kit.add(box(.075, .006 * sheets, .095, [stackX, top + .003 * sheets, -.2]).rotateY(random() * .3 - .15), "paper-0");
  for (let slip = 0; slip < 3; slip++) {
    const z = -.03 - random() * .12, x = (random() - .5) * 2 * reach(z, .1);
    kit.add(
      box(.06, .002, .08, [0, 0, 0]).rotateY(random() * Math.PI).translate(x, top + .002 + slip * .001, z),
      "paper-0",
    );
  }
  if (variant === 0 || variant === 3) {
    // A desk lamp leaning over the papers.
    const lampX = mirror * -reach(-.34, .09);
    kit.add(cylinder(.035, .012, [lampX, top + .006, -.3], 8), "steel-0");
    kit.add(box(.01, .2, .01, [lampX, top + .1, -.3]).rotateX(.25), "steel-0");
    kit.add(box(.012, .012, .14, [lampX, top + .2, -.24]), "steel-0");
    kit.add(new THREE.ConeGeometry(.045, .06, 8, 1, true).translate(lampX, top + .17, -.17), "steel-0");
    kit.add(cylinder(.04, .004, [lampX, top + .14, -.17], 8), "glass-0", 2);
  }
  if (variant === 1 || variant === 3) {
    // A ticker-tape machine, its tape curling over the counter edge.
    const tapeX = mirror * reach(-.34, .1);
    kit.add(box(.09, .07, .08, [tapeX, top + .035, -.3]), "steel-1");
    kit.add(box(.04, .002, .2, [tapeX, top + .072, -.17]), "paper-0");
    kit.add(box(.04, .12, .002, [tapeX, top - .06, .002]), "paper-0");
  }
  if (variant === 2) {
    kit.add(cylinder(.018, .04, [mirror * -.05, top + .02, -.04], 8), "paper-0");
    kit.add(box(.1, .05, .12, [mirror * reach(-.34, .14), top + .025, -.28]), "steel-1");
  }
  // The stool: a dark seat at the seated hip, a column, a foot ring and base.
  const stoolZ = traderReach.seated - .03;
  const floor = postLayout.plinthHeight;
  kit.add(cylinder(.085, .03, [0, floor + seating.seat - .015, stoolZ], 10), "shoe-0");
  kit.add(cylinder(.013, seating.seat - .05, [0, floor + (seating.seat - .03) / 2 + .01, stoolZ], 6), "steel-1");
  kit.add(
    new THREE.TorusGeometry(.085, .007, 4, 10).rotateX(Math.PI / 2).translate(0, floor + seating.footRing, stoolZ),
    "steel-1",
  );
  for (let leg = 0; leg < 4; leg++) {
    const angle = leg * tau / 4 + .4;
    kit.add(box(.012, .012, .12, [0, .008, .06]).rotateY(angle).translate(0, floor, stoolZ), "steel-1");
  }
  if (variant !== 1) {
    // A waste bin beside the stool, overflowing with screwed-up slips.
    const binX = mirror * (half - .07), binZ = .2;
    kit.add(new THREE.CylinderGeometry(.06, .05, .15, 9, 1, true).translate(binX, floor + .075, binZ), "steel-0");
    kit.add(cylinder(.05, .004, [binX, floor + .002, binZ], 9), "steel-0");
    for (let ball = 0; ball < 3; ball++) {
      kit.add(
        new THREE.IcosahedronGeometry(.026, 0).translate(
          binX + (random() - .5) * .05,
          floor + .15 + random() * .02,
          binZ + (random() - .5) * .05,
        ),
        "paper-0",
      );
    }
  }
  // Order slips dropped on the floor round the stool.
  for (let slip = 0; slip < 3; slip++) {
    const angle = random() * tau, distance = .18 + random() * .25;
    kit.add(
      box(.06, .002, .08, [0, 0, 0]).rotateY(random() * Math.PI).translate(
        Math.max(-half + .06, Math.min(half - .06, Math.sin(angle) * distance * .8)),
        floor + .002 + slip * .0005,
        stoolZ + .1 + Math.cos(angle) * distance,
      ),
      "paper-0",
    );
  }
  const root = new THREE.Group();
  root.add(kit.finish(`live_station_${variant}`));
  return root;
};
