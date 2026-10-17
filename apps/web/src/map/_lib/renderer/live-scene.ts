import { lineClasses } from "@floor/atlas/look";
import { PaletteName } from "@floor/atlas/materials";
import { Option } from "effect";
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { type GroundArea, type LiveScene, postKeys } from "../../model";
import { liveStationVariants, makeLivePost, makeLiveStation } from "../assets/floor-kit";
import { cylinder, isKitMesh } from "../assets/geometry";
import { furnishPlace, furnishWall, litter, seeded, tickerBand } from "../assets/room-kit";
import { makeTrader } from "../assets/trader";
import { postLayout } from "../live-layout";
import type { Boundary, Entity, SceneData } from "./scene";

// The live floor: the asset kit's posts, stations and Roomy figures, drawn at
// the layout's scale on timber rooms with low walls. Kit geometry is authored
// at H = 8 kit units; one H is `unitsPerH` plan units here.

// Ground, walls, posts and unbuilt posts pick as identities no desk has (desks
// end at 4087), so picking one selects nothing. Separate identities keep their
// outlines against the floor when a distant view fades same-thing outlines.
const structure = { ground: 1, walls: 4093, posts: 4094, blueprints: 4095 } as const;
// Surface ranges keep one mesh's outlines from colliding with another's under
// the shared ground identity, and a figure's from its own station's.
const surfaces = { ground: 1, posts: 2000, blueprints: 2600, walls: 3000, figures: 1000 } as const;
const wrap = (first: number, span: number) => (value: number) => first + (value - first) % span;

const slot = (name: PaletteName) => PaletteName.literals.indexOf(name);
// Geometry carries its night outline class; the live shader applies it only
// at night. Paper takes the dark stroke there, as in the approved night frames.
const nightLine = (name: PaletteName) => name.startsWith("paper-") ? lineClasses.surfaceDark : lineClasses.ordinary;
// Negative materials the live shader resolves per instance and theme.
const sentinel = { deskScreen: -1, jacket: -2, lamp: -3, crownScreen: -4 } as const;

const fill = (count: number, value: number) => new THREE.BufferAttribute(new Float32Array(count).fill(value), 1);
const flatten = (source: THREE.BufferGeometry) => {
  const flat = source.index ? source.toNonIndexed() : source;
  if (flat !== source) source.dispose();
  flat.deleteAttribute("uv");
  return flat;
};
const merge = (parts: Array<THREE.BufferGeometry>) => {
  if (parts.length === 0) return Option.none<THREE.BufferGeometry>();
  const merged = Option.fromNullOr(mergeGeometries(parts, false));
  parts.forEach(part => part.dispose());
  return merged;
};
const dynamic = (array: Float32Array) => new THREE.InstancedBufferAttribute(array, 1).setUsage(THREE.DynamicDrawUsage);

// Static geometry for one mesh, each primitive (and each box face) its own
// surface so technique B outlines it.
const makeStatic = (first: number, span: number, counter = { surface: first }) => {
  const parts: Array<THREE.BufferGeometry> = [];
  const next = wrap(first, span);
  return {
    add: (source: THREE.BufferGeometry, paint: PaletteName) => {
      const flat = flatten(source);
      const count = flat.getAttribute("position").count;
      const ids = new Float32Array(count).fill(next(counter.surface++));
      for (const group of flat.groups) ids.fill(next(counter.surface++), group.start, group.start + group.count);
      flat.clearGroups();
      flat.setAttribute("_SURFACE", new THREE.BufferAttribute(ids, 1));
      flat.setAttribute("_MAT", fill(count, slot(paint)));
      flat.setAttribute("_LINE", fill(count, nightLine(paint)));
      parts.push(flat);
    },
    finish: () => merge(parts),
  };
};

