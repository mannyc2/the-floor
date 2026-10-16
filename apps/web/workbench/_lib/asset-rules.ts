import { cameraValues } from "@floor/atlas/camera";
import { lineClasses, shading } from "@floor/atlas/look";
import { type Palette, PaletteName } from "@floor/atlas/materials";
import { Option, Schema } from "effect";
import * as THREE from "three";
import { isAssetMesh } from "./asset-mesh";

const AssetRuleCheck = Schema.Struct({
  rule: Schema.String,
  status: Schema.Literals(["Passed", "Failed", "NotExercised", "Unmeasured"]),
  evidence: Schema.Array(Schema.String),
});
type AssetRuleCheck = typeof AssetRuleCheck.Type;
const FaceObservation = Schema.Struct({
  material: PaletteName,
  tone: PaletteName,
  samples: Schema.Int,
  lineContrast: Schema.Finite,
  groundContrast: Schema.Finite,
});
export const AssetRuleReport = Schema.Struct({
  source: Schema.Literal("synthetic"),
  visibility: Schema.Literal("conservative-front-facing-triangles"),
  theme: Schema.Literals(["day", "night"]),
  checks: Schema.Array(AssetRuleCheck),
  faces: Schema.Array(FaceObservation),
});
export type AssetRuleReport = typeof AssetRuleReport.Type;
type Theme = AssetRuleReport["theme"];

const linear = (channel: number) => {
  const value = channel / 255;
  return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
};
const luminance = (color: number) => {
  return linear((color >> 16) & 255) * .2126 + linear((color >> 8) & 255) * .7152 + linear(color & 255) * .0722;
};
export const contrast = (left: number, right: number) => {
  const a = luminance(left), b = luminance(right);
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
};

// The review adapter and the preflight share this mapping. Generated assets
// describe a light's role; day and night remain material choices at drawing time.
export const assetFaceStyle = (slot: number, light: number, theme: Theme) => {
  const original = Option.fromUndefinedOr(PaletteName.literals[slot]);
  return Option.map(original, base => {
    const material = theme === "night" && light === 1
      ? "screen-light-0"
      : theme === "night" && light === 2
      ? "lamp-light-0"
      : base;
    return {
      material,
      lineClass: theme === "night" && ["paper-", "screen-light-", "lamp-light-"].some(prefix =>
          material.startsWith(prefix)
        )
        ? lineClasses.surfaceDark
        : lineClasses.ordinary,
    };
  });
};

// The surface shader's side band: the view-space normal's x, negated, so the
// dark side stays on the same screen side at every quarter turn.
export const sideAt = (normal: THREE.Vector3, right: THREE.Vector3) => -normal.dot(right);
const toneAt = (material: PaletteName, normal: THREE.Vector3, right: THREE.Vector3) => {
  const slot = PaletteName.literals.indexOf(material);
  if (slot < shading.unshadedSlots) return Option.some(material);
  const base = shading.unshadedSlots
    + Math.floor((slot - shading.unshadedSlots) / shading.tonesPerMaterial) * shading.tonesPerMaterial;
  const offset = normal.y > shading.verticalThreshold
    ? 3
    : normal.y < -shading.verticalThreshold
    ? 0
    : sideAt(normal, right) >= shading.sideTolerance
    ? 2
    : 1;
  return Option.fromUndefinedOr(PaletteName.literals[base + offset]);
};

const flatMaterial = (name: string) =>
  ["paper-", "screen-light-", "lamp-light-"].some(prefix => name.startsWith(prefix));
const bodyMaterial = (name: string) => !flatMaterial(name) && !name.startsWith("floor-");
const materialBase = (name: PaletteName) => name.replace(/-[0-3]$/, "");
const check = (rule: string, failed: ReadonlyArray<string>, evidence: ReadonlyArray<string>): AssetRuleCheck => ({
  rule,
  status: failed.length > 0 ? "Failed" : evidence.length > 0 ? "Passed" : "Unmeasured",
  evidence: failed.length > 0 ? [...failed] : [...evidence],
});
const deferred = (rule: string, status: "NotExercised" | "Unmeasured", reason: string): AssetRuleCheck => ({
  rule,
  status,
  evidence: [reason],
});
interface Face {
  readonly material: PaletteName;
  readonly tone: PaletteName;
  readonly lineClass: number;
  samples: number;
}

