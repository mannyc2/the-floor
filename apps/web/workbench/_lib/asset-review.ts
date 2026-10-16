import { PaletteName, proportionPalette } from "@floor/atlas/materials";
import { figureHeight, roomyRecipe, studyLayout } from "@floor/atlas/proportions";
import { Effect, Option, Order, Schema } from "effect";
import * as THREE from "three";
import { makePost, makeStation } from "../../src/map/_lib/assets";
import type { Engine } from "../renderer-probe";
import { WorkbenchFailure } from "../runtime";
import { disposeAsset, isAssetMesh } from "./asset-mesh";
import { assetCamera, type AssetReview } from "./asset-review-model";
import { assetFaceStyle, inspectAssetRules } from "./asset-rules";
import { figureParts } from "./proportion-figure";
import { box, createProportionGeometry, type Point, type ProportionGeometry } from "./proportion-geometry";

const isWorkbenchFailure = Schema.is(WorkbenchFailure);
const isStationName = Schema.is(Schema.String.check(Schema.isPattern(/^station_[0-9]{2}$/)));
const isStationPlacement = Schema.is(Schema.Struct({ placement: Schema.Struct({ kind: Schema.Literal("station") }) }));
const isFigureSocket = Schema.is(Schema.Struct({ socket: Schema.Struct({ kind: Schema.Literal("figure") }) }));

const generate = (make: () => THREE.Group) =>
  Effect.acquireRelease(Effect.sync(make), group => Effect.sync(() => disposeAsset(group)));

const stationPlacements = (post: THREE.Group) => {
  const placements: Array<THREE.Object3D> = [];
  post.updateMatrixWorld(true);
  post.traverse(node => {
    if (!isStationName(node.name)) return;
    const extras: unknown = node.userData;
    placements.push(Option.getOrThrowWith(
      isStationPlacement(extras) && !isAssetMesh(node) ? Option.some(node) : Option.none(),
      () => new WorkbenchFailure({ operation: "asset-station-placement", cause: { node: node.name, extras } }),
    ));
  });
  const names = new Set(placements.map(node => node.name));
  return Option.getOrThrowWith(
    placements.length > 0 && names.size === placements.length ? Option.some(placements) : Option.none(),
    () =>
      new WorkbenchFailure({ operation: "asset-station-placement", cause: "Missing or duplicate station placements" }),
  ).toSorted((left, right) => Order.String(left.name, right.name));
};

const figureSocket = (station: THREE.Group) => {
  const node = Option.getOrThrowWith(
    Option.fromUndefinedOr(station.getObjectByName("figure")),
    () => new WorkbenchFailure({ operation: "asset-figure-socket", cause: "Figure socket is absent" }),
  );
  const extras: unknown = node.userData;
  return Option.getOrThrowWith(
    isFigureSocket(extras) && !isAssetMesh(node) ? Option.some(node) : Option.none(),
    () => new WorkbenchFailure({ operation: "asset-figure-socket", cause: { node: node.name, extras } }),
  );
};

const styleGeometry = (geometry: THREE.BufferGeometry, night: boolean, entity: number) => {
  const count = geometry.getAttribute("position").count;
  const values = (value: number) => new THREE.BufferAttribute(new Float32Array(count).fill(value), 1);
  const mat = geometry.getAttribute("_MAT"), light = geometry.getAttribute("_LIGHT");
  const palette = new Float32Array(count), lines = new Float32Array(count);
  for (let index = 0; index < count; index++) {
    const base = mat.getX(index), emission = light.getX(index);
    const style = Option.getOrThrowWith(
      assetFaceStyle(base, emission, night ? "night" : "day"),
      () => new WorkbenchFailure({ operation: "asset-material", cause: base }),
    );
    palette[index] = PaletteName.literals.indexOf(style.material);
    lines[index] = style.lineClass;
  }
  geometry.setAttribute("_MAT", new THREE.BufferAttribute(palette, 1));
  geometry.setAttribute("_LINE", new THREE.BufferAttribute(lines, 1));
  geometry.setAttribute("_ENTITY", values(entity));
  geometry.setAttribute("_PALETTE", values(-1));
  for (const attribute of ["_ANIMATED", "_PREVIOUS", "_NEXT"]) geometry.setAttribute(attribute, values(0));
};

const createInstaller = (engine: Engine, night: boolean) => {
  const data = engine.diagnosticScene();
  const material = Option.getOrThrowWith(
    Option.fromUndefinedOr(data.meshes[0]?.material),
    () => new WorkbenchFailure({ operation: "asset-review", cause: "Surface material absent" }),
  );
  let entity = 3000;
  return (source: THREE.Group, transform: THREE.Matrix4, name: string) => {
    const instance = source.clone(true);
    instance.applyMatrix4(transform);
    instance.updateMatrixWorld(true);
    instance.traverse(object => {
      if (!isAssetMesh(object)) return;
      // Cloned nodes share the generated geometry; bake a private world-space copy.
      const geometry = object.geometry.clone().applyMatrix4(object.matrixWorld);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = name;
      // Registration precedes style and rules: a rejected mesh still releases
      // its baked buffers when this Engine's scope ends.
      engine.onDispose(() => {
        mesh.removeFromParent();
        geometry.dispose();
      });
      styleGeometry(geometry, night, entity);
      const report = inspectAssetRules({
        object: mesh,
        camera: data.camera,
        palette: proportionPalette,
        theme: night ? "night" : "day",
      });
      const failures = report.checks.filter(check => check.status === "Failed");
      Option.getOrThrowWith(
        failures.length === 0 ? Option.some(true) : Option.none(),
        () => new WorkbenchFailure({ operation: "asset-rules", cause: { name, failures } }),
      );
      data.scene.add(mesh);
      data.meshes.push(mesh);
      data.geometries.push(geometry);
      data.entities.push({ id: entity++, mesh, maybeInstance: Option.none() });
    });
    return instance;
  };
};
type Installer = ReturnType<typeof createInstaller>;

