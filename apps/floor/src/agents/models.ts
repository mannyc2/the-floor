import { AnthropicClient, AnthropicLanguageModel } from "@effect/ai-anthropic";
import { OpenAiClient, OpenAiLanguageModel } from "@effect/ai-openai";
import { Config, Context, Effect, Layer, Schema } from "effect";
import type { LanguageModel } from "effect/ai";
import { FetchHttpClient } from "effect/http";

export class AgentModel extends Context.Service<AgentModel, { // @effect-diagnostics apiStabilityLeak:off -- This internal injection boundary is shared only by the native runtime and its test composition.
  readonly provider: string;
  readonly name: string;
  readonly layer: Layer.Layer<LanguageModel.LanguageModel>;
}>()("@floor/app-floor/agents/AgentModel") {
  static readonly layer = Layer.effect(
    AgentModel,
    Effect.gen(function*() {
      const provider = yield* Config.schema(Schema.Literals(["anthropic", "openai"]), "FLOOR_MODEL_PROVIDER");
      const name = yield* Config.NonEmptyString("FLOOR_MODEL_NAME");
      const layer = provider === "anthropic"
        ? AnthropicLanguageModel.layer({ model: name, config: { max_tokens: 3000 } }).pipe(
          Layer.provide(AnthropicClient.layerConfig({ apiKey: Config.Redacted("ANTHROPIC_API_KEY") })),
        )
        : OpenAiLanguageModel.layer({ model: name, config: { max_output_tokens: 3000 } }).pipe(
          Layer.provide(OpenAiClient.layerConfig({ apiKey: Config.Redacted("OPENAI_API_KEY") })),
        );
      // A missing credential prevents activation; it must never silently switch providers or use a fixture.
      return AgentModel.of({ provider, name, layer: layer.pipe(Layer.provide(FetchHttpClient.layer), Layer.orDie) });
    }),
  );
}
