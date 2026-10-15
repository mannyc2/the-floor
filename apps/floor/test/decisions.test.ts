import { Decisions, PredicateRequest } from "@floor/app-floor/testing";
import * as Test from "alchemy/Test/Bun";
import { expect } from "bun:test";
import { ConfigProvider, Effect, Exit, Layer, Schema } from "effect";
import { AiError } from "effect/ai";
import { FetchHttpClient, HttpClientError } from "effect/http";

const { test } = Test.make({ providers: Layer.empty, dev: true, sidecar: false });
const WireRequest = Schema.Struct({
  model: Schema.String,
  questions: Schema.Array(Schema.Struct({ type: Schema.String, name: Schema.String, instructions: Schema.String })),
  input: Schema.Array(Schema.Struct({ role: Schema.String, content: Schema.Array(Schema.Json) })),
});
const input = PredicateRequest.make({
  evidence: "The price is 5 SOL.",
  questions: [{ name: "price_readable", instructions: "Can the price be read?" }],
  images: [{ mediaType: "image/png", base64: "AQID" }],
});
const makeHarness = (reply: Schema.Json, status = 200, configured = true) => {
  const calls: Array<{ readonly url: string; readonly method: string; readonly body: typeof WireRequest.Type }> = [];
  const fetch = FetchHttpClient.Fetch.of(Object.assign(
    (request: Parameters<typeof globalThis.fetch>[0], init?: Parameters<typeof globalThis.fetch>[1]) =>
      Effect.runPromise(Effect.gen(function*() {
        const received = request instanceof Request ? new Request(request, init) : new Request(String(request), init);
        const body = yield* Effect.promise(() => received.text()).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(WireRequest))),
        );
        calls.push({ url: received.url, method: received.method, body });
        return new Response(yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Json))(reply), {
          status,
          headers: { "content-type": "application/json" },
        });
      })),
    { preconnect: () => {} },
  ));
  const layer = Decisions.layer.pipe(Layer.provideMerge(Layer.mergeAll(
    Layer.succeed(FetchHttpClient.Fetch, fetch),
    ConfigProvider.layer(ConfigProvider.fromUnknown(configured ? { OPENAI_API_KEY: "local-test-key" } : {})),
  )));
  return { calls, layer };
};

const testWithHarness = <E>(
  name: string,
  harness: ReturnType<typeof makeHarness>,
  effect: Effect.Effect<void, E, Decisions>,
) => test(name, effect.pipe(Effect.provide(harness.layer)));

const success = makeHarness({ answers: [{ type: "predicate", name: "price_readable", probability: 0.92 }] });
testWithHarness(
  "predicate adapter uses the dedicated endpoint and inline image wire format",
  success,
  Effect.gen(function*() {
    const result = yield* (yield* Decisions).evaluate(input);
    expect(result).toEqual({ price_readable: 0.92 });
    expect(success.calls).toEqual([{
      url: "https://api.openai.com/v1/decisions",
      method: "POST",
      body: {
        model: "gpt-6-luna",
        questions: [{ type: "predicate", name: "price_readable", instructions: "Can the price be read?" }],
        input: [{
          role: "user",
          content: [
            { type: "input_text", text: "\"The price is 5 SOL.\"" },
            { type: "input_image", image_url: "data:image/png;base64,AQID" },
          ],
        }],
      },
    }]);
  }),
);

const invalidAnswers: ReadonlyArray<readonly [string, Schema.Json]> = [
  ["refusal", [{ type: "refusal", name: "price_readable" }]],
  ["missing", []],
  ["unexpected", [{ type: "predicate", name: "another_question", probability: 0.9 }]],
  ["out of range", [{ type: "predicate", name: "price_readable", probability: 1.1 }]],
  ["duplicate", [
    { type: "predicate", name: "price_readable", probability: 0.9 },
    { type: "predicate", name: "price_readable", probability: 0.8 },
  ]],
];
for (const [name, answers] of invalidAnswers) {
  const harness = makeHarness({ answers });
  testWithHarness(
    `predicate adapter rejects ${name} answers`,
    harness,
    Effect.gen(function*() {
      const result = yield* (yield* Decisions).evaluate(input).pipe(Effect.exit);
      expect(Exit.isFailure(result)).toBe(true);
      expect(harness.calls).toHaveLength(1);
    }),
  );
}
const duplicate = makeHarness({ answers: [] });
testWithHarness(
  "duplicate question names are rejected before transport",
  duplicate,
  Effect.gen(function*() {
    const result = yield* (yield* Decisions).evaluate(PredicateRequest.make({
      evidence: input.evidence,
      images: input.images,
      questions: [...input.questions, ...input.questions],
    })).pipe(Effect.exit);
    expect(Exit.isFailure(result)).toBe(true);
    expect(duplicate.calls).toHaveLength(0);
  }),
);
for (const [status, configured, calls] of [[429, true, 1], [200, false, 0]] as const) {
  const harness = makeHarness({ answers: [] }, status, configured);
  testWithHarness(
    `provider status ${status} and configuration ${configured} fail without fallback`,
    harness,
    Effect.gen(function*() {
      const result = yield* (yield* Decisions).evaluate(input).pipe(Effect.exit);
      expect(Exit.isFailure(result)).toBe(true);
      expect(harness.calls).toHaveLength(calls);
    }),
  );
}

testWithHarness(
  "provider failures preserve the original HTTP status cause",
  makeHarness({ answers: [] }, 429),
  Effect.gen(function*() {
    const failure = yield* (yield* Decisions).evaluate(input).pipe(Effect.flip);
    expect(failure.reason).toBe("provider");
    const providerFailure = failure.cause;
    expect(AiError.isAiError(providerFailure)).toBe(true);
    if (!AiError.isAiError(providerFailure)) return;
    expect(providerFailure.reason._tag).toBe("InvalidOutputError");
    const transportFailure = providerFailure.reason.cause;
    expect(HttpClientError.isHttpClientError(transportFailure)).toBe(true);
    if (!HttpClientError.isHttpClientError(transportFailure)) return;
    expect(transportFailure.reason._tag).toBe("StatusCodeError");
    if (transportFailure.reason._tag !== "StatusCodeError") return;
    expect(transportFailure.reason.response.status).toBe(429);
  }),
);
