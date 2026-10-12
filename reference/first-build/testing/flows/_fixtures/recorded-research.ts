import { OpenAiSchema } from "@effect/ai-openai";
import {
  providersLayer,
  ResearchBrowser,
  Researchers,
  researchersLayer,
  ResearchOutput,
  type UntrustedPage,
} from "@floor/agents";
import type { MarketSnapshot } from "@floor/markets/schema";
import { Array, ConfigProvider, Context, Effect, Layer, Redacted, Ref, Schema } from "effect";
import { Supervisor } from "effect-browser";
import { HttpClient, HttpClientError, HttpClientResponse } from "effect/http";

/** @stability unstable */
export class ResearchTrace extends Context.Service<ResearchTrace, {
  readonly requests: Ref.Ref<readonly OpenAiSchema.CreateResponse[]>;
  readonly released: Ref.Ref<boolean>;
  readonly readUrls: Ref.Ref<readonly string[]>;
}>()("flow/ResearchTrace") {}

export interface RecordedResearch {
  readonly snapshot: MarketSnapshot;
  readonly page: UntrustedPage;
  readonly output: typeof ResearchOutput.Type;
}

const eventJson = Schema.fromJsonString(OpenAiSchema.ResponseStreamEvent);
const toolArguments = Schema.fromJsonString(Schema.Record(Schema.String, Schema.String));
const modelResponse = (id: string, output: OpenAiSchema.Response["output"]): OpenAiSchema.Response => ({
  id,
  object: "response",
  model: "recorded-model",
  created_at: 1_791_676_800,
  output,
  usage: { input_tokens: 100, output_tokens: 100, total_tokens: 200 },
});

const makeRecordedEdges = ({ snapshot, page, output }: RecordedResearch) =>
  Effect.gen(function*() {
    const market = yield* Effect.fromOption(Array.head(snapshot.markets));
    const requests = yield* Ref.make<readonly OpenAiSchema.CreateResponse[]>([]);
    const released = yield* Ref.make(false);
    const readUrls = yield* Ref.make<readonly string[]>([]);
    const readMarket = {
      id: "tool-market",
      type: "function_call" as const,
      call_id: "call-market",
      name: "ReadMarket",
      arguments: yield* Schema.encodeEffect(toolArguments)({ marketId: market.id }),
      status: "completed" as const,
    };
    const readPage = {
      id: "tool-page",
      type: "function_call" as const,
      call_id: "call-page",
      name: "ReadPage",
      arguments: yield* Schema.encodeEffect(toolArguments)({ url: page.url }),
      status: "completed" as const,
    };
    const answer = yield* Schema.encodeEffect(Schema.fromJsonString(ResearchOutput))(output);
    const message = {
      id: "message-answer",
      type: "message" as const,
      role: "assistant" as const,
      status: "completed" as const,
      content: [{ type: "output_text" as const, text: answer, annotations: [] }],
    };
    const toolEvents: readonly OpenAiSchema.ResponseStreamEvent[] = [
      { type: "response.created", response: modelResponse("response-tools", []) },
      ...[readMarket, readPage].flatMap((item, output_index): readonly OpenAiSchema.ResponseStreamEvent[] => [
        { type: "response.output_item.added", output_index, item },
        { type: "response.function_call_arguments.delta", output_index, item_id: item.id, delta: item.arguments },
        { type: "response.function_call_arguments.done", output_index, item_id: item.id, arguments: item.arguments },
        { type: "response.output_item.done", output_index, item },
      ]),
      { type: "response.completed", response: modelResponse("response-tools", [readMarket, readPage]) },
    ];
    const answerEvents: readonly OpenAiSchema.ResponseStreamEvent[] = [
      { type: "response.created", response: modelResponse("response-answer", []) },
      { type: "response.output_item.added", output_index: 0, item: message },
      { type: "response.output_text.delta", output_index: 0, content_index: 0, item_id: message.id, delta: answer },
      { type: "response.output_item.done", output_index: 0, item: message },
      { type: "response.completed", response: modelResponse("response-answer", [message]) },
    ];
    const responses = yield* Effect.forEach(
      [toolEvents, answerEvents],
      events =>
        Effect.forEach(events, event => Schema.encodeEffect(eventJson)(event)).pipe(
          Effect.map(encoded => encoded.map(data => `data: ${data}\n\n`).join("")),
        ),
    );
    const client = HttpClient.make(
      Effect.fn("RecordedOpenAi.request")(function*(request) {
        const transportFailure = () =>
          new HttpClientError.HttpClientError({
            reason: new HttpClientError.TransportError({
              request,
              description: "Recorded model exchange is exhausted or invalid.",
            }),
          });
        if (request.body._tag !== "Uint8Array") return yield* transportFailure();
        const payload = yield* Schema.decodeEffect(Schema.fromJsonString(OpenAiSchema.CreateResponse))(
          new TextDecoder().decode(request.body.body),
        ).pipe(Effect.mapError(transportFailure));
        const index = yield* Ref.modify(requests, current => [current.length, [...current, payload]] as const);
        const response = yield* Effect.fromOption(Array.get(responses, index)).pipe(Effect.mapError(transportFailure));
        return HttpClientResponse.fromWeb(
          request,
          new Response(response, { headers: { "content-type": "text/event-stream" } }),
        );
      }),
    );
    const browser = ResearchBrowser.of({
      open: Effect.succeedSome({
        sessionId: "recorded-browser",
        liveViewUrl: Redacted.make("https://example.com/owner-live-view"),
        read: url => Ref.update(readUrls, urls => [...urls, url]).pipe(Effect.as(page)),
        release: Ref.set(released, true).pipe(Effect.as(new Supervisor.Settled())),
      }),
    });
    return Context.make(HttpClient.HttpClient, client).pipe(
      Context.add(ResearchBrowser, browser),
      Context.add(ResearchTrace, { requests, released, readUrls }),
    );
  });

// Select only research capabilities so this model fixture cannot accidentally replace a real signing HTTP client.
/** @stability unstable */
export const recordedResearchers = (fixture: RecordedResearch) =>
  Layer.effectContext(
    Layer.build(researchersLayer.pipe(
      Layer.provideMerge(Layer.effectContext(makeRecordedEdges(fixture))),
      Layer.provide(providersLayer),
      Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({
        OPENAI_API_KEY: "recorded-provider-key",
        INFERENCE_MODEL: "recorded-model",
        INFERENCE_INPUT_USD_PER_MILLION: "1",
        INFERENCE_OUTPUT_USD_PER_MILLION: "5",
      }))),
    )).pipe(Effect.map(Context.pick(Researchers, ResearchTrace))),
  );
