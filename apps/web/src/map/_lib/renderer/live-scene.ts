import { lineClasses } from "@floor/atlas/look";
import { PaletteName } from "@floor/atlas/materials";
import { figureHeight, roomyRecipe } from "@floor/atlas/proportions";
import { Option } from "effect";
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { type GroundArea, type LivePose, livePoses, type LiveScene, postKeys } from "../../model";
import { chairParts, figureParts, liveFigureDetail, makePost, makeStation, stationVariants } from "../assets";
import { annulus, cylinder, isKitMesh } from "../assets/geometry";
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

// A figure in one pose, H = 1 scaled to the layout. Its parts are smooth: one
// surface per material, as the approved figures draw. The seated pose brings
// its chair. Jacket faces take the agent's colour per instance.
const figureBody = (pose: LivePose, unitsPerH: number) => {
  const jacket: PaletteName = "jacket-blue-0";
  const smooth = figureParts(roomyRecipe, pose, jacket, 1, liveFigureDetail);
  const chair = pose === "seated" ? chairParts(roomyRecipe.worktopRatio, 8) : [];
  let chairSurface = surfaces.figures + 500;
  const parts = [...smooth.map(part => ({ part, smooth: true })), ...chair.map(part => ({ part, smooth: false }))].map(
    ({ part, smooth: isSmooth }) => {
      const flat = flatten(part.geometry.scale(unitsPerH, unitsPerH, unitsPerH));
      const count = flat.getAttribute("position").count;
      const ids = new Float32Array(count).fill(
        isSmooth ? surfaces.figures + slot(part.slot) + 1 : chairSurface++,
      );
      if (!isSmooth) {
        for (const group of flat.groups) {
          ids.fill(chairSurface++, group.start, group.start + group.count);
        }
      }
      flat.clearGroups();
      flat.setAttribute("_SURFACE", new THREE.BufferAttribute(ids, 1));
      flat.setAttribute("_MAT", fill(count, part.slot === jacket ? sentinel.jacket : slot(part.slot)));
      flat.setAttribute("_LINE", fill(count, nightLine(part.slot)));
      return flat;
    },
  );
  return merge(parts);
};

