import type { PaletteName } from "@floor/atlas/materials";
import * as THREE from "three";

// The rooms around the posts, after the picked floor and agents-at-work
// frames: the wall of screens on its rostrum with the bell and the podium, the
// file room's cabinets and the board of pinned cards at the named places, and
// along every wall the clutter of a working floor (filing cabinets, coat racks
// hung with jackets, plants, a water cooler, boxes, clocks, notice boards and
// doors), with order slips trodden into the timber. Authored at H = 1 in a
// local frame whose +Z points away from the wall, into the room.

export type Paint = (geometry: THREE.BufferGeometry, material: PaletteName) => void;

// A small deterministic spread, so every viewer furnishes a room the same way.
export const seeded = (seed: number) => {
  let state = (Math.imul(seed, 2654435761) ^ 0x5bd1e995) >>> 0;
  return () => {
    state = Math.imul(state ^ state >>> 15, 2246822519) >>> 0;
    state = Math.imul(state ^ state >>> 13, 3266489917) >>> 0;
    return ((state ^ state >>> 16) >>> 0) / 4294967296;
  };
};

const block = (w: number, h: number, d: number, x: number, y: number, z: number) =>
  new THREE.BoxGeometry(w, h, d).translate(x, y, z);
const post = (r: number, h: number, x: number, y: number, z: number, segments = 8) =>
  new THREE.CylinderGeometry(r, r, h, segments).translate(x, y, z);

const jacketPaints: ReadonlyArray<PaletteName> = [
  "jacket-navy-0",
  "jacket-crimson-0",
  "jacket-kelly-0",
  "jacket-mustard-0",
  "jacket-slate-0",
  "jacket-camel-0",
  "jacket-maroon-0",
];

// A bank of steel filing cabinets, drawers outlined, papers on top.
const cabinets = (paint: Paint, count: number, random: () => number) => {
  for (let index = 0; index < count; index++) {
    const x = (index - (count - 1) / 2) * .33;
    paint(block(.31, .62, .3, x, .31, .15), "steel-2");
    for (let drawer = 0; drawer < 4; drawer++) {
      paint(block(.27, .12, .012, x, .08 + drawer * .145, .305), "steel-3");
      paint(block(.06, .015, .02, x, .115 + drawer * .145, .315), "steel-0");
    }
    if (random() < .5) {
      paint(block(.2, .02 + random() * .04, .22, 0, 0, 0).rotateY(random() - .5).translate(x, .64, .15), "paper-0");
    }
  }
  return count * .33;
};

const coatRack = (paint: Paint, random: () => number) => {
  paint(post(.012, 1.05, 0, .525, .14), "steel-1");
  paint(post(.09, .02, 0, .01, .14, 8), "steel-1");
  paint(post(.06, .015, 0, 1.03, .14, 8), "steel-1");
  const coats = 1 + Math.floor(random() * 3);
  for (let coat = 0; coat < coats; coat++) {
    const angle = coat * 2.1 + random() * .5;
    const jacket = jacketPaints[Math.floor(random() * jacketPaints.length)] ?? "jacket-navy-0";
    // A jacket hangs by its collar: shoulders at the hook, the body below.
    const hang = (geometry: THREE.BufferGeometry) => geometry.rotateY(angle).translate(0, 0, .14);
    paint(hang(new THREE.CylinderGeometry(.075, .1, .44, 6, 1).scale(1, 1, .45).translate(0, .78, .085)), jacket);
    paint(hang(block(.07, .03, .03, 0, 1.0, .06)), jacket);
  }
  return .35;
};

const plant = (paint: Paint, random: () => number) => {
  paint(new THREE.CylinderGeometry(.11, .08, .18, 9).translate(0, .09, .16), "timber-0");
  for (let leaf = 0; leaf < 7; leaf++) {
    const angle = leaf * 2.4 + random(), tilt = .2 + random() * .25;
    paint(
      new THREE.SphereGeometry(1, 6, 4).scale(.05, .2, .1).rotateX(tilt).rotateY(angle)
        .translate(Math.sin(angle) * .07, .32 + random() * .12, .16 + Math.cos(angle) * .07),
      leaf % 2 === 0 ? "jacket-forest-0" : "jacket-kelly-0",
    );
  }
  return .4;
};