// The kit's one body mesh, rescaled and given live materials: a screen face
// becomes `screen`, a lamp aperture the lamp sentinel.
const kitBody = (group: THREE.Group, transform: THREE.Matrix4, screen: number, offset: number) => {
  const bodies: Array<THREE.Mesh> = [];
  group.traverse(node => {
    if (isKitMesh(node)) bodies.push(node);
  });
  const parts = bodies.map(body => {
    const geometry = body.geometry.clone().applyMatrix4(transform);
    const materials = geometry.getAttribute("_MAT"), lights = geometry.getAttribute("_LIGHT");
    const ids = geometry.getAttribute("_SURFACE");
    const count = geometry.getAttribute("position").count;
    const line = new Float32Array(count);
    for (let index = 0; index < count; index++) {
      const light = lights.getX(index);
      const name = Option.fromUndefinedOr(PaletteName.literals[materials.getX(index)]);
      line[index] = Option.match(name, { onNone: () => lineClasses.ordinary, onSome: nightLine });
      materials.setX(index, light === 1 ? screen : light === 2 ? sentinel.lamp : materials.getX(index));
      ids.setX(index, ids.getX(index) + offset);
    }
    geometry.setAttribute("_LINE", new THREE.BufferAttribute(line, 1));
    geometry.deleteAttribute("_LIGHT");
    body.geometry.dispose();
    if (body.material instanceof THREE.Material) body.material.dispose();
    else body.material.forEach(material => material.dispose());
    return geometry;
  });
  return merge(parts);
};

// An unopened post: its counter's footprint and pole drawn in the ground's own
// colour, so only the outline reads, as on an architect's plan.
const blueprintBody = (unitsPerH: number) => {
  const kit = makeStatic(surfaces.blueprints, 300);
  const sides = 10, radius = postLayout.plinth / Math.cos(Math.PI / sides) * unitsPerH;
  kit.add(
    new THREE.CylinderGeometry(radius, radius, .02 * unitsPerH, sides).rotateY(Math.PI / sides).translate(
      0,
      .01 * unitsPerH,
      0,
    ),
    "ground",
  );
  kit.add(cylinder(.3 * unitsPerH, .03 * unitsPerH, [0, .015 * unitsPerH, 0], sides), "ground");
  return kit.finish();
};

type Segment = {
  // A wall line at x = at (axis "x") or z = at (axis "z"), from..to along it,
  // with the side its room is not on.
  readonly axis: "x" | "z";
  readonly at: number;
  readonly from: number;
  readonly to: number;
  readonly outward: -1 | 1;
};
type Interval = readonly [number, number];
const epsilon = 1e-6;
const edgesOf = (area: GroundArea): ReadonlyArray<Segment> => [
  { axis: "x", at: area.x0, from: area.z0, to: area.z1, outward: -1 },
  { axis: "x", at: area.x1, from: area.z0, to: area.z1, outward: 1 },
  { axis: "z", at: area.z0, from: area.x0, to: area.x1, outward: -1 },
  { axis: "z", at: area.z1, from: area.x0, to: area.x1, outward: 1 },
];
// Where rectangles beyond `edge` meet it along its line.
const meeting = (edge: Segment, areas: ReadonlyArray<GroundArea>): Array<Interval> =>
  areas.flatMap(area =>
    edgesOf(area).flatMap(other => {
      if (other.axis !== edge.axis || other.outward === edge.outward || Math.abs(other.at - edge.at) > epsilon) {
        return [];
      }
      const from = Math.max(edge.from, other.from), to = Math.min(edge.to, other.to);
      return to - from > epsilon ? [[from, to] satisfies Interval] : [];
    })
  );
const without = (edge: Segment, cuts: ReadonlyArray<Interval>): Array<Segment> =>
  cuts.reduce<Array<Interval>>(
    (pieces, [a, b]) =>
      pieces.flatMap(([from, to]): Array<Interval> =>
        [[from, Math.min(to, a)] satisfies Interval, [Math.max(from, b), to] satisfies Interval].filter(([x, y]) =>
          y - x > epsilon
        )
      ),
    [[edge.from, edge.to]],
  ).map(([from, to]) => ({ ...edge, from, to }));