const installFigure = (builder: ProportionGeometry, station: THREE.Group, postIndex: number, index: number) => {
  const attachment = figureSocket(station);
  // The socket owns position and orientation. Full matrix application also
  // respects future authored parent transforms without restating a stance radius.
  const parts = figureParts(
    roomyRecipe,
    index % 3 === 0 ? "phone" : "standing",
    index % 2 === 0 ? "jacket-blue-0" : "jacket-green-0",
  ).map(({ geometry, slot }) => ({
    geometry: geometry.scale(figureHeight, figureHeight, figureHeight).applyMatrix4(attachment.matrixWorld),
    slot,
  }));
  builder.add(`asset-review-figure-${postIndex}-${index}`, parts, [0, 0, 0], 0, 1, true);
};

interface ReviewModels {
  readonly post: THREE.Group;
  readonly primary: THREE.Group;
  readonly secondary: THREE.Group;
}
const installPost = (
  install: Installer,
  builder: ProportionGeometry,
  models: ReviewModels,
  centre: Point,
  postIndex: number,
) => {
  const instance = install(models.post, new THREE.Matrix4().makeTranslation(...centre), `asset_post_${postIndex}`);
  stationPlacements(instance).forEach((placement, index) => {
    const source = (index + postIndex) % 2 === 0 ? models.primary : models.secondary;
    const station = install(source, placement.matrixWorld, `asset_station_${postIndex}_${index}`);
    installFigure(builder, station, postIndex, index);
  });
};

const installDesk = (install: Installer, models: ReviewModels) => {
  const front = Option.getOrThrowWith(
    Option.fromUndefinedOr(stationPlacements(models.post)[0]),
    () => new WorkbenchFailure({ operation: "asset-desk-support", cause: "Front station placement is absent" }),
  );
  // Inverting the authored front placement brings that workstation to origin;
  // its support follows the same placement instead of a second radius constant.
  const support = install(models.post, front.matrixWorld.clone().invert(), "asset_desk_support");
  const placement = Option.getOrThrowWith(
    Option.fromUndefinedOr(support.getObjectByName(front.name)),
    () => new WorkbenchFailure({ operation: "asset-desk-support", cause: front.name }),
  );
  install(models.primary, placement.matrixWorld, "asset_desk");
};

const assembleReview = (engine: Engine, review: AssetReview, night: boolean, models: ReviewModels) => {
  const data = engine.diagnosticScene();
  const builder = Option.getOrThrowWith(
    createProportionGeometry(engine, night),
    () => new WorkbenchFailure({ operation: "asset-floor", cause: "Surface material absent" }),
  );
  const install = createInstaller(engine, night);
  data.meshes.forEach(mesh => {
    mesh.visible = false;
  });
  data.scene.name = "synthetic-asset-review";
  const floorSize = review.view === "floor" ? 72 : review.view === "desk" ? 48 : 36;
  builder.add("asset-review-floor", [
    box(floorSize, studyLayout.floorThickness, floorSize, 0, studyLayout.floorCentreY, 0, "floor-0"),
  ]);
  // The rules run at the capture camera, so it is set before installation.
  engine.setCamera(assetCamera(review));
  if (review.view === "desk") installDesk(install, models);
  else if (review.view === "post") installPost(install, builder, models, [0, 0, 0], 0);
  else {
    const pitch = roomyRecipe.postPitchRatio * figureHeight;
    installPost(install, builder, models, [-.5 * pitch, 0, .288675 * pitch], 0);
    installPost(install, builder, models, [.5 * pitch, 0, .288675 * pitch], 1);
    installPost(install, builder, models, [0, 0, -.57735 * pitch], 2);
  }
  engine.setPalette(proportionPalette);
  engine.canvas.setAttribute("aria-label", "Generated asset review; synthetic figures, blank screens");
  data.scene.updateMatrixWorld(true);
};

export const installAssetReview = Effect.fn("Workbench.installAssetReview")(function*(
  engine: Engine,
  review: AssetReview,
  night: boolean,
) {
  const post = yield* generate(makePost);
  const operator = yield* generate(() => makeStation("operator"));
  const analyst = yield* generate(() => makeStation("analyst"));
  const models = {
    post,
    primary: review.variant === "operator" ? operator : analyst,
    secondary: review.variant === "operator" ? analyst : operator,
  };
  yield* Effect.try({
    try: () => assembleReview(engine, review, night, models),
    catch: cause =>
      isWorkbenchFailure(cause) ? cause : new WorkbenchFailure({ operation: "asset-review-install", cause }),
  });
  yield* Effect.logInfo("Generated asset review installed", { ...review, theme: night ? "night" : "day" });
}, Effect.scoped);
