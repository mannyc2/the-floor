import { materialPalette, proportionPalette } from "@floor/atlas/materials";
import { Effect, Option, Schema } from "effect";
import { type Camera, Rotation } from "../../src/map/model";
import type { Engine } from "../renderer-probe";
import { installMaterialScene } from "./material-scene";
import { installProportionScene, proportionCamera } from "./proportion-scene";

// The scenes behind the owner-picked renderer frames. A frame's brief names
// its view; other quarter turns render the same scene for corner checks.
export const ReferenceScene = Schema.Struct({
  view: Schema.Literals(["materials", "post", "floor", "cast", "readability"]),
  rotation: Rotation,
});
export type ReferenceScene = typeof ReferenceScene.Type;

export const readReferenceScene = Effect.fn("Workbench.readReferenceScene")(function*(query: URLSearchParams) {
  const encoded = Option.fromNullOr(query.get("reference"));
  return Option.isNone(encoded)
    ? Option.none<ReferenceScene>()
    : Option.some(yield* Schema.decodeEffect(Schema.fromJsonString(ReferenceScene))(encoded.value));
});

export const referenceCamera = (scene: ReferenceScene, height: number): Camera => ({
  ...(scene.view === "materials" ? { x: 0, z: 0, extent: 14 } : proportionCamera(scene.view, height)),
  rotation: scene.rotation,
});

export const referencePalette = (scene: ReferenceScene) =>
  scene.view === "materials" ? materialPalette : proportionPalette;

export const installReferenceScene = (engine: Engine, scene: ReferenceScene, night: boolean) =>
  scene.view === "materials"
    ? installMaterialScene(engine, night)
    : installProportionScene(engine, scene.view, night);