const within = (edge: Segment, cuts: ReadonlyArray<Interval>): Array<Segment> =>
  cuts.flatMap(([a, b]) => {
    const from = Math.max(edge.from, a), to = Math.min(edge.to, b);
    return to - from > epsilon ? [{ ...edge, from, to }] : [];
  });

// The walls of the built rooms and the lobby: around the exchange's outside
// (camera-facing ones are cut away), and between rooms where the layout
// separates them with doors. A layout whose floors meet edge to edge with no
// doors has no walls between them. Blueprint rooms are unbuilt, so a built
// room's side facing one is its outside wall.
export const wallPlan = (live: Pick<LiveScene, "rooms" | "lobby" | "doors">) => {
  const bodies = [...live.rooms.filter(room => !room.blueprint).map(room => room.areas), live.lobby].filter(areas =>
    areas.length > 0
  );
  const exterior: Array<Segment> = [], shared: Array<Segment> = [];
  bodies.forEach((areas, index) => {
    const others = bodies.filter((_, other) => other !== index).flat();
    for (const area of areas) {
      for (const edge of edgesOf(area)) {
        const own = areas.filter(other => other !== area);
        for (const piece of without(edge, meeting(edge, own))) {
          const neighbours = meeting(piece, others);
          exterior.push(...without(piece, neighbours));
          // Each shared line appears from both rooms; keep one copy.
          if (piece.outward === 1) shared.push(...within(piece, neighbours));
        }
      }
    }
  });
  // A door's passages touch or cross its wall's line.
  const gaps = (piece: Segment) =>
    live.doors.flatMap((door): Array<Interval> => {
      const [low, high, from, to] = piece.axis === "x"
        ? [door.x0, door.x1, door.z0, door.z1]
        : [door.z0, door.z1, door.x0, door.x1];
      const a = Math.max(piece.from, from), b = Math.min(piece.to, to);
      return piece.at >= low - epsilon && piece.at <= high + epsilon && b - a > epsilon ? [[a, b]] : [];
    });
  const open = (pieces: ReadonlyArray<Segment>) => pieces.flatMap(piece => without(piece, gaps(piece)));
  return {
    exterior: open(exterior),
    partitions: live.doors.length > 0 ? open(shared) : [],
    sills: [...exterior, ...shared].flatMap(piece => within(piece, gaps(piece))),
  };
};

const wallHeights = { stub: .15, exterior: 1.4, partition: .5, thickness: .12, sill: .02 } as const;

// A named place's furniture fills its reservation with its back to the outer
// wall; `facing` turns +Z toward that wall, and the kit's +Z faces the room.
const furniture = (kit: ReturnType<typeof makeStatic>, place: LiveScene["places"][number], unitsPerH: number) => {
  const { area, facing } = place;
  const across = Math.abs(Math.sin(facing)) > .5;
  const depth = (across ? area.x1 - area.x0 : area.z1 - area.z0) / unitsPerH;
  const width = (across ? area.z1 - area.z0 : area.x1 - area.x0) / unitsPerH;
  const centre = { x: (area.x0 + area.x1) / 2, z: (area.z0 + area.z1) / 2 };
  furnishPlace(
    (geometry, material) =>
      kit.add(
        geometry.scale(unitsPerH, unitsPerH, unitsPerH).rotateY(facing + Math.PI).translate(centre.x, 0, centre.z),
        material,
      ),
    place.place,
    width,
    depth,
    seeded(Math.round(centre.x * 31 + centre.z * 17)),
  );
};

const inside = (area: GroundArea, x: number, z: number, margin = 0) =>
  x >= area.x0 - margin && x <= area.x1 + margin && z >= area.z0 - margin && z <= area.z1 + margin;

type StaticKit = ReturnType<typeof makeStatic>;

