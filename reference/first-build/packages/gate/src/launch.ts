import { Design, unillustratedPart } from "@floor/contract";
import { Context, DateTime, Effect, Layer, Option, Schema } from "effect";
import { evaluateDesignGate, type FitContext } from "./checks";
import { GateImage, GateReview, LaunchContent } from "./review";

export const LaunchGateResult = Schema.Struct({
  version: Schema.Literal("launch-gate-v1"),
  status: Schema.Literals(["accepted", "rejected", "review"]),
  design: Design,
  checks: Schema.Array(Schema.Struct({
    name: Schema.String,
    status: Schema.Literals(["pass", "fail", "review"]),
    detail: Schema.String,
  })),
  image: Schema.OptionFromNullOr(GateImage),
  probabilities: Schema.Record(Schema.String, Schema.Finite),
  reviewedAt: Schema.String,
});
export type LaunchGateResult = typeof LaunchGateResult.Type;

// New tokens use this world-owned template. A submitter cannot smuggle custom geometry or a false reading into a cast.
// Its works-scale proof exercises every protected instrument; the atlas may collapse this shared geometry to a stall.
export const launchDesign = (content: LaunchContent): Design => ({
  id: `launch:${content.launch.launchId}`,
  tokenId: `launch:${content.launch.launchId}`,
  name: `${content.launch.name} (${content.launch.symbol})`,
  kind: "bonding-curve",
  tier: "works",
  parts: [
    unillustratedPart({ id: "base", kit: "base", material: "steel", position: [0, 0, 0], size: [10, 0.8, 5] }),
    unillustratedPart({ id: "track", kit: "track", material: "steel", position: [-3, 2, 0], size: [1, 4, 1] }),
    unillustratedPart({ id: "price", kit: "sign", material: "paper", position: [0, 2, 0], size: [2, 2, 0.5] }),
    unillustratedPart({ id: "flow", kit: "pipe", material: "steel", position: [3, 2, 0], size: [2, 1, 1] }),
    unillustratedPart({ id: "paper", kit: "cylinder", material: "paper", position: [0, 1, 2], size: [2, 2, 1] }),
  ],
  readings: [
    { reading: "progress", instrument: "graduation-track", partId: "track" },
    { reading: "price", instrument: "arc", partId: "price" },
    { reading: "trades", instrument: "pour", partId: "flow" },
    { reading: "history", instrument: "tide-gauge", partId: "paper" },
  ],
  drivers: [],
  behaviours: [],
  texturePixels: 0,
  bounds: { width: 10, depth: 5, height: 5 },
});

// A cast reviews an isolated foundry mold, not a claim to an occupied community plinth.
const mold: FitContext = { plinthAvailable: true, maxWidth: 10, maxDepth: 5, overlapsMachine: false };

/** @stability unstable */
export class LaunchGate extends Context.Service<LaunchGate, {
  review(content: LaunchContent): Effect.Effect<LaunchGateResult>;
}>()("floor/LaunchGate") {
  static readonly layer = Layer.effect(
    LaunchGate,
    Effect.gen(function*() {
      const gate = yield* GateReview;
      return LaunchGate.of({
        review: Effect.fn("LaunchGate.review")(function*(content) {
          const design = launchDesign(content);
          const inspected = yield* gate.inspect(design, Option.some(mold), Option.some(content)).pipe(
            Effect.timeoutOrElse({
              duration: "10 seconds",
              orElse: () =>
                Effect.succeed({
                  result: {
                    ...evaluateDesignGate(design, Option.none(), Option.some(mold)),
                    checks: [{
                      name: "Review deadline",
                      status: "review" as const,
                      detail: "Launch review exceeded ten seconds; no casting permission was granted.",
                    }],
                  },
                  image: Option.none<GateImage>(),
                  probabilities: {},
                }),
            }),
          );
          return {
            version: "launch-gate-v1",
            ...inspected.result,
            image: inspected.image,
            probabilities: inspected.probabilities,
            reviewedAt: DateTime.formatIso(yield* DateTime.now),
          };
        }),
      });
    }),
  );
}