type SurfaceMesh = THREE.Mesh;
type Attribute = THREE.BufferAttribute | THREE.InterleavedBufferAttribute;
interface GeometryAttributes {
  readonly position: Attribute;
  readonly normal: Attribute;
  readonly material: Attribute;
  readonly surface: Attribute;
  readonly light: Attribute;
}
interface Inspection {
  readonly faces: Map<string, Face>;
  readonly invalid: Array<string>;
  readonly textures: Array<string>;
  triangles: number;
}
type Corners = readonly [number, number, number];
type Normals = readonly [THREE.Vector3, THREE.Vector3, THREE.Vector3];

const readAttributes = (node: SurfaceMesh, inspection: Inspection): Option.Option<GeometryAttributes> => {
  const geometry = node.geometry;
  if (["position", "normal", "_MAT", "_SURFACE", "_LIGHT"].some(name => !geometry.hasAttribute(name))) {
    inspection.invalid.push(`${node.name}: position, normal, _MAT, _SURFACE and _LIGHT are required.`);
    return Option.none();
  }
  const attributes = {
    position: geometry.getAttribute("position"),
    normal: geometry.getAttribute("normal"),
    material: geometry.getAttribute("_MAT"),
    surface: geometry.getAttribute("_SURFACE"),
    light: geometry.getAttribute("_LIGHT"),
  };
  const { position, normal, material, surface, light } = attributes;
  if (
    position.itemSize !== 3 || normal.itemSize !== 3
    || [material, surface, light].some(attribute => attribute.itemSize !== 1)
    || [normal, material, surface, light].some(attribute => attribute.count !== position.count)
  ) {
    inspection.invalid.push(`${node.name}: attribute widths and vertex counts disagree.`);
    return Option.none();
  }
  return Option.some(attributes);
};

const triangleStyle = (attributes: GeometryAttributes, vertices: Corners, theme: Theme) => {
  const { position, material, surface, light } = attributes;
  if (vertices.some(vertex => !Number.isInteger(vertex) || vertex < 0 || vertex >= position.count)) {
    return Option.none();
  }
  const slot = material.getX(vertices[0]), role = light.getX(vertices[0]), id = surface.getX(vertices[0]);
  if (
    !Number.isInteger(slot) || !Number.isInteger(id) || id < 0 || id >= 4096 || ![0, 1, 2].includes(role)
    || vertices.some(vertex =>
      material.getX(vertex) !== slot || surface.getX(vertex) !== id || light.getX(vertex) !== role
    )
  ) return Option.none();
  return assetFaceStyle(slot, role, theme);
};

// The side value is linear in the normal and the camera's right vector is
// horizontal, so each vertex's horizontal direction keeps its side band and
// the vertices bound every band an interpolated normal can reach.
const horizontalDirections = (normals: Normals) =>
  normals.flatMap(normal => {
    const horizontal = normal.clone().setY(0);
    return horizontal.lengthSq() > 1e-20 ? [horizontal.normalize()] : [];
  });

const possibleTones = (material: PaletteName, normals: Normals, right: THREE.Vector3) => {
  const possible = new Set<PaletteName>();
  const directions = [...normals];
  // A curved triangle interpolates its normals. Conservatively admit every
  // band its normal cone could reach; an occluded or merely tiny face never
  // becomes a claimed exemption before there is pixel evidence.
  if (normals.some(value => value.distanceToSquared(normals[0]) > 1e-12)) {
    if (normals.some(value => value.y < 0)) directions.push(new THREE.Vector3(0, -1, 0));
    if (normals.some(value => value.y > 0)) directions.push(new THREE.Vector3(0, 1, 0));
    directions.push(...horizontalDirections(normals));
  }
  for (const direction of directions) {
    const tone = toneAt(material, direction, right);
    if (Option.isSome(tone)) possible.add(tone.value);
  }
  return possible;
};