// The lobby's marble: a two-tone checkerboard over its slab, each tile its own
// surface so the joints draw, as in the picked lobby frame.
const tiles = (kit: StaticKit, area: GroundArea, u: number) => {
  const size = 1.5 * u;
  const columns = Math.floor((area.x1 - area.x0) / size), rows = Math.floor((area.z1 - area.z0) / size);
  const x0 = (area.x0 + area.x1 - columns * size) / 2, z0 = (area.z0 + area.z1 - rows * size) / 2;
  for (let column = 0; column < columns; column++) {
    for (let row = 0; row < rows; row++) {
      kit.add(
        new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2).translate(
          x0 + (column + .5) * size,
          .001 * u,
          z0 + (row + .5) * size,
        ),
        (column + row) % 2 === 0 ? "paper-0" : "plastic-0",
      );
    }
  }
};

// Rooms, the lobby, plots and place furniture, in the ground's one mesh.
const addGround = (kit: StaticKit, live: LiveScene) => {
  const u = live.unitsPerH;
  const slab = (area: GroundArea, thickness: number, paint: PaletteName) =>
    kit.add(
      new THREE.BoxGeometry(area.x1 - area.x0, thickness, area.z1 - area.z0).translate(
        (area.x0 + area.x1) / 2,
        -thickness / 2,
        (area.z0 + area.z1) / 2,
      ),
      paint,
    );
  // A blueprint room is its outline on the ground, unbuilt.
  for (const [index, room] of live.rooms.entries()) {
    for (const area of room.areas) {
      slab(area, (room.blueprint ? .02 : .12) * u, room.blueprint ? "ground" : "floor-0");
      if (room.blueprint) continue;
      // The floor is littered with order slips, thickest where trading is.
      const cx = (area.x0 + area.x1) / 2, cz = (area.z0 + area.z1) / 2;
      litter(
        (geometry, material) => kit.add(geometry.scale(u, u, u).translate(cx, 0, cz), material),
        (area.x1 - area.x0) / u - .3,
        (area.z1 - area.z0) / u - .3,
        1.1,
        seeded(index * 977 + Math.round(cx)),
      );
    }
  }
  for (const area of live.lobby) {
    slab(area, .12 * u, "paper-0");
    tiles(kit, area, u);
  }
  for (const plot of live.plots) {
    const w = plot.x1 - plot.x0, d = plot.z1 - plot.z0, x = (plot.x0 + plot.x1) / 2, z = (plot.z0 + plot.z1) / 2;
    kit.add(new THREE.BoxGeometry(w * .8, .2 * u, d * .8).translate(x, .1 * u, z), "timber-0");
    kit.add(new THREE.BoxGeometry(w * .6, .02 * u, d * .6).translate(x, .21 * u, z), "paper-0");
  }
  for (const place of live.places) furniture(kit, place, u);
};