// An unopened post: its counter's footprint and pole drawn in the ground's own
// colour, so only the outline reads, as on an architect's plan.
const blueprintBody = (unitsPerH: number) => {
  const kit = makeStatic(surfaces.blueprints, 300);
  const radius = roomyRecipe.counterRadiusRatio * unitsPerH;
  const depth = roomyRecipe.stationDepthRatio * unitsPerH;
  kit.add(annulus(radius, radius - depth, .03 * unitsPerH, 0, 40), "ground");
  kit.add(cylinder(.08 * unitsPerH, .03 * unitsPerH, [0, .015 * unitsPerH, 0], 12), "ground");
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

const furniture = (
  kit: ReturnType<typeof makeStatic>,
  place: LiveScene["places"][number],
  unitsPerH: number,
) => {
  const { area, facing } = place;
  const across = Math.abs(Math.sin(facing)) > .5;
  const depth = (across ? area.x1 - area.x0 : area.z1 - area.z0) / unitsPerH;
  const width = (across ? area.z1 - area.z0 : area.x1 - area.x0) / unitsPerH;
  const centre = new THREE.Vector3((area.x0 + area.x1) / 2, 0, (area.z0 + area.z1) / 2);
  // Local +Z points at the outer wall; furniture keeps the front half clear
  // for an agent standing at the place's centre.
  const back = depth / 2 - .05;
  const room = Math.max(.12, Math.min(.45, depth / 2 - .3));
  const add = (geometry: THREE.BufferGeometry, material: PaletteName) =>
    kit.add(geometry.scale(unitsPerH, unitsPerH, unitsPerH).rotateY(facing).translate(centre.x, 0, centre.z), material);
  const block = (w: number, h: number, d: number, x: number, y: number, z: number, material: PaletteName) =>
    add(new THREE.BoxGeometry(w, h, d).translate(x, y, z), material);
  const face = (w: number, h: number, x: number, y: number, z: number, material: PaletteName) =>
    add(new THREE.PlaneGeometry(w, h).rotateY(Math.PI).translate(x, y, z), material);
  const span = Math.max(.3, width - .2);
  if (place.place === "wallOfScreens") {
    const d = Math.min(room, .25);
    block(span, 1.5, d, 0, .75, back - d / 2, "steel-0");
    for (const side of [-1, 1]) face(span / 2 - .12, .45, side * span / 4, 1.05, back - d - .002, "glass-0");
    for (const side of [-1, 1]) face(span / 2 - .12, .3, side * span / 4, .6, back - d - .002, "glass-0");
  } else if (place.place === "bell") {
    const d = Math.min(room, .35);
    block(d, .55, d, 0, .275, back - d / 2, "timber-0");
    add(new THREE.CylinderGeometry(.07, .15, .18, 12).translate(0, .64, back - d / 2), "steel-0");
    add(new THREE.CylinderGeometry(.025, .025, .06, 8).translate(0, .76, back - d / 2), "steel-0");
  } else if (place.place === "podium") {
    const d = Math.min(room, .35), w = Math.min(span, .7);
    block(w, .62, d, 0, .31, back - d / 2, "timber-0");
    block(w + .06, .04, d + .06, 0, .64, back - d / 2, "timber-0");
  } else if (place.place === "fileRoom") {
    const d = Math.min(room, .4), count = Math.max(1, Math.floor(span / .38));
    for (let index = 0; index < count; index++) {
      block(.35, .8, d, (index - (count - 1) / 2) * .38, .4, back - d / 2, "steel-0");
    }
  } else {
    const d = Math.min(room, .06);
    for (const side of [-1, 1]) block(.04, .35, .04, side * (span / 2 - .06), .175, back - d / 2, "steel-0");
    block(span, .8, d, 0, .75, back - d / 2, "timber-0");
    face(span - .1, .7, 0, .75, back - d - .002, "paper-0");
    for (let row = 0; row < 2; row++) {
      for (let column = 0; column < 3; column++) {
        block(.12, .09, .01, (column - 1) * span / 3.4, .95 - row * .3, back - d - .008, "paper-0");
      }
    }
  }
};

type StaticKit = ReturnType<typeof makeStatic>;

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
  for (const room of live.rooms) {
    for (const area of room.areas) slab(area, (room.blueprint ? .02 : .12) * u, room.blueprint ? "ground" : "floor-0");
  }
  for (const area of live.lobby) slab(area, .12 * u, "paper-0");
  for (const plot of live.plots) {
    const w = plot.x1 - plot.x0, d = plot.z1 - plot.z0, x = (plot.x0 + plot.x1) / 2, z = (plot.z0 + plot.z1) / 2;
    kit.add(new THREE.BoxGeometry(w * .8, .2 * u, d * .8).translate(x, .1 * u, z), "timber-0");
    kit.add(new THREE.BoxGeometry(w * .6, .02 * u, d * .6).translate(x, .21 * u, z), "paper-0");
  }
  for (const place of live.places) furniture(kit, place, u);
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
  for (const piece of walls.exterior) {
    const outward = piece.axis === "x"
      ? new THREE.Vector3(piece.outward, 0, 0)
      : new THREE.Vector3(0, 0, piece.outward);
    Option.map(run(piece, t / 2, 0, stub), geometry => ground.add(geometry, "timber-0"));
    Option.map(run(piece, t / 2, stub, tall), geometry => cut(outward, geometry));
    endpoints(piece, Option.some(outward));
  }
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

// Posts: the kit post where a post is open, its paper footprint where not.
// The order slips the picked Roomy floor scatters just outside each post's
// seated ring, placed by the golden angle as that scene places them.
const floorPapers = (unitsPerH: number) => {
  const kit = makeStatic(surfaces.posts + 900, 90);
  for (let paper = 0; paper < 12; paper++) {
    const angle = paper * 2.399963229728653;
    const r = roomyRecipe.counterRadiusRatio + .36 + (paper % 3) * .085;
    kit.add(
      new THREE.BoxGeometry(.14, .006, .18).rotateY(angle).translate(Math.sin(angle) * r, .003, Math.cos(angle) * r)
        .scale(unitsPerH, unitsPerH, unitsPerH),
      "paper-0",
    );
  }
  return kit.finish();
};

const addPosts = (registry: Registry, live: LiveScene) => {
  const scale = live.unitsPerH / figureHeight;
  const post = makePost({ stations: live.stationsPerPost, monitors: live.monitorsPerPost, segments: 40 });
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

// Stations alternate operator and analyst around each post. The kit lays a
// station out for eight to a post; a fuller ring narrows it by the chord
// ratio so neighbours never meet. Desk slot k is desk k + 2.
const addStations = (registry: Registry, live: LiveScene, desks: number) => {
  const scale = live.unitsPerH / figureHeight;
  const narrow = Math.min(1, Math.sin(Math.PI / live.stationsPerPost) / Math.sin(Math.PI / 8));
  const transform = new THREE.Matrix4().makeScale(scale * narrow, scale, scale);
  stationVariants.forEach((variant, parity) => {
    const slots = Array.from({ length: desks }, (_, index) => index).filter(index =>
      index % live.stationsPerPost % 2 === parity
    );
    Option.map(
      kitBody(makeStation(variant, "live"), transform, sentinel.deskScreen, 0),
      geometry =>
        registry.instanced(`live-station-${variant}`, geometry, slots.length, index => {
          const desk = (slots[index] ?? 0) + 2;
          return { id: desk, entity: desk };
        }),
    );
  });
};

// One figure mesh per pose, each with a slot for every desk; the snapshot
// stands an agent in one of them and gives it its jacket.
const addFigures = (registry: Registry, live: LiveScene, desks: number) =>
  livePoses.forEach((pose, variant) => {
    Option.map(figureBody(pose, live.unitsPerH), geometry => {
      geometry.setAttribute("_TINT", instanceAttribute(desks, 0));
      registry.instanced(`live-figure-${pose}`, geometry, desks, index => ({
        id: index + 2,
        entity: index + 2,
        marker: true,
        variant,
      }));
    });
  });

export const createLiveScene = (live: LiveScene, desks: number, material: THREE.Material): SceneData => {
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
  addFigures(registry, live, desks);
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
  };
};