const inspectTriangle = (
  node: SurfaceMesh,
  attributes: GeometryAttributes,
  vertices: Corners,
  normalMatrix: THREE.Matrix3,
  towardCamera: THREE.Vector3,
  theme: Theme,
  inspection: Inspection,
  right: THREE.Vector3,
) => {
  const style = triangleStyle(attributes, vertices, theme);
  if (Option.isNone(style)) {
    inspection.invalid.push(
      `${node.name}: invalid index or interpolated material, surface or light at vertex ${vertices[0]}.`,
    );
    return;
  }
  const point = (vertex: number) =>
    new THREE.Vector3().fromBufferAttribute(attributes.position, vertex).applyMatrix4(node.matrixWorld);
  const a = point(vertices[0]), b = point(vertices[1]), c = point(vertices[2]);
  if ([a, b, c].some(value => !value.toArray().every(Number.isFinite))) {
    inspection.invalid.push(`${node.name}: non-finite position.`);
    return;
  }
  const geometric = b.clone().sub(a).cross(c.clone().sub(a));
  if (geometric.lengthSq() < 1e-20 || geometric.dot(towardCamera) <= 1e-10) return;
  inspection.triangles++;
  const normal = (vertex: number) =>
    new THREE.Vector3().fromBufferAttribute(attributes.normal, vertex).applyMatrix3(normalMatrix).normalize();
  const normals: Normals = [normal(vertices[0]), normal(vertices[1]), normal(vertices[2])];
  if (normals.some(value => !value.toArray().every(Number.isFinite) || value.lengthSq() < .5)) {
    inspection.invalid.push(`${node.name}: invalid normal.`);
    return;
  }
  for (const tone of possibleTones(style.value.material, normals, right)) {
    const key = `${style.value.material}/${tone}/${style.value.lineClass}`;
    const existing = Option.fromUndefinedOr(inspection.faces.get(key));
    if (Option.isSome(existing)) existing.value.samples++;
    else {inspection.faces.set(key, {
        material: style.value.material,
        tone,
        lineClass: style.value.lineClass,
        samples: 1,
      });}
  }
};

const inspectNode = (
  node: THREE.Object3D,
  towardCamera: THREE.Vector3,
  theme: Theme,
  inspection: Inspection,
  right: THREE.Vector3,
) => {
  if (!isAssetMesh(node)) return;
  if (node instanceof THREE.InstancedMesh || node instanceof THREE.SkinnedMesh) {
    inspection.invalid.push(`${node.name}: instances and skinning require their own evaluated geometry.`);
    return;
  }
  const attributes = readAttributes(node, inspection);
  if (Option.isNone(attributes)) return;
  for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
    const properties: ReadonlyArray<unknown> = Object.values(material);
    if (properties.some(value => value instanceof THREE.Texture)) inspection.textures.push(node.name);
    if (material.side !== THREE.FrontSide || material.transparent || material.opacity !== 1) {
      inspection.invalid.push(`${node.name}: visibility preflight requires opaque front-face culling.`);
    }
  }
  const index = Option.fromNullOr(node.geometry.index);
  const count = Option.match(index, { onNone: () => attributes.value.position.count, onSome: value => value.count });
  if (count % 3 !== 0) inspection.invalid.push(`${node.name}: triangle index count is not divisible by three.`);
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(node.matrixWorld);
  const vertex = (offset: number) => Option.match(index, { onNone: () => offset, onSome: value => value.getX(offset) });
  for (let start = 0; start + 2 < count; start += 3) {
    inspectTriangle(
      node,
      attributes.value,
      [vertex(start), vertex(start + 1), vertex(start + 2)],
      normalMatrix,
      towardCamera,
      theme,
      inspection,
      right,
    );
  }
};