// Along each outside wall, the floor's clutter stands on the ground and hangs
// on the wall (cut away with it), clear of posts, places and doors.
const dressWalls = (
  exterior: ReadonlyArray<Segment>,
  ground: StaticKit,
  hung: (outward: THREE.Vector3, geometry: THREE.BufferGeometry, material: PaletteName) => void,
  live: LiveScene,
) => {
  const u = live.unitsPerH, t = wallHeights.thickness * u;
  const blocked = (x: number, z: number, half: number) =>
    live.postAnchors.some(anchor => Math.hypot(anchor.x - x, anchor.z - z) < (postLayout.plinth + .45) * u + half)
    || live.places.some(place => inside(place.area, x, z, .3 * u + half))
    || live.doors.some(door => inside(door, x, z, .35 * u + half));
  for (const [index, piece] of exterior.entries()) {
    const inward = piece.axis === "x" ? { x: -piece.outward, z: 0 } : { x: 0, z: -piece.outward };
    const yaw = Math.atan2(inward.x, inward.z);
    // The kit's +X runs along the wall; start from the end it runs away from.
    const direction = { x: Math.cos(yaw), z: -Math.sin(yaw) };
    const low = piece.axis === "x" ? { x: piece.at, z: piece.from } : { x: piece.from, z: piece.at };
    const high = piece.axis === "x" ? { x: piece.at, z: piece.to } : { x: piece.to, z: piece.at };
    const ascending = (high.x - low.x) * direction.x + (high.z - low.z) * direction.z >= 0;
    const [first, last] = ascending ? [low, high] : [high, low];
    const length = Math.hypot(last.x - first.x, last.z - first.z) / u;
    const face = { x: first.x + inward.x * t / 2, z: first.z + inward.z * t / 2 };
    const at = (along: number) => ({ x: face.x + direction.x * along * u, z: face.z + direction.z * along * u });
    const middle = at(length / 2);
    const lobby = live.lobby.some(area => inside(area, middle.x + inward.x * u, middle.z + inward.z * u));
    const outward = new THREE.Vector3(
      piece.axis === "x" ? piece.outward : 0,
      0,
      piece.axis === "z" ? piece.outward : 0,
    );
    const placed =
      (along: number, target: (geometry: THREE.BufferGeometry, material: PaletteName) => void) =>
      (geometry: THREE.BufferGeometry, material: PaletteName) => {
        const point = at(along);
        target(geometry.scale(u, u, u).rotateY(yaw).translate(point.x, 0, point.z), material);
      };
    const onWall = (geometry: THREE.BufferGeometry, material: PaletteName) => hung(outward, geometry, material);
    const random = seeded(index * 7919 + Math.round(first.x * 13 + first.z * 7));
    furnishWall(
      length,
      lobby ? "lobby" : "room",
      random,
      (along, half) => {
        const point = at(along);
        return !blocked(point.x + inward.x * .3 * u, point.z + inward.z * .3 * u, half * u);
      },
      (along, build) => build(placed(along, (geometry, material) => ground.add(geometry, material))),
      (along, build) => build(placed(along, onWall)),
    );
    if (!lobby && length > 9 && random() < .7) tickerBand(placed(length / 2, onWall), length * .62);
  }
};

// Walls stop half a thickness short of each end, where a square post joins
// them: no two boxes overlap, so no coplanar faces flicker in the outline.
// Stubs and partitions stay in the ground; the tall part of each outside wall
// joins a cut-away group by the way it faces. The groups share one surface
// counter, so walls meeting across groups still outline where they join.
const addWalls = (ground: StaticKit, live: LiveScene) => {
  const u = live.unitsPerH;
  const walls = wallPlan(live);
  const t = wallHeights.thickness * u;
  const stub = wallHeights.stub * u, tall = wallHeights.exterior * u, low = wallHeights.partition * u;
  const run = (piece: Segment, inset: number, bottom: number, top: number) => {
    const length = piece.to - piece.from - 2 * inset, middle = (piece.from + piece.to) / 2;
    if (length <= epsilon || top <= bottom) return Option.none<THREE.BufferGeometry>();
    return Option.some(
      piece.axis === "x"
        ? new THREE.BoxGeometry(t, top - bottom, length).translate(piece.at, (bottom + top) / 2, middle)
        : new THREE.BoxGeometry(length, top - bottom, t).translate(middle, (bottom + top) / 2, piece.at),
    );
  };
  const joints = new Map<string, { x: number; z: number; outward: THREE.Vector3; exterior: boolean }>();
  const endpoints = (piece: Segment, outward: Option.Option<THREE.Vector3>) => {
    for (const along of [piece.from, piece.to]) {
      const x = piece.axis === "x" ? piece.at : along, z = piece.axis === "x" ? along : piece.at;
      const key = `${Math.round(x * 1e5)},${Math.round(z * 1e5)}`;
      const joint = joints.get(key) ?? { x, z, outward: new THREE.Vector3(), exterior: false };
      Option.map(outward, value => {
        joint.outward.add(value);
        joint.exterior = true;
      });
      joints.set(key, joint);
    }
  };
  const groups = new Map<string, { outward: THREE.Vector3; kit: StaticKit }>();
  const counter = { surface: surfaces.walls };
  const cut = (outward: THREE.Vector3, geometry: THREE.BufferGeometry) => {
    const key = `${Math.round(outward.x)},${Math.round(outward.z)}`;
    const group = groups.get(key) ?? { outward: outward.clone(), kit: makeStatic(surfaces.walls, 1000, counter) };
    group.kit.add(geometry, "timber-0");
    groups.set(key, group);
  };
  const hung = (outward: THREE.Vector3, geometry: THREE.BufferGeometry, material: PaletteName) => {
    const key = `${Math.round(outward.x)},${Math.round(outward.z)}`;
    const group = groups.get(key) ?? { outward: outward.clone(), kit: makeStatic(surfaces.walls, 1000, counter) };
    group.kit.add(geometry, material);
    groups.set(key, group);
  };
  for (const piece of walls.exterior) {
    const outward = piece.axis === "x"
      ? new THREE.Vector3(piece.outward, 0, 0)
      : new THREE.Vector3(0, 0, piece.outward);
    Option.map(run(piece, t / 2, 0, stub), geometry => ground.add(geometry, "timber-0"));
    Option.map(run(piece, t / 2, stub, tall), geometry => cut(outward, geometry));
    endpoints(piece, Option.some(outward));
  }
  dressWalls(walls.exterior, ground, hung, live);
  for (const piece of walls.partitions) {
    Option.map(run(piece, t / 2, 0, low), geometry => ground.add(geometry, "timber-0"));
    endpoints(piece, Option.none());
  }
  for (const joint of joints.values()) {
    const column = (bottom: number, top: number) =>
      new THREE.BoxGeometry(t, top - bottom, t).translate(joint.x, (bottom + top) / 2, joint.z);
    ground.add(column(0, joint.exterior ? stub : low), "timber-0");
    if (joint.exterior) cut(joint.outward, column(stub, tall));
  }
  for (const sill of walls.sills) {
    Option.map(run(sill, 0, 0, wallHeights.sill * u), geometry => ground.add(geometry, "steel-0"));
  }
  return groups;
};

