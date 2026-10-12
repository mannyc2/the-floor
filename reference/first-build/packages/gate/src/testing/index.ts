import { Data, Effect, Layer, Option, Record } from "effect";
import { DecisionModel } from "effect/ai";
import { calibrationLegend, calibrationReadings, DesignRenderer, DesignRenderError, GateDecisions } from "../review";

const answer = Data.taggedEnum<DecisionModel.ProviderAnswer>();
// Only provider edges are replaced. Callers still use the production structural kernel and native DecisionModel request protocol.
/** @stability unstable */
export const recordedGateEdges = (probability: number) =>
  Layer.mergeAll(
    Layer.succeed(
      DesignRenderer,
      DesignRenderer.of({
        render: design =>
          Effect.succeed({
            image:
              "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
            samples: calibrationReadings(design),
            legend: `${calibrationLegend} Recorded render edge for policy flow tests.`,
          }),
      }),
    ),
    Layer.effect(
      GateDecisions,
      Effect.asSome(DecisionModel.make({
        decide: options =>
          Effect.succeed({
            answers: Record.map(options.decisions, () => answer.Probability({ probability })),
            usage: { inputTokens: 20, outputTokens: 20 },
          }),
      })),
    ),
  );

/** @stability unstable */
export const unavailableGateEdges = Layer.mergeAll(
  Layer.succeed(
    DesignRenderer,
    DesignRenderer.of({
      render: () =>
        Effect.fail(new DesignRenderError({ message: "No visual provider is configured in this fixture." })),
    }),
  ),
  Layer.succeed(GateDecisions, Option.none()),
);
