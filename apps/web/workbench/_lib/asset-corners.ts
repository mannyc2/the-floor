import { cameraCorners, cameraValues } from "@floor/atlas/camera";
import { proportionPalette } from "@floor/atlas/materials";
import { Effect } from "effect";
import * as THREE from "three";
import { makePost, makeStation, stationVariants } from "../../src/map/_lib/assets";
import { Rotation } from "../../src/map/model";
import { disposeAsset } from "./asset-mesh";
import { inspectAssetRules } from "./asset-rules";

// The renderer's camera direction at a quarter turn. Only its orientation
// reaches the rules: they read normals and face orientation, not framing.
export const cornerCamera = (rotation: Rotation) => {
  const corner = cameraCorners[rotation];
  const camera = new THREE.OrthographicCamera(-20, 20, 20, -20, .1, 1000);
  camera.position.set(
    cameraValues.horizontalOffset * corner.x,
    cameraValues.verticalOffset,
    cameraValues.horizontalOffset * corner.z,
  );
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  return camera;
};

// Every generated model at every quarter turn, by day and by night.
export const inspectGeneratedAssets = Effect.acquireRelease(
  Effect.sync(() => [makePost(), ...stationVariants.map(makeStation)]),
  objects => Effect.sync(() => objects.forEach(disposeAsset)),
).pipe(
  Effect.map(objects =>
    Rotation.literals.flatMap(quarterTurn =>
      objects.flatMap(object =>
        (["day", "night"] satisfies ReadonlyArray<"day" | "night">).map(theme => ({
          asset: object.name,
          quarterTurn,
          report: inspectAssetRules({ object, camera: cornerCamera(quarterTurn), palette: proportionPalette, theme }),
        }))
      )
    )
  ),
  Effect.scoped,
);