const cooler = (paint: Paint) => {
  paint(block(.18, .42, .18, 0, .21, .14), "steel-3");
  paint(post(.075, .22, 0, .53, .14, 10), "glass-3");
  paint(block(.05, .03, .03, 0, .32, .24), "steel-0");
  return .3;
};

const boxes = (paint: Paint, random: () => number) => {
  let y = 0;
  const count = 1 + Math.floor(random() * 3);
  for (let box = 0; box < count; box++) {
    const w = .26 + random() * .12, h = .16 + random() * .08;
    paint(
      block(w, h, .26, 0, 0, 0).rotateY((random() - .5) * .3).translate((random() - .5) * .08, y + h / 2, .15),
      "jacket-camel-0",
    );
    y += h;
  }
  return .45;
};

const bench = (paint: Paint) => {
  paint(block(.9, .04, .24, 0, .25, .16), "timber-2");
  for (const side of [-1, 1]) paint(block(.04, .23, .2, side * .4, .115, .16), "steel-1");
  return 1;
};

// Wall-mounted things, hung at their height on the wall face.
const clock = (paint: Paint) => {
  paint(post(.11, .03, 0, 0, 0, 16).rotateX(Math.PI / 2).translate(0, 1.15, .015), "steel-1");
  paint(post(.095, .006, 0, 0, 0, 16).rotateX(Math.PI / 2).translate(0, 1.15, .032), "paper-0");
  // Hands pivot at the centre: ten past ten.
  paint(block(.01, .07, .006, 0, .035, 0).rotateZ(.95).translate(0, 1.15, .037), "shoe-0");
  paint(block(.01, .05, .006, 0, .025, 0).rotateZ(-.95).translate(0, 1.15, .039), "shoe-0");
};
const noticeBoard = (paint: Paint, random: () => number) => {
  paint(block(.62, .42, .03, 0, .95, .015), "timber-0");
  paint(block(.56, .36, .01, 0, .95, .035), "jacket-camel-0");
  for (let card = 0; card < 7; card++) {
    paint(
      block(.09, .07, .004, 0, 0, 0).rotateZ((random() - .5) * .3).translate(
        (random() - .5) * .45,
        .95 + (random() - .5) * .26,
        .042,
      ),
      random() < .3 ? "jacket-mustard-0" : "paper-0",
    );
  }
};
const door = (paint: Paint) => {
  paint(block(.52, .98, .03, 0, .49, .015), "timber-0");
  paint(block(.44, .92, .02, 0, .47, .035), "timber-1");
  for (const y of [.25, .7]) paint(block(.34, .3, .01, 0, y, .048), "timber-2");
  paint(post(.018, .04, 0, 0, 0, 6).rotateX(Math.PI / 2).translate(.17, .48, .06), "steel-1");
};

export type WallThing = "cabinets" | "coatRack" | "plant" | "cooler" | "boxes" | "bench" | "gap";
export type HungThing = "clock" | "noticeBoard" | "door" | "none";
const floorChoices = {
  room: [["cabinets", 3], ["coatRack", 1], ["plant", 1.5], ["cooler", .7], ["boxes", 1.5], ["gap", 3]],
  lobby: [["bench", 3], ["plant", 2], ["gap", 4]],
} as const satisfies Record<string, ReadonlyArray<readonly [WallThing, number]>>;
const hungChoices = {
  room: [["clock", 1], ["noticeBoard", 2], ["door", 1.2], ["none", 4]],
  lobby: [["clock", .6], ["door", 1], ["none", 4]],
} as const satisfies Record<string, ReadonlyArray<readonly [HungThing, number]>>;

