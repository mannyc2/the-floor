import { ProposalSeed } from "@floor/world/proposal";
import { Schema } from "effect";

export { ProposalSeed };

// Occupied floors in the development world. Ten default floors are the most
// the viewer's 4,085-desk identity channel draws.
export const DevWorldFloors = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 10 }));
export const DevWorldMetadata = Schema.Struct({
  world: Schema.NonEmptyString,
  chain: Schema.NonEmptyString,
  seed: Schema.Int,
  floors: DevWorldFloors,
  urls: Schema.Struct({ proposal: Schema.NonEmptyString, grid: Schema.NonEmptyString }),
});
export const DevWorldMetadataJson = Schema.fromJsonString(DevWorldMetadata);
