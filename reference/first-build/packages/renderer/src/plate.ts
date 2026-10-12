import { AtlasSnapshot } from "@floor/surfaces";
import { Schema } from "effect";
import { AtlasEvidence } from "./types";

/** A plate accepts retained observations and typed presentation choices, never client-supplied pixels or executable code. */
export const PlateRenderInput = Schema.Struct({
  snapshot: AtlasSnapshot,
  evidence: AtlasEvidence,
  marketId: Schema.String,
  title: Schema.String.check(Schema.isMaxLength(180)),
  view: Schema.Literals(["archipelago", "island", "district", "works", "machine"]),
});
export type PlateRenderInput = typeof PlateRenderInput.Type;

/** Native Option fields require the canonical JSON codec before crossing a browser fragment. */
export const PlateRenderJson = Schema.fromJsonString(Schema.toCodecJson(PlateRenderInput));