// What each choice builds, so a wall run is only its spacing rules.
const standing: Record<Exclude<WallThing, "gap">, (paint: Paint, count: number, random: () => number) => void> = {
  cabinets: (paint, count, random) => cabinets(paint, count, random),
  coatRack: (paint, _count, random) => coatRack(paint, random),
  plant: (paint, _count, random) => plant(paint, random),
  cooler: paint => cooler(paint),
  boxes: (paint, _count, random) => boxes(paint, random),
  bench: paint => bench(paint),
};
const hanging: Record<Exclude<HungThing, "none">, (paint: Paint, random: () => number) => void> = {
  clock: paint => clock(paint),
  noticeBoard: (paint, random) => noticeBoard(paint, random),
  door: paint => door(paint),
};

const pick = <A>(random: () => number, choices: ReadonlyArray<readonly [A, number]>, fallback: A) => {
  const total = choices.reduce((sum, [, weight]) => sum + weight, 0);
  let left = random() * total;
  for (const [value, weight] of choices) {
    left -= weight;
    if (left <= 0) return value;
  }
  return fallback;
};

// Furnishes one wall run of `length` H: things stand on the floor along it,
// others hang on it. `clear` says whether a span (centre and half-width along
// the run, in H) is free of posts, places and doors. Each placement reports
// where along the run it went, for the caller to transform.
export const furnishWall = (
  length: number,
  kind: "room" | "lobby",
  random: () => number,
  clear: (along: number, half: number) => boolean,
  floor: (along: number, build: (paint: Paint) => void) => void,
  wall: (along: number, build: (paint: Paint) => void) => void,
) => {
  let along = .4 + random() * .6;
  while (along < length - .4) {
    const thing = pick(random, floorChoices[kind], "gap");
    const width = thing === "cabinets" ? .33 * (2 + Math.floor(random() * 3)) : thing === "bench" ? 1 : .45;
    const centre = along + width / 2;
    if (thing !== "gap" && centre + width / 2 < length - .2 && clear(centre, width / 2 + .1)) {
      const count = Math.round(width / .33);
      floor(centre, paint => standing[thing](paint, count, random));
    }
    along += width + .25 + random() * 1.1;
  }
  hangOnWall(length, kind, random, clear, wall);
};
const hangOnWall = (
  length: number,
  kind: "room" | "lobby",
  random: () => number,
  clear: (along: number, half: number) => boolean,
  wall: (along: number, build: (paint: Paint) => void) => void,
) => {
  let hung = .8 + random() * 1.2;
  while (hung < length - .6) {
    const thing = pick(random, hungChoices[kind], "none");
    if (thing !== "none" && clear(hung, .4)) wall(hung, paint => hanging[thing](paint, random));
    hung += 1.4 + random() * 2.2;
  }
};

// The exchange's long ticker band, high on a wall: a dark glass strip in a
// steel frame. It shows no readings; none are fabricated.
export const tickerBand = (paint: Paint, length: number) => {
  paint(block(length, .14, .04, 0, 1.24, .02), "steel-0");
  paint(block(length - .04, .09, .012, 0, 1.24, .045), "glass-0");
};

// Order slips littered over a room's floor, `density` per square H.
export const litter = (paint: Paint, width: number, depth: number, density: number, random: () => number) => {
  const count = Math.round(width * depth * density);
  for (let slip = 0; slip < count; slip++) {
    const x = (random() - .5) * width, z = (random() - .5) * depth;
    const crumpled = random() < .12;
    paint(
      crumpled
        ? new THREE.IcosahedronGeometry(.022, 0).translate(x, .02, z)
        : new THREE.PlaneGeometry(.06, .08).rotateX(-Math.PI / 2).rotateY(random() * Math.PI).translate(x, .002, z),
      "paper-0",
    );
  }
};

