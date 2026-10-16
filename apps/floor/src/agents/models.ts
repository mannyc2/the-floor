import { OpenAiClient, OpenAiLanguageModel } from "@effect/ai-openai";
import { Config, Context, Effect, Layer } from "effect";
import type { LanguageModel } from "effect/ai";
import { FetchHttpClient } from "effect/http";

export class AgentModel extends Context.Service<AgentModel, { // @effect-diagnostics apiStabilityLeak:off -- This internal injection boundary is shared only by the native runtime and its test composition.
  readonly provider: string;
  readonly name: string;
  readonly layer: Layer.Layer<LanguageModel.LanguageModel>;
}>()("@floor/app-floor/agents/AgentModel") {
  // The Floor infers through OpenAI only. Each provider is its own AgentModel Layer, so a change is a Layer swap.
  static readonly layer = Layer.effect(
    AgentModel,
    Effect.gen(function*() {
      const name = yield* Config.NonEmptyString("FLOOR_MODEL_NAME");
      const layer = OpenAiLanguageModel.layer({ model: name, config: { max_output_tokens: 3000 } }).pipe(
        Layer.provide(OpenAiClient.layerConfig({ apiKey: Config.Redacted("OPENAI_API_KEY") })),
      );
      // A missing credential prevents activation; it must never silently switch providers or use a fixture.
      return AgentModel.of({
        provider: "openai",
        name,
        layer: layer.pipe(Layer.provide(FetchHttpClient.layer), Layer.orDie),
      });
    }),
  );
}
