import { BrowserCrypto } from "@effect/platform-browser";
import { Context, Crypto, Effect, Layer, Option, Order, Schema } from "effect";
import { Hex } from "effect/encoding";
import * as THREE from "three";
import type { Engine } from "./renderer-probe";
import { WorkbenchFailure } from "./runtime";

// Theme and raster settings are separate evidence. Hash authored geometry,
// material/surface assignments and placement without transient interpolation.
export const sourceSceneDescription = (engine: Engine): Schema.Json => {
  const data = engine.diagnosticScene();
  data.scene.updateMatrixWorld(true);
  return {
    source: "synthetic",
    convention: "kit-unit/_SURFACE/_MAT",
    geometries: data.geometries.map((geometry) => ({
      index: Option.match(Option.fromNullOr(geometry.index), {
        onNone: () => [],
        onSome: (index) => Array.from(index.array),
      }),
      attributes: Object.entries(geometry.attributes).filter(([name]) => name !== "_PREVIOUS" && name !== "_NEXT")
        .toSorted(([left], [right]) => Order.String(left, right))
        .map(([name, attribute]) => ({
          name,
          itemSize: attribute.itemSize,
          normalized: attribute.normalized,
          values: Array.from(attribute instanceof THREE.BufferAttribute ? attribute.array : attribute.data.array),
        })),
    })),
    placements: data.meshes.map((mesh) => ({
      visible: mesh.visible,
      geometry: data.geometries.indexOf(mesh.geometry),
      matrix: mesh.matrixWorld.toArray(),
      instances: mesh instanceof THREE.InstancedMesh
        ? Array.from({ length: mesh.count }, (_, index) => {
          const matrix = new THREE.Matrix4();
          mesh.getMatrixAt(index, matrix);
          return matrix.toArray();
        })
        : [],
    })),
    entities: data.entities.map((entity) => ({
      id: entity.id,
      geometry: data.geometries.indexOf(entity.mesh.geometry),
      instance: Option.getOrNull(entity.maybeInstance),
    })),
  };
};

export class SceneDigest extends Context.Service<SceneDigest, {
  readonly bytes: (bytes: Uint8Array) => Effect.Effect<string, WorkbenchFailure>;
}>()("floor/web/workbench/SceneDigest") {
  static readonly layer = Layer.effect(
    SceneDigest,
    Effect.gen(function*() {
      const crypto = yield* Crypto.Crypto;
      return SceneDigest.of({
        bytes: (bytes) =>
          crypto.digest("SHA-256", bytes).pipe(
            Effect.map(Hex.encode),
            Effect.mapError((cause) => new WorkbenchFailure({ operation: "sha256", cause })),
          ),
      });
    }),
  ).pipe(Layer.provide(BrowserCrypto.layer));
}
export const digestBytes = Effect.fn("Workbench.digestBytes")(function*(bytes: Uint8Array) {
  const digest = yield* SceneDigest;
  return yield* digest.bytes(bytes);
});
export const digestJson = Effect.fn("Workbench.digestJson")(function*(value: Schema.Json) {
  const encoded = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Json))(value);
  return yield* digestBytes(new TextEncoder().encode(encoded));
});
export const sceneDigest = (engine: Engine) => digestJson(sourceSceneDescription(engine));
