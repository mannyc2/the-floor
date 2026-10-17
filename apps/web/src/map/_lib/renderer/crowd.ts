import { type FigureColor, PaletteName } from "@floor/atlas/materials";
import { Option } from "effect";
import * as THREE from "three";
import { clipIndex, type ClipName, clips, cyclesPerUnit } from "../assets/rig";
import { hairStyles } from "../assets/trader";
import { postLayout, traderKinds, traderPlaces, traderReach, traderStates } from "../live-layout";
import type { Flights } from "./flights";

// The crowd: what each trader on the floor is doing from moment to moment.
// The world says where an agent is and what state it reports; the crowd
// decides how that looks. A move walks the figure there around the posts; at
// its desk it settles into work its state calls for (typing, reading, on the
// phone, bidding, asleep), changing activity every few seconds. Nothing here
// invents a location or a state: an agent with no reported state only works.

export interface CrowdTarget {
  readonly id: number;
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  readonly kind: number;
  readonly state: number;
  readonly place: number;
  readonly seed: number;
}
interface Point {
  readonly x: number;
  readonly z: number;
}

const seatedClips = new Set<ClipName>(["type", "phone", "read", "lean", "asleep"]);
// Activities at the desk that stand to work the counter.
const counterClips = new Set<ClipName>(["counter", "bid", "call", "cheer"]);
type Pool = ReadonlyArray<readonly [ClipName, number]>;
const working: Pool = [["type", 4], ["read", 2], ["phone", 2], ["lean", 1], ["counter", .7]];
const seatPools: Record<(typeof traderStates)[number], Pool> = {
  unreported: working,
  working,
  launching: working,
  building: working,
  trading: [["bid", 3], ["phone", 2], ["call", 2], ["type", 2], ["counter", 1], ["cheer", .4]],
  researching: [["type", 3], ["read", 3], ["phone", 1], ["lean", .6], ["counter", .6]],
  talking: [["phone", 4], ["call", 2]],
  asleep: [["asleep", 1]],
  waitingForOwner: [["lean", 3], ["slump", 1], ["coffee", 1]],
  idle: [["lean", 2], ["coffee", 2], ["idle", 1.5], ["read", 1], ["counter", 1], ["throw", .5]],
};
const placePools: Record<(typeof traderPlaces)[number], Pool> = {
  wallOfScreens: [["idle", 2], ["talk", 1], ["coffee", 1]],
  bell: [["ring", 1]],
  podium: [["talk", 1]],
  fileRoom: [["pin", 1], ["idle", 1]],
  board: [["pin", 1]],
};
const pool = (target: CrowdTarget): Pool => {
  const kind = traderKinds[target.kind] ?? "seat";
  const state = traderStates[target.state] ?? "unreported";
  if (kind === "seat") return seatPools[state];
  if (kind === "visit") return [["talk", 3], ["idle", 1], ["call", 1], ["coffee", .5]];
  if (kind === "post") {
    return state === "trading"
      ? [["bid", 3], ["talk", 2], ["call", 1]]
      : [["talk", 3], ["call", 2], ["idle", 1], ["coffee", 1], ["throw", .6]];
  }
  if (kind === "place") return placePools[traderPlaces[target.place] ?? "wallOfScreens"];
  return [["idle", 2], ["coffee", 1], ["talk", 1], ["call", 1]];
};

// A small deterministic generator per trader, so a viewer that reloads sees
// the same people; their moment-to-moment choices only need variety.
const generator = (seed: number) => {
  let state = (seed ^ 0x9e3779b9) >>> 0;
  return () => {
    state = Math.imul(state ^ state >>> 16, 2246822519) >>> 0;
    state = Math.imul(state ^ state >>> 13, 3266489917) >>> 0;
    state = (state ^ state >>> 16) >>> 0;
    return state / 4294967296;
  };
};
const weighted = <A>(random: () => number, choices: ReadonlyArray<readonly [A, number]>, fallback: A) => {
  const total = choices.reduce((sum, [, weight]) => sum + weight, 0);
  let pick = random() * total;
  for (const [value, weight] of choices) {
    pick -= weight;
    if (pick <= 0) return value;
  }
  return fallback;
};