const instanceAttribute = (count: number, value: number) => dynamic(new Float32Array(Math.max(1, count)).fill(value));

const makeRegistry = (material: THREE.Material) => {
  const scene = new THREE.Scene();
  scene.name = "live-floor";
  const meshes: Array<THREE.Mesh> = [];
  const geometries: Array<THREE.BufferGeometry> = [];
  const entities: Array<Entity> = [];
  const boundaries: Array<Boundary> = [];
  const register = (mesh: THREE.Mesh) => {
    meshes.push(mesh);
    geometries.push(mesh.geometry);
    scene.add(mesh);
    return mesh;
  };
  return {
    scene,
    material,
    meshes,
    geometries,
    entities,
    boundaries,
    still: (name: string, geometry: THREE.BufferGeometry, entity: number) => {
      const count = geometry.getAttribute("position").count;
      for (const attribute of ["_ANIMATED", "_PREVIOUS", "_NEXT"]) geometry.setAttribute(attribute, fill(count, 0));
      geometry.setAttribute("_PALETTE", fill(count, -1));
      geometry.setAttribute("_ENTITY", fill(count, entity));
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = name;
      entities.push({ id: entity, mesh, maybeInstance: Option.none() });
      return register(mesh);
    },
    // Instances start hidden at the origin; the snapshot places, turns and
    // shows them. `entity` is the picking identity each slot draws.
    instanced: (
      name: string,
      geometry: THREE.BufferGeometry,
      count: number,
      slots: (index: number) => Omit<Entity, "mesh" | "maybeInstance"> & { readonly entity: number },
    ) => {
      const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, count));
      mesh.name = name;
      mesh.count = count;
      const identity = instanceAttribute(count, 0);
      const matrix = new THREE.Matrix4();
      for (let index = 0; index < count; index++) {
        mesh.setMatrixAt(index, matrix);
        const { entity, ...member } = slots(index);
        identity.setX(index, entity);
        entities.push({ ...member, mesh, maybeInstance: Option.some(index) });
      }
      geometry.setAttribute("_ENTITY", identity);
      geometry.setAttribute("_PALETTE", instanceAttribute(count, -1));
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      return register(mesh);
    },
  };
};
type Registry = ReturnType<typeof makeRegistry>;

