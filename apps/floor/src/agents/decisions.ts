import { Config, Context, Data, Effect, Layer, Option, Record, Schema } from "effect";
import { AiError, Decision, DecisionModel } from "effect/ai";
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";

const Probability = Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 }));
const QuestionName = Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9_-]{1,64}$/));
const Image = Schema.Struct({
  mediaType: Schema.Literals(["image/png", "image/jpeg", "image/webp"]),
  base64: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9+/]+={0,2}$/), Schema.isMaxLength(2_000_000)),
});
export class PredicateRequest extends Schema.Class<PredicateRequest>("PredicateRequest")({
  evidence: Schema.NonEmptyString.check(Schema.isMaxLength(64_000)),
  questions: Schema.Array(Schema.Struct({
    name: QuestionName,
    instructions: Schema.NonEmptyString.check(Schema.isMaxLength(4000)),
  })).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(16),
    // Decisions are keyed by name, so a repeated name would silently drop a question.
    Schema.makeFilter(
      (questions: ReadonlyArray<{ readonly name: string }>) =>
        new Set(questions.map((question) => question.name)).size === questions.length,
      {
        expected: "unique question names",
      },
    ),
  ),
  images: Schema.Array(Image).check(Schema.isMaxLength(2)),
}) {}
export class DecisionFailure extends Schema.TaggedError<DecisionFailure>()("DecisionFailure", {
  reason: Schema.Literals(["input", "provider"]),
  message: Schema.String,
  cause: Schema.Defect(),
}) {}

const RequestBody = Schema.Struct({
  model: Schema.Literal("gpt-6-luna"),
  input: Schema.Array(Schema.Struct({
    role: Schema.Literal("user"),
    content: Schema.Array(Schema.Union([
      Schema.Struct({ type: Schema.Literal("input_text"), text: Schema.String }),
      Schema.Struct({ type: Schema.Literal("input_image"), image_url: Schema.String }),
    ])),
  })),
  questions: Schema.Array(Schema.Struct({
    type: Schema.Literal("predicate"),
    name: Schema.String,
    instructions: Schema.String,
  })),
});
const ResponseBody = Schema.Struct({
  answers: Schema.Array(Schema.Union([
    Schema.Struct({ type: Schema.Literal("predicate"), name: Schema.String, probability: Probability }),
    Schema.Struct({ type: Schema.Literal("refusal"), name: Schema.String }),
  ])),
});
// Provider-neutral reasons retain their classification while preserving the original failure for diagnosis.
class DecisionInputError extends AiError.InvalidUserInputError.extend<DecisionInputError>("DecisionInputError")({
  cause: Schema.optional(Schema.Defect()),
}) {}
class DecisionOutputError extends AiError.InvalidOutputError.extend<DecisionOutputError>("DecisionOutputError")({
  cause: Schema.optional(Schema.Defect()),
}) {}
class DecisionCredentialError
  extends AiError.AuthenticationError.extend<DecisionCredentialError>("DecisionCredentialError")({
    cause: Schema.Defect(),
  })
{}
const invalidInput = (description: string, cause?: unknown) =>
  AiError.make({
    module: "FloorDecisions",
    method: "decide",
    reason: new DecisionInputError({ description, cause }),
  });
const invalidOutput = (description: string, cause?: unknown) =>
  AiError.make({
    module: "FloorDecisions",
    method: "decide",
    reason: new DecisionOutputError({ description, cause }),
  });
const answer = Data.taggedEnum<DecisionModel.ProviderAnswer>();