const slotOf = (name: FigureColor) => PaletteName.literals.indexOf(name);
const looks = {
  jacket: [
    ["jacket-navy-0", 4],
    ["jacket-slate-0", 2],
    ["jacket-royal-0", 2],
    ["jacket-crimson-0", 1.5],
    ["jacket-kelly-0", 1.5],
    ["jacket-mustard-0", 1],
    ["jacket-sky-0", 1.2],
    ["jacket-forest-0", 1.2],
    ["jacket-maroon-0", 1.2],
    ["jacket-olive-0", .8],
    ["jacket-camel-0", .8],
  ],
  shirt: [["shirt-white-0", 4], ["shirt-blue-0", 1]],
  tie: [["tie-crimson-0", 3], ["tie-navy-0", 2], ["tie-gold-0", 1], ["tie-green-0", 1]],
  trousers: [
    ["trousers-charcoal-0", 4],
    ["trousers-grey-0", 2],
    ["trousers-navy-0", 2],
    ["trousers-brown-0", 1.5],
    ["trousers-khaki-0", 1],
  ],
  skin: [
    ["skin-pale-0", 2],
    ["skin-fair-0", 2],
    ["skin-tan-0", 2],
    ["skin-brown-0", 1.5],
    ["skin-umber-0", 1.5],
    ["skin-deep-0", 1],
  ],
  hair: [
    ["hair-black-0", 3],
    ["hair-dark-0", 3],
    ["hair-brown-0", 2],
    ["hair-auburn-0", 1],
    ["hair-grey-0", 1.5],
    ["hair-blond-0", 1],
  ],
} as const satisfies Record<string, ReadonlyArray<readonly [FigureColor, number]>>;
const styleWeights: ReadonlyArray<readonly [number, number]> = hairStyles.map((_style, index) => [
  index + 1,
  [3, 2, 1.5, 1.2, 1.2][index] ?? 1,
]);

// One trader's appearance from its agent's seed: colours as palette slots in
// the shader's pairs, hair style and outfit, and its build.
export const lookOf = (seed: number) => {
  const random = generator(seed * 7919 + 17);
  const pick = (choices: ReadonlyArray<readonly [FigureColor, number]>) =>
    slotOf(weighted(random, choices, choices[0]?.[0] ?? "jacket-navy-0"));
  const jacket = pick(looks.jacket), trousers = pick(looks.trousers);
  const skin = pick(looks.skin);
  const style = weighted(random, styleWeights, 1);
  const hair = pick(looks.hair);
  const shirt = pick(looks.shirt), tie = pick(looks.tie);
  const outfit = random() < .18 ? 1 : 0;
  return {
    look: [jacket + 256 * trousers, skin + 256 * hair, shirt + 256 * tie, style + 16 * outfit] as const,
    // Heights vary little: the furniture does not scale, and a short trader's
    // arms would sink into the worktop.
    width: .92 + random() * .18,
    height: .97 + random() * .07,
  };
};

interface Trader {
  present: boolean;
  target: Option.Option<CrowdTarget>;
  x: number;
  z: number;
  yaw: number;
  // Waypoints still to walk; empty when settled.
  path: Array<Point>;
  gait: "walk" | "hurry";
  clip: ClipName;
  // Where a settled trader's root belongs for its current activity, and the
  // root's position when the activity began, so it eases between them.
  anchor: Point;
  from: Point;
  shiftStart: number;
  nextChoice: number;
  random: () => number;
  width: number;
  height: number;
}

// A broader build is mostly wider shoulders; deepening a seated trader as
// much would push its knees through the counter's panel.
export const depthOf = (width: number) => 1 + (width - 1) * .4;

const speeds = { walk: .8, hurry: 1.55 } as const;
// Where in the throw clip's loop the plane leaves the hand.
const throwRelease = .41;
// Far moves hurry; nobody strolls across a whole floor.
const hurryBeyond = 6;
const turnRate = 7;
const shiftSeconds = .5;

const wrapAngle = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));

const forward = (yaw: number): Point => ({ x: Math.sin(yaw), z: Math.cos(yaw) });

// The first post whose clearance circle the straight segment a→b enters.
const blocking = (a: Point, b: Point, posts: ReadonlyArray<Point>, radius: number) => {
  const dx = b.x - a.x, dz = b.z - a.z, length2 = dx * dx + dz * dz;
  return posts.reduce<Option.Option<{ readonly post: Point; readonly along: number; readonly closest: Point }>>(
    (nearest, post) => {
      const along = length2 > 0 ? ((post.x - a.x) * dx + (post.z - a.z) * dz) / length2 : 0;
      if (along <= 0 || along >= 1) return nearest;
      const closest = { x: a.x + dx * along, z: a.z + dz * along };
      if (Math.hypot(closest.x - post.x, closest.z - post.z) >= radius) return nearest;
      return Option.isSome(nearest) && nearest.value.along <= along ? nearest : Option.some({ post, along, closest });
    },
    Option.none(),
  );
};