// Posts: the live kit's post where a post is open, its outline where not,
// with order slips trodden into the aisle round each one.
const floorPapers = (unitsPerH: number) => {
  const kit = makeStatic(surfaces.posts + 900, 90);
  for (let paper = 0; paper < 22; paper++) {
    const angle = paper * 2.399963229728653 + Math.sin(paper * 12.9898) * .3;
    const r = postLayout.plinth + .05 + ((paper * 0.618034) % 1) * .75;
    kit.add(
      new THREE.PlaneGeometry(.06, .08).rotateX(-Math.PI / 2).rotateY(angle * 3.1).translate(
        Math.sin(angle) * r,
        .003 + (paper % 3) * .0004,
        Math.cos(angle) * r,
      ).scale(unitsPerH, unitsPerH, unitsPerH),
      "paper-0",
    );
  }
  return kit.finish();
};

const addPosts = (registry: Registry, live: LiveScene) => {
  const scale = live.unitsPerH;
  const post = makeLivePost(live.stationsPerPost, live.monitorsPerPost);
  const body = kitBody(post, new THREE.Matrix4().makeScale(scale, scale, scale), sentinel.crownScreen, surfaces.posts);
  Option.map(
    Option.flatMap(body, geometry => merge([geometry, ...Option.toArray(floorPapers(live.unitsPerH))])),
    geometry =>
      registry.instanced("live-post", geometry, live.posts, index => ({
        id: postKeys.open + index,
        entity: structure.posts,
      })),
  );
  Option.map(blueprintBody(live.unitsPerH), geometry => {
    const mesh = registry.instanced("live-blueprint-post", geometry, live.posts, index => ({
      id: postKeys.blueprint + index,
      entity: structure.blueprints,
    }));
    // On a built floor an unopened post takes the floor's own tone, so it too
    // is only an outline; slots run floor by floor.
    const perFloor = live.posts / Math.max(1, live.rooms.length);
    const palette = mesh.geometry.getAttribute("_PALETTE");
    for (let index = 0; index < live.posts; index++) {
      const built = live.rooms[Math.floor(index / perFloor)]?.blueprint === false;
      if (built) palette.setX(index, slot("floor-0"));
    }
  });
};

// Neighbouring desks take different station clutter. Desk slot k is desk k + 2.
export const stationVariantOf = (index: number) => (Math.imul(index + 7, 2654435761) >>> 0) % liveStationVariants;
const addStations = (registry: Registry, live: LiveScene, desks: number) => {
  const scale = live.unitsPerH;
  const transform = new THREE.Matrix4().makeScale(scale, scale, scale);
  for (let variant = 0; variant < liveStationVariants; variant++) {
    const slots = Array.from({ length: desks }, (_, index) => index).filter(index =>
      stationVariantOf(index) === variant
    );
    Option.map(
      kitBody(makeLiveStation(variant, live.stationsPerPost), transform, sentinel.deskScreen, 0),
      geometry =>
        registry.instanced(`live-station-${variant}`, geometry, slots.length, index => {
          const desk = (slots[index] ?? 0) + 2;
          return { id: desk, entity: desk };
        }),
    );
  }
};

// Every desk's trader in one mesh, one instance per desk. The crowd places,
// turns and animates them, so they stay out of the snapshot's members.
const addTraders = (registry: Registry, desks: number, material: THREE.Material) => {
  const geometry = makeTrader(surfaces.figures);
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, desks));
  mesh.name = "live-traders";
  mesh.count = desks;
  mesh.frustumCulled = false;
  const lanes = (size: number, first: number) => {
    const array = new Float32Array(Math.max(1, desks) * size);
    for (let index = 0; index < array.length; index += size) array[index] = first;
    return new THREE.InstancedBufferAttribute(array, size).setUsage(THREE.DynamicDrawUsage);
  };
  geometry.setAttribute("_ANIM_A", lanes(4, -1));
  geometry.setAttribute("_ANIM_B", lanes(4, -1));
  geometry.setAttribute("_LOOK", lanes(4, 0));
  geometry.setAttribute(
    "_ENTITY",
    new THREE.InstancedBufferAttribute(Float32Array.from({ length: Math.max(1, desks) }, (_, index) => index + 2), 1),
  );
  geometry.computeBoundingSphere();
  registry.meshes.push(mesh);
  registry.geometries.push(geometry);
  registry.scene.add(mesh);
  return mesh;
};