// The named places, each filling its reservation with its back to the wall.
// `width` and `depth` are the reservation in H; the agent stands in front.
type Place = "wallOfScreens" | "bell" | "podium" | "fileRoom" | "board";
type Furnish = (paint: Paint, width: number, depth: number, random: () => number) => void;
const places: Record<Place, Furnish> = {
  // A raised rostrum with a rail, and a bank of screens on the wall above.
  wallOfScreens: (paint, width, depth) => {
    const back = -depth / 2 + .04, span = Math.max(.6, width - .1);
    paint(block(span, .1, depth * .45, 0, .05, back + depth * .225), "timber-1");
    paint(block(span, .08, .04, 0, .5, back + depth * .45), "timber-0");
    for (const x of [-span / 2 + .03, 0, span / 2 - .03]) {
      paint(post(.015, .4, x, .3, back + depth * .45, 6), "timber-0");
    }
    const columns = Math.max(2, Math.floor(span / .5)), cell = span / columns;
    paint(block(span, .82, .06, 0, 1.04, back - .01), "steel-0");
    for (let column = 0; column < columns; column++) {
      for (let row = 0; row < 2; row++) {
        const x = (column - (columns - 1) / 2) * cell, y = .82 + row * .42;
        paint(block(cell - .06, .34, .03, x, y, back + .03), "steel-1");
        paint(block(cell - .1, .28, .006, x, y, back + .047), "glass-0");
      }
    }
  },
  // The bell on its stand by the rostrum: brass, a steel bracket and a rope.
  bell: (paint, _width, depth) => {
    const z = -depth / 2 + .16;
    paint(block(.3, .06, .3, 0, .03, z), "timber-0");
    paint(post(.02, .95, -.06, .5, z, 6), "steel-1");
    paint(block(.16, .02, .02, .0, .97, z), "steel-1");
    paint(new THREE.CylinderGeometry(.04, .09, .12, 12, 1, true).translate(.06, .88, z), "brass-0");
    paint(new THREE.SphereGeometry(.04, 10, 4, 0, Math.PI * 2, 0, Math.PI / 2).translate(.06, .94, z), "brass-0");
    paint(post(.006, .4, .06, .62, z, 4), "jacket-crimson-0");
  },
  podium: (paint, _width, depth) => {
    const z = -depth / 2 + .2;
    paint(block(.5, .06, .36, 0, .03, z), "timber-0");
    paint(block(.36, .6, .24, 0, .36, z), "timber-1");
    paint(block(.42, .04, .3, 0, 0, 0).rotateX(-.2).translate(0, .68, z + .02), "timber-0");
    paint(post(.008, .22, 0, 0, 0, 4).rotateX(.4).translate(.1, .8, z + .06), "steel-1");
    paint(new THREE.SphereGeometry(.02, 6, 4).translate(.1, .9, z + .1), "shoe-0");
  },
  fileRoom: (paint, width, depth, random) => {
    const back = -depth / 2 + .04;
    cabinets(
      (geometry, material) => paint(geometry.translate(0, 0, back), material),
      Math.max(2, Math.floor((width - .1) / .33)),
      random,
    );
  },
  // The board of pinned cards on two legs, a tray of markers below.
  board: (paint, width, depth, random) => {
    const span = Math.min(width - .2, 1.1), z = -depth / 2 + .1;
    for (const side of [-1, 1]) paint(block(.03, 1.1, .03, side * (span / 2 - .02), .55, z), "steel-1");
    paint(block(span, .62, .03, 0, .82, z), "steel-1");
    paint(block(span - .05, .57, .01, 0, .82, z + .02), "paper-0");
    paint(block(span - .1, .02, .05, 0, .5, z + .03), "steel-1");
    for (let card = 0; card < 14; card++) {
      paint(
        block(.08, .06, .004, 0, 0, 0).rotateZ((random() - .5) * .25).translate(
          (random() - .5) * (span - .15),
          .82 + (random() - .5) * .45,
          z + .028,
        ),
        random() < .35 ? "jacket-mustard-0" : random() < .5 ? "shirt-blue-0" : "paper-0",
      );
    }
  },
};
export const furnishPlace = (paint: Paint, place: Place, width: number, depth: number, random: () => number) =>
  places[place](paint, width, depth, random);
