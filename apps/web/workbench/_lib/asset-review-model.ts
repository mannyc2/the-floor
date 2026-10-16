import { Effect, Option, Schema } from "effect";
import type { Camera } from "../../src/map/model";

export const AssetReview = Schema.Struct({
  variant: Schema.Literals(["operator", "analyst"]),
  view: Schema.Literals(["post", "floor", "desk"]),
});
export type AssetReview = typeof AssetReview.Type;
export const readAssetReview = Effect.fn("Workbench.readAssetReview")(function*(query: URLSearchParams) {
  const encoded = Option.fromNullOr(query.get("assets"));
  return Option.isNone(encoded)
    ? Option.none<AssetReview>()
    : Option.some(yield* Schema.decodeEffect(Schema.fromJsonString(AssetReview))(encoded.value));
});
export const assetCamera = (review: AssetReview): Camera => ({
  x: review.view === "desk" ? -7 : 0,
  z: review.view === "desk" ? -8.5 : 0,
  rotation: 0,
  extent: review.view === "floor" ? 78 : review.view === "post" ? 36 : 12,
});