// One wing of a paper plane, nose toward +Z.
const planeWing = (side: 1 | -1) => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      side === 1 ? [0, 0, .07, .05, .006, -.05, 0, .014, -.05] : [0, 0, .07, 0, .014, -.05, -.05, .006, -.05],
      3,
    ),
  );
  geometry.computeVertexNormals();
  return geometry;
};

// A pool of paper planes for the crowd to throw, hidden until launched. They
// pick as ground, so clicking one selects nothing.
const addPlanes = (registry: Registry, count: number) => {
  const kit = makeStatic(surfaces.posts + 990, 9);
  kit.add(planeWing(1), "paper-0");
  kit.add(planeWing(-1), "paper-0");
  return Option.map(kit.finish(), geometry => {
    const mesh = new THREE.InstancedMesh(geometry, registry.material, count);
    mesh.name = "live-planes";
    mesh.frustumCulled = false;
    const lanes = (size: number) =>
      new THREE.InstancedBufferAttribute(new Float32Array(count * size), size).setUsage(THREE.DynamicDrawUsage);
    for (let index = 0; index < count; index++) mesh.setMatrixAt(index, new THREE.Matrix4().makeScale(0, 0, 0));
    geometry.setAttribute("_INSTANCE_FROM", lanes(4));
    geometry.setAttribute("_INSTANCE_TO", lanes(4));
    geometry.setAttribute("_TINT", lanes(1));
    geometry.setAttribute(
      "_ENTITY",
      new THREE.InstancedBufferAttribute(new Float32Array(count).fill(structure.ground), 1),
    );
    geometry.setAttribute("_PALETTE", new THREE.InstancedBufferAttribute(new Float32Array(count).fill(-1), 1));
    registry.meshes.push(mesh);
    registry.geometries.push(geometry);
    registry.scene.add(mesh);
    return mesh;
  });
};

export const createLiveScene = (
  live: LiveScene,
  desks: number,
  material: THREE.Material,
  traderMaterial: THREE.Material,
): SceneData => {
  const registry = makeRegistry(material);
  const ground = makeStatic(surfaces.ground, surfaces.posts - surfaces.ground);
  addGround(ground, live);
  const walls = addWalls(ground, live);
  Option.map(ground.finish(), geometry => registry.still("live-ground", geometry, structure.ground));
  for (const [key, group] of walls) {
    Option.map(group.kit.finish(), geometry => {
      const mesh = registry.still(`live-wall-${key}`, geometry, structure.walls);
      registry.boundaries.push({ name: `wall-${key}`, id: structure.walls, mesh, outward: group.outward });
    });
  }
  addPosts(registry, live);
  addStations(registry, live, desks);
  const traders = addTraders(registry, desks, traderMaterial);
  const planes = addPlanes(registry, 24);
  registry.scene.updateMatrixWorld(true);
  return {
    scene: registry.scene,
    meshes: registry.meshes,
    geometries: registry.geometries,
    entities: registry.entities,
    boundaries: registry.boundaries,
    cutaway: towardCamera => {
      registry.boundaries.forEach(boundary => {
        boundary.mesh.layers.set(boundary.outward.dot(towardCamera) <= 0 ? 0 : 1);
      });
    },
    gauge: Option.none(),
    traders,
    ...Option.match(planes, { onNone: () => ({}), onSome: mesh => ({ planes: mesh }) }),
  };
};