// A route from `from` to `to` that bends around posts. Endpoints inside a
// post's plinth (a desk, a visitor's spot) leave and arrive radially.
export const route = (from: Point, to: Point, posts: ReadonlyArray<Point>, radius: number): Array<Point> => {
  const containing = (point: Point) =>
    Option.fromUndefinedOr(posts.find(post => Math.hypot(point.x - post.x, point.z - post.z) < radius));
  const outward = (point: Point, post: Point): Point => {
    const dx = point.x - post.x, dz = point.z - post.z, length = Math.hypot(dx, dz) || 1;
    return { x: post.x + dx / length * (radius + .02), z: post.z + dz / length * (radius + .02) };
  };
  const start = Option.match(containing(from), { onNone: () => from, onSome: post => outward(from, post) });
  const end = Option.match(containing(to), { onNone: () => to, onSome: post => outward(to, post) });
  const detour = (a: Point, b: Point, depth: number): Array<Point> =>
    Option.match(depth > 6 ? Option.none() : blocking(a, b, posts, radius), {
      onNone: () => [b],
      onSome: ({ post, closest }) => {
        const ox = closest.x - post.x, oz = closest.z - post.z, offset = Math.hypot(ox, oz);
        const dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz) || 1;
        // Pass on the side the straight line was already leaning toward.
        const [nx, nz] = offset > 1e-6 ? [ox / offset, oz / offset] : [-dz / length, dx / length];
        const around = { x: post.x + nx * radius * 1.12, z: post.z + nz * radius * 1.12 };
        return [...detour(a, around, depth + 1), ...detour(around, b, depth + 1)];
      },
    });
  return [...(start === from ? [] : [start]), ...detour(start, end, 0), ...(end === to ? [] : [to])];
};