// The installed provider package has no Decisions adapter. This bounded adapter uses the dedicated endpoint;
// it deliberately rejects choice/rating requests until their wire mapping and validation are implemented.
const DecisionsAdapter = Layer.effect(
  DecisionModel.DecisionModel,
  Effect.gen(function*() {
    const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);
    return yield* DecisionModel.make({
      supportsImages: true,
      decide: Effect.fn("FloorDecisions.decide")(function*(options) {
        if (
          Object.values(options.decisions).some((decision) =>
            decision._tag !== "Probability" || Option.isSome(Option.fromNullishOr(decision.criteria))
          )
        ) {
          return yield* invalidInput("Only predicate questions without custom criteria are implemented.");
        }
        const text = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Json))(options.state).pipe(
          Effect.mapError(cause => invalidInput("Decision evidence could not be encoded.", cause)),
        );
        const images = yield* Effect.forEach(
          options.images ?? [],
          (image) =>
            Schema.decodeUnknownEffect(Image)({ mediaType: image.mediaType, base64: image.data }).pipe(
              Effect.mapError(cause =>
                invalidInput(
                  "Decisions images must be bounded inline base64; URL and file inputs are unsupported.",
                  cause,
                )
              ),
            ),
        );
        const key = yield* Config.Redacted("OPENAI_API_KEY").pipe(
          Effect.mapError(cause =>
            AiError.make({
              module: "FloorDecisions",
              method: "decide",
              reason: new DecisionCredentialError({ kind: "MissingKey", cause }),
            })
          ),
        );
        const request = yield* HttpClientRequest.schemaBodyJson(RequestBody)(
          HttpClientRequest.post("https://api.openai.com/v1/decisions").pipe(HttpClientRequest.bearerToken(key)),
          {
            model: "gpt-6-luna",
            input: [{
              role: "user",
              content: [
                { type: "input_text", text },
                ...images.map((image) => ({
                  type: "input_image" as const,
                  image_url: `data:${image.mediaType};base64,${image.base64}`,
                })),
              ],
            }],
            questions: Object.entries(options.decisions).map(([name, decision]) => ({
              type: "predicate",
              name,
              instructions: decision.instructions,
            })),
          },
        ).pipe(Effect.mapError(cause => invalidInput("Decision request could not be encoded.", cause)));
        const response = yield* client.execute(request).pipe(
          Effect.flatMap(HttpClientResponse.schemaBodyJson(ResponseBody)),
          Effect.timeout("20 seconds"),
          Effect.mapError(cause =>
            invalidOutput("The Decisions provider failed or returned an invalid response.", cause)
          ),
        );
        const names = response.answers.map((item) => item.name);
        // DecisionModel.make rejects missing answers but ignores repeated and unrequested ones.
        if (new Set(names).size !== names.length || names.some((name) => !Object.hasOwn(options.decisions, name))) {
          return yield* invalidOutput("Decision answers must match the requested names exactly once.");
        }
        const entries = yield* Effect.forEach(response.answers, (item) =>
          item.type === "refusal"
            ? Effect.fail(invalidOutput("The Decisions provider refused a question."))
            : Effect.succeed([item.name, answer.Probability({ probability: item.probability })] as const));
        // Token-usage mapping is not yet implemented; usage stays unknown rather than inventing zero.
        // oxlint-disable-next-line effect/noNullish -- DecisionModel's provider contract requires undefined for unreported usage.
        return { answers: Record.fromEntries(entries), usage: { inputTokens: undefined, outputTokens: undefined } };
      }),
    });
  }),
);

export class Decisions extends Context.Service<Decisions, {
  readonly evaluate: (request: PredicateRequest) => Effect.Effect<Readonly<Record<string, number>>, DecisionFailure>;
}>()("@floor/app-floor/agents/Decisions") {
  static readonly layer: Layer.Layer<Decisions> = Layer.effect(
    Decisions,
    Effect.gen(function*() {
      const model = yield* DecisionModel.DecisionModel;
      return Decisions.of({
        evaluate: Effect.fn("Decisions.evaluate")(function*(request) {
          const definition = Decision.make({
            input: Schema.String,
            decisions: Record.fromEntries(
              request.questions.map((
                question,
              ) => [question.name, Decision.probability({ instructions: question.instructions })]),
            ),
          });
          const response = yield* model.decide(definition, {
            input: request.evidence,
            images: request.images.map((image) => ({ mediaType: image.mediaType, data: image.base64 })),
          }).pipe(Effect.mapError(cause =>
            new DecisionFailure({
              reason: cause.reason._tag === "InvalidUserInputError" ? "input" : "provider",
              message: cause.message,
              cause,
            })
          ));
          return Record.map(response.answers, (item) => item.probability);
        }),
      });
    }),
  ).pipe(Layer.provide(DecisionsAdapter), Layer.provide(FetchHttpClient.layer));
}