export const inspectAssetRules = (input: {
  readonly object: THREE.Object3D;
  readonly camera: THREE.OrthographicCamera;
  readonly palette: Palette;
  readonly theme: Theme;
}): AssetRuleReport => {
  const { object, camera, palette, theme } = input;
  object.updateMatrixWorld(true);
  camera.updateMatrixWorld(true);
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
  const towardCamera = camera.getWorldDirection(new THREE.Vector3()).negate();
  const pitch = Math.asin(towardCamera.y);
  const cameraFailures = Math.abs(pitch - cameraValues.pitchRadians) > 1e-6
      || Math.abs(Math.abs(towardCamera.x) - Math.abs(towardCamera.z)) > 1e-6
    ? ["The supplied camera is not above an isometric quarter-turn corner at the Atlas pitch."]
    : [];
  const inspection: Inspection = { faces: new Map(), invalid: [], textures: [], triangles: 0 };
  object.traverseVisible(node => inspectNode(node, towardCamera, theme, inspection, right));
  const { faces, invalid, textures, triangles } = inspection;
  const observations = [...faces.values()];
  const fills = observations.map(face => {
    const color = palette.colors[face.tone][theme];
    const line = face.lineClass === lineClasses.ordinary ? palette.colors.line[theme] : palette.darkLine[theme];
    return {
      material: face.material,
      tone: face.tone,
      samples: face.samples,
      lineContrast: contrast(color, line),
      groundContrast: contrast(color, palette.colors.ground[theme]),
    };
  });
  const lineFailures = fills.flatMap(face =>
    face.lineContrast < 3
      ? [`${face.tone}: ${face.lineContrast.toFixed(6)}:1, below 3:1.`]
      : []
  );
  if (palette.lineOpacity[theme] !== 1) {
    lineFailures.push("Composited contrast for translucent strokes has not been supplied.");
  }
  const sideFailures = fills.flatMap(face =>
    bodyMaterial(face.material) && /-[012]$/.test(face.tone) && face.groundContrast < 1.25
      ? [`${face.tone}: ${face.groundContrast.toFixed(6)}:1 against ground, below 1.25:1.`]
      : []
  );
  const topFailures = fills.flatMap(face =>
    bodyMaterial(face.material) && face.tone.endsWith("-3")
      && luminance(palette.colors[face.tone][theme]) >= luminance(palette.colors["paper-0"][theme])
      ? [`${face.tone}: top is not darker than paper.`]
      : []
  );
  const bodyEvidence: Array<string> = [], bodyFailures: Array<string> = [];
  for (
    const base of new Set(
      observations.flatMap(face => bodyMaterial(face.material) ? [materialBase(face.material)] : []),
    )
  ) {
    const same = observations.filter(face => materialBase(face.material) === base);
    const top = same.find(face => face.tone.endsWith("-3"));
    const sides = same.filter(face => /-[012]$/.test(face.tone));
    if (!top || sides.length === 0) continue;
    const topColor = palette.colors[top.tone][theme];
    const range = Math.max(...sides.map(face => contrast(topColor, palette.colors[face.tone][theme])));
    bodyEvidence.push(`${base}: potentially visible top/side range ${range.toFixed(6)}:1.`);
    if (range < 2.5) bodyFailures.push(`${base}: potential top/side range ${range.toFixed(6)}:1, below 2.5:1.`);
    if (sides.some(face => luminance(palette.colors[face.tone][theme]) > luminance(topColor))) {
      bodyFailures.push(`${base}: a side is lighter than its top.`);
    }
  }
  const brass = observations.filter(face => /^(brass|engraving)-/.test(face.material));
  const paper = observations.filter(face => face.material.startsWith("paper-"));
  return {
    source: "synthetic",
    visibility: "conservative-front-facing-triangles",
    theme,
    faces: fills,
    checks: [
      check("orthographic-isometric-camera", cameraFailures, [
        `Toward-camera direction ${towardCamera.toArray().join(",")}; pitch ${pitch.toFixed(9)} radians.`,
      ]),
      check(
        "geometry-attributes",
        invalid,
        triangles > 0
          ? [`${triangles} potentially visible triangles; finite authored normals and constant triangle attributes.`]
          : [],
      ),
      check(
        "visible-face-line-contrast",
        lineFailures,
        fills.map(face => `${face.tone}: ${face.lineContrast.toFixed(6)}:1.`),
      ),
      check(
        "visible-side-ground-separation",
        sideFailures,
        fills.flatMap(face =>
          bodyMaterial(face.material) && /-[012]$/.test(face.tone)
            ? [`${face.tone}: ${face.groundContrast.toFixed(6)}:1.`]
            : []
        ),
      ),
      check(
        "tops-darker-than-paper",
        topFailures,
        fills.flatMap(face => bodyMaterial(face.material) && face.tone.endsWith("-3") ? [face.tone] : []),
      ),
      check("body-tone-range", bodyFailures, bodyEvidence),
      check(
        "no-textures",
        textures.map(name => `${name}: unexpected texture; logo exception requires its own review.`),
        triangles > 0 ? ["No texture-valued material properties in the reviewed geometry."] : [],
      ),
      brass.length > 0
        ? check("brass-bindings-and-scales", [
          "This asset-only preflight has no live or labelled synthetic instrument bindings, mounting pairs or tick measurements.",
        ], [])
        : deferred(
          "brass-bindings-and-scales",
          "NotExercised",
          "No brass or engraving; blank screens do not represent prices or measured instruments.",
        ),
      deferred(
        "paper-supports",
        paper.length > 0 ? "Unmeasured" : "NotExercised",
        "Actual contact pairs and depth ordering require the complete scene; the material ramp alone does not establish a paper support.",
      ),
      deferred(
        "raster-lines-and-occlusion",
        "Unmeasured",
        "Normal-cone checks are conservative, not pixel visibility, one-CSS-pixel width, endpoints, antialiasing or a rendered reference comparison.",
      ),
      deferred(
        "composition-and-clearances",
        "Unmeasured",
        "Production design, desk variation, equipment, station count, contacts and clearances need the assembled review views.",
      ),
      deferred(
        "words-logos-and-nameplates",
        "Unmeasured",
        "Blank surfaces reserve sockets; typography, actual decals and physical surface attachment require review when populated.",
      ),
      deferred(
        "interface-motion-and-live-state",
        "NotExercised",
        "Static asset review supplies no interface, motion, live readings, blueprint transitions or activity-state evidence.",
      ),
    ],
  };
};