export const makeCrowd = (
  mesh: THREE.InstancedMesh,
  unitsPerH: number,
  // The desk identity of instance zero.
  firstId: number,
  flights: Option.Option<Flights> = Option.none(),
) => {
  const count = mesh.count;
  const animA = mesh.geometry.getAttribute("_ANIM_A");
  const animB = mesh.geometry.getAttribute("_ANIM_B");
  const lookAttribute = mesh.geometry.getAttribute("_LOOK");
  if (
    !(animA instanceof THREE.InstancedBufferAttribute) || !(animB instanceof THREE.InstancedBufferAttribute)
    || !(lookAttribute instanceof THREE.InstancedBufferAttribute)
  ) return Option.none();
  const traders: Array<Trader> = Array.from({ length: count }, () => ({
    present: false,
    target: Option.none(),
    x: 0,
    z: 0,
    yaw: 0,
    path: [],
    gait: "walk",
    clip: "idle",
    anchor: { x: 0, z: 0 },
    from: { x: 0, z: 0 },
    shiftStart: -10,
    nextChoice: 0,
    random: generator(0),
    width: 1,
    height: 1,
  }));
  const state = { posts: new Array<Point>(), time: 0 };
  const obstacle = (postLayout.plinth + .12) * unitsPerH;
  const matrix = new THREE.Matrix4(), rotation = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  const position = new THREE.Vector3(), scale = new THREE.Vector3();
  const touched = { animation: false, matrix: false };
  // Paper planes still to leave a thrower's hand: when, and from whom.
  const releases: Array<{ readonly index: number; readonly at: number }> = [];

  const setClip = (index: number, trader: Trader, clip: ClipName, cycles: number, phase: number) => {
    const now = state.time;
    if (trader.present && trader.clip !== clip) {
      animB.setXYZW(index, animA.getX(index), animA.getY(index), animA.getZ(index), 0);
      animA.setXYZW(index, clipIndex(clip), now - phase / cycles, cycles, now);
    } else if (!trader.present) {
      animB.setXYZW(index, -1, 0, 0, 0);
      animA.setXYZW(index, clipIndex(clip), now - phase / cycles, cycles, now - 10);
    } else {
      // The same clip again keeps its phase and only retimes.
      animA.setZ(index, cycles);
    }
    trader.clip = clip;
    touched.animation = true;
  };
  // A settled trader's root: its target, or a step back from it to stand at
  // its own counter.
  const anchorFor = (target: CrowdTarget, clip: ClipName): Point => {
    const kind = traderKinds[target.kind];
    if (kind !== "seat" || seatedClips.has(clip)) return target;
    const back = (counterClips.has(clip) ? traderReach.standing : traderReach.standing + .08) - traderReach.seated;
    const ahead = forward(target.yaw);
    return { x: target.x - ahead.x * back * unitsPerH, z: target.z - ahead.z * back * unitsPerH };
  };
  const settle = (index: number, trader: Trader, target: CrowdTarget, soon = false) => {
    const clip = weighted(trader.random, pool(target), "idle");
    const seconds = clips[clipIndex(clip)]?.seconds ?? 4;
    const rate = .88 + trader.random() * .24;
    setClip(index, trader, clip, rate / seconds, trader.random());
    const anchor = anchorFor(target, clip);
    trader.from = { x: trader.x, z: trader.z };
    trader.anchor = anchor;
    trader.shiftStart = state.time;
    if (clip === "throw") {
      // The plane leaves the hand at the release in each loop that plays.
      const period = seconds / rate, start = animA.getY(index);
      for (let loop = 0; loop < 3; loop++) {
        const at = start + (loop + throwRelease) * period;
        if (at > state.time && at < state.time + 2 * period) releases.push({ index, at });
      }
    }
    const linger = seatedClips.has(clip) ? 6 + trader.random() * 10 : 4 + trader.random() * 7;
    // A loop that tells one story (a throw, a cheer) plays about twice.
    const once = clip === "throw" || clip === "cheer" ? seconds * 2 / rate : linger;
    trader.nextChoice = state.time + (soon ? .5 + trader.random() * 1.5 : once);
  };
  const walk = (index: number, trader: Trader, to: CrowdTarget) => {
    trader.path = route(trader, to, state.posts, obstacle);
    const distance = trader.path.reduce(
      (sum, point, step) => {
        const previous = step === 0 ? trader : trader.path[step - 1] ?? trader;
        return sum + Math.hypot(point.x - previous.x, point.z - previous.z);
      },
      0,
    ) / unitsPerH;
    trader.gait = distance > hurryBeyond ? "hurry" : "walk";
    setClip(index, trader, trader.gait, speeds[trader.gait] * cyclesPerUnit(trader.gait), trader.random());
  };

  const writeMatrix = (index: number, trader: Trader) => {
    // Anyone within a post's plinth stands on it.
    const onPlinth = state.posts.some(post =>
      Math.hypot(trader.x - post.x, trader.z - post.z) < postLayout.plinth * unitsPerH
    );
    position.set(trader.x, onPlinth ? postLayout.plinthHeight * unitsPerH : 0, trader.z);
    rotation.setFromAxisAngle(up, trader.yaw);
    scale.set(unitsPerH * trader.width, unitsPerH * trader.height, unitsPerH * depthOf(trader.width));
    matrix.compose(position, rotation, scale);
    mesh.setMatrixAt(index, matrix);
    touched.matrix = true;
  };

  const retarget = (targets: ReadonlyArray<CrowdTarget>, posts: ReadonlyArray<Point>) => {
    state.posts = [...posts];
    const seen = new Set<number>();
    for (const target of targets) {
      const index = target.id - firstId;
      const slot = Option.fromUndefinedOr(traders[index]);
      if (Option.isNone(slot)) continue;
      const trader = slot.value;
      seen.add(index);
      const previous = trader.target;
      trader.target = Option.some(target);
      if (!trader.present) {
        const { look, width, height } = lookOf(target.seed);
        lookAttribute.setXYZW(index, ...look);
        lookAttribute.needsUpdate = true;
        trader.random = generator(target.seed);
        trader.width = width;
        trader.height = height;
        trader.x = target.x;
        trader.z = target.z;
        trader.yaw = target.yaw;
        trader.path = [];
        settle(index, trader, target);
        trader.present = true;
        trader.x = trader.anchor.x;
        trader.z = trader.anchor.z;
        writeMatrix(index, trader);
        continue;
      }
      const moved = Option.match(previous, {
        onNone: () => true,
        onSome: last => Math.hypot(last.x - target.x, last.z - target.z) > .02 * unitsPerH,
      });
      if (moved) walk(index, trader, target);
      else if (Option.exists(previous, last => last.state !== target.state || last.kind !== target.kind)) {
        trader.nextChoice = state.time + .3 + trader.random();
      }
    }
    traders.forEach((trader, index) => {
      if (seen.has(index) || !trader.present) return;
      trader.present = false;
      trader.target = Option.none();
      animA.setX(index, -1);
      touched.animation = true;
    });
    // Desks fill in order, so drawing up to the last one standing skips the
    // empty tail of a partly filled world.
    mesh.count = Math.max(1, traders.findLastIndex(trader => trader.present) + 1);
  };

  // Walks a trader along its route; arriving settles it into an activity.
  const stepWalk = (index: number, trader: Trader, target: CrowdTarget, dt: number) => {
    let budget = speeds[trader.gait] * unitsPerH * dt;
    let heading = trader.yaw;
    while (budget > 0 && trader.path.length > 0) {
      const next = trader.path[0] ?? target;
      const dx = next.x - trader.x, dz = next.z - trader.z, distance = Math.hypot(dx, dz);
      if (distance > 1e-6) heading = Math.atan2(dx, dz);
      if (distance <= budget) {
        trader.x = next.x;
        trader.z = next.z;
        budget -= distance;
        trader.path.shift();
      } else {
        trader.x += dx / distance * budget;
        trader.z += dz / distance * budget;
        budget = 0;
      }
    }
    trader.yaw += wrapAngle(heading - trader.yaw) * Math.min(1, turnRate * dt);
    if (trader.path.length === 0) settle(index, trader, target);
    return true;
  };
  // A settled trader turns to its heading, eases to its activity's spot and
  // moves on to another activity when this one has run its time.
  const stepSettled = (index: number, trader: Trader, target: CrowdTarget, dt: number) => {
    let moved = false;
    const turn = wrapAngle(target.yaw - trader.yaw);
    if (Math.abs(turn) > 1e-3) {
      trader.yaw += turn * Math.min(1, turnRate * .6 * dt);
      moved = true;
    }
    const shift = Math.min(1, (state.time - trader.shiftStart) / shiftSeconds);
    if (shift < 1) {
      const k = shift * shift * (3 - 2 * shift);
      trader.x = trader.from.x + (trader.anchor.x - trader.from.x) * k;
      trader.z = trader.from.z + (trader.anchor.z - trader.from.z) * k;
      moved = true;
    } else if (trader.x !== trader.anchor.x || trader.z !== trader.anchor.z) {
      trader.x = trader.anchor.x;
      trader.z = trader.anchor.z;
      moved = true;
    }
    if (state.time >= trader.nextChoice) settle(index, trader, target);
    return moved;
  };

  // A released plane flies from the thrower's hand to a spot a few H ahead.
  const release = (index: number) =>
    Option.map(Option.all([flights, Option.fromUndefinedOr(traders[index])]), ([planes, trader]) => {
      if (!trader.present || trader.clip !== "throw") return;
      const ahead = forward(trader.yaw), side = { x: ahead.z, z: -ahead.x };
      const reach = (2.5 + trader.random() * 3) * unitsPerH, drift = (trader.random() - .5) * 1.6 * unitsPerH;
      planes.launch(
        new THREE.Vector3(
          trader.x + (ahead.x * .3 - side.x * .1) * unitsPerH,
          .8 * unitsPerH,
          trader.z + (ahead.z * .3 - side.z * .1) * unitsPerH,
        ),
        new THREE.Vector3(
          trader.x + ahead.x * reach + side.x * drift,
          .02 * unitsPerH,
          trader.z + ahead.z * reach + side.z * drift,
        ),
        state.time,
        trader.random() * 6,
      );
    });

  const tick = (seconds: number) => {
    const dt = Math.min(.1, Math.max(0, seconds - state.time));
    state.time = seconds;
    const due = releases.filter(item => item.at <= seconds);
    if (due.length > 0) {
      releases.splice(0, releases.length, ...releases.filter(item => item.at > seconds));
      due.forEach(item => release(item.index));
    }
    const flying = Option.exists(flights, planes => planes.tick(seconds));
    traders.forEach((trader, index) => {
      if (!trader.present) return;
      Option.map(trader.target, target => {
        const moved = trader.path.length > 0
          ? stepWalk(index, trader, target, dt)
          : stepSettled(index, trader, target, dt);
        if (moved) writeMatrix(index, trader);
      });
    });
    if (touched.animation) {
      animA.needsUpdate = true;
      animB.needsUpdate = true;
      touched.animation = false;
    }
    if (touched.matrix) {
      mesh.instanceMatrix.needsUpdate = true;
      touched.matrix = false;
    }
    return flying || traders.some(trader => trader.present);
  };

  return Option.some({
    retarget,
    tick,
    position: (id: number) =>
      Option.flatMap(
        Option.fromUndefinedOr(traders[id - firstId]),
        trader => trader.present ? Option.some({ x: trader.x, y: 0, z: trader.z }) : Option.none(),
      ),
  });
};
export type Crowd = Option.Option.Value<ReturnType<typeof makeCrowd>>;
