import { assert, it } from "@effect/vitest";
import { Data, Effect, Layer, Option, Record } from "effect";
import { DecisionModel } from "effect/ai";
import {
  calibrationLegend,
  calibrationReadings,
  DesignRenderer,
  DesignRenderError,
  GateDecisions,
  GateReview,
  lilyPondDesign,
} from "../src/index";

const fit = Option.some({ plinthAvailable: true, maxWidth: 20, maxDepth: 20, overlapsMachine: false });
const answers = Data.taggedEnum<DecisionModel.ProviderAnswer>();
const testRenderer = Layer.succeed(
  DesignRenderer,
  DesignRenderer.of({
    render: design =>
      Effect.succeed({
        image: "https://fixture.invalid/trusted-proof.png",
        samples: calibrationReadings(design),
        legend: calibrationLegend,
      }),
  }),
);
const calibratedModel = (score: number) =>
  Layer.effect(
    GateDecisions,
    Effect.asSome(DecisionModel.make({
      decide: options =>
        Effect.succeed({
          answers: Record.map(options.decisions, () => answers.Probability({ probability: score })),
          usage: { inputTokens: 10, outputTokens: 10 },
        }),
    })),
  );

for (const [score, expected] of [[0.95, "accepted"], [0.65, "review"], [0.39, "rejected"], [1.1, "review"]] as const) {
  it.layer(GateReview.layer.pipe(Layer.provide(testRenderer), Layer.provide(calibratedModel(score))))(
    `native gate probability ${score}`,
    test => {
      test.effect(`produces ${expected} after validated native decisions`, () =>
        Effect.gen(function*() {
          const gate = yield* GateReview;
          const result = yield* gate.review(lilyPondDesign, fit);
          assert.strictEqual(result.status, expected);
          assert.strictEqual(result.checks.find(check => check.name === "Render")?.status, "pass");
          assert.isFalse(result.checks.some(check => check.detail.includes("fixture.invalid")));
        }));
      test.effect("never publishes without authoritative district fit", () =>
        Effect.gen(function*() {
          const gate = yield* GateReview;
          const result = yield* gate.review(lilyPondDesign);
          assert.notStrictEqual(result.status, "accepted");
          assert.strictEqual(result.checks.find(check => check.name === "Fit")?.status, "review");
        }));
    },
  );
}

it.layer(
  GateReview.layer.pipe(
    Layer.provide(GateDecisions.unavailable),
    Layer.provide(Layer.succeed(
      DesignRenderer,
      DesignRenderer.of({
        render: () => Effect.fail(new DesignRenderError({ message: "Trusted renderer disconnected" })),
      }),
    )),
  ),
)("unavailable rendering", test => {
  test.effect("retains the failed stage for steward review", () =>
    Effect.gen(function*() {
      const gate = yield* GateReview;
      const result = yield* gate.review(lilyPondDesign, fit);
      assert.strictEqual(result.status, "review");
      assert.strictEqual(result.checks.find(check => check.name === "Render")?.detail, "Trusted renderer disconnected");
    }));
  test.effect("rejects missing instruments before rendering", () =>
    Effect.gen(function*() {
      const gate = yield* GateReview;
      const result = yield* gate.review({ ...lilyPondDesign, readings: [] }, fit);
      assert.strictEqual(result.status, "rejected");
      assert.isFalse(result.checks.some(check => check.name === "Render"));
    }));
});
