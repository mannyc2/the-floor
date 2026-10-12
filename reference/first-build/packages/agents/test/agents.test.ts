import { BunCrypto } from "@effect/platform-bun";
import { describe, expect, it } from "@effect/vitest";
import { ConfigProvider, Context, Deferred, Effect, Fiber, Layer, Option, Redacted, Ref } from "effect";
import { HttpClient, HttpClientError } from "effect/http";
import { TestClock } from "effect/testing";
import {
  permittedResearchUrl,
  Providers,
  providersLayer,
  providerStatus,
  researchBrowserLayer,
  Researchers,
  researchersLayer,
  visibleAgent,
} from "../src";
import { researcher, researchInput } from "./_fixtures/research-input";

class ProviderCalls extends Context.Service<ProviderCalls, Ref.Ref<number>>()("test/ProviderCalls") {}
const failingTransport = Layer.effectContext(Effect.gen(function*() {
  const calls = yield* Ref.make(0);
  const client = HttpClient.make(request =>
    Ref.update(calls, value => value + 1).pipe(
      Effect.andThen(
        new HttpClientError.HttpClientError({
          reason: new HttpClientError.TransportError({
            request,
            description: "External provider unavailable in this fixture.",
          }),
        }),
      ),
    )
  );
  return Context.make(ProviderCalls, calls).pipe(Context.add(HttpClient.HttpClient, client));
}));
const researchLayer = (environment: Readonly<Record<string, string>>) =>
  researchersLayer.pipe(
    Layer.provideMerge(researchBrowserLayer),
    Layer.provideMerge(providersLayer),
    Layer.provideMerge(failingTransport),
    Layer.provide(BunCrypto.layer),
    Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(environment))),
  );
const configured = {
  OPENAI_API_KEY: "fixture-secret",
  INFERENCE_MODEL: "fixture-model",
  INFERENCE_INPUT_USD_PER_MILLION: "1",
  INFERENCE_OUTPUT_USD_PER_MILLION: "5",
};

describe("provider and privacy boundaries", () => {
  it("publishes only the explicit public identity", () => {
    const publicIdentity = Option.getOrThrow(visibleAgent(researcher));
    expect(publicIdentity).not.toHaveProperty("mandate");
    expect(publicIdentity).not.toHaveProperty("policy");
    expect(publicIdentity).not.toHaveProperty("walletAddress");
    expect(publicIdentity).not.toHaveProperty("owner");
    expect(publicIdentity).not.toHaveProperty("budget");
    expect(Option.isNone(visibleAgent({ ...researcher, visibility: "private" }))).toBe(true);
    expect(visibleAgent(researcher, Option.some(researcher.owner))).toEqual(Option.some(researcher));
  });
  it("blocks local, credential-bearing and blocked destinations", () => {
    for (
      const url of [
        "file:///etc/passwd",
        "http://127.0.0.1",
        "http://192.168.1.1",
        "http://[::1]",
        "http://localhost",
        "http://x.internal",
        "https://user:secret@example.com",
        "data:text/html,test",
      ]
    ) expect(permittedResearchUrl(url)).toBe(false);
    expect(permittedResearchUrl("https://sub.drainer.test", ["drainer.test"])).toBe(false);
    expect(permittedResearchUrl("https://example.com/research")).toBe(true);
  });
});
it.layer(researchLayer({}))("missing provider configuration", test => {
  test.effect("reports unavailable without invoking a provider or reserving budget", () =>
    Effect.gen(function*() {
      const runtime = yield* Researchers;
      const calls = yield* ProviderCalls;
      const reservations = yield* Ref.make(0);
      const result = yield* runtime.run({
        ...researchInput,
        reserveBudget: () => Ref.update(reservations, value => value + 1).pipe(Effect.as(true)),
      });
      expect(result.status).toBe("unconfigured");
      expect(result.notes).toEqual([]);
      expect(result.usage.chargedUsd).toBe(0);
      expect(yield* Ref.get(reservations)).toBe(0);
      expect(yield* Ref.get(calls)).toBe(0);
    }));
});
it.layer(researchLayer(configured), { concurrent: false })("configured research boundaries", test => {
  test.effect("loads redacted keys and exposes configuration status only", () =>
    Effect.gen(function*() {
      const providers = yield* Providers;
      const inference = yield* Effect.fromOption(providers.inference);
      expect(Redacted.isRedacted(inference.apiKey)).toBe(true);
      expect(providerStatus(providers).inference).toEqual({
        configured: true,
        provider: "OpenAI-compatible Responses",
        model: "fixture-model",
        message: "Configured. Calls are bounded and metered.",
      });
      expect(providerStatus(providers)).not.toHaveProperty("apiKey");
    }));
  test.effect("requires the durable reservation before provider I/O", () =>
    Effect.gen(function*() {
      const runtime = yield* Researchers;
      const calls = yield* ProviderCalls;
      const before = yield* Ref.get(calls);
      const reservations = yield* Ref.make(0);
      const result = yield* runtime.run({
        ...researchInput,
        reserveBudget: () => Ref.update(reservations, value => value + 1).pipe(Effect.as(false)),
      });
      expect(yield* Ref.get(reservations)).toBe(1);
      expect(result.status).toBe("budget-exhausted");
      expect(result.proposals).toEqual([]);
      expect(result.usage.chargedUsd).toBe(0);
      expect(yield* Ref.get(calls)).toBe(before);
    }));
  test.effect("admits one active run per agent and releases admission afterward", () =>
    Effect.gen(function*() {
      const runtime = yield* Researchers;
      const entered = yield* Deferred.make<void>();
      const release = yield* Deferred.make<boolean>();
      const first = yield* runtime.run({
        ...researchInput,
        reserveBudget: () => Deferred.succeed(entered, void 0).pipe(Effect.andThen(Deferred.await(release))),
      }).pipe(Effect.forkChild);
      yield* Deferred.await(entered);
      const second = yield* runtime.run(researchInput);
      expect(second.status).toBe("failed");
      expect(second.message).toContain("already has a research run");
      yield* Deferred.succeed(release, false);
      expect((yield* Fiber.join(first)).status).toBe("budget-exhausted");
      expect((yield* runtime.run({ ...researchInput, reserveBudget: () => Effect.succeed(false) })).status).toBe(
        "budget-exhausted",
      );
    }));
  test.effect("rolls the daily budget using the native clock", () =>
    Effect.gen(function*() {
      const runtime = yield* Researchers;
      const reservations = yield* Ref.make(0);
      const input = {
        ...researchInput,
        agent: { ...researcher, budget: { dailyUsd: 1, spentUsd: 1, day: "1970-01-01" } },
        reserveBudget: () => Ref.update(reservations, value => value + 1).pipe(Effect.as(false)),
      };
      expect((yield* runtime.run(input)).status).toBe("budget-exhausted");
      expect(yield* Ref.get(reservations)).toBe(0);
      yield* TestClock.adjust("1 day");
      expect((yield* runtime.run(input)).status).toBe("budget-exhausted");
      expect(yield* Ref.get(reservations)).toBe(1);
    }));
  test.effect("retains the reservation after an uncertain provider failure", () =>
    Effect.gen(function*() {
      const runtime = yield* Researchers;
      const calls = yield* ProviderCalls;
      const before = yield* Ref.get(calls);
      const result = yield* runtime.run(researchInput);
      expect(result.status).toBe("failed");
      expect(result.usage).toMatchObject({ chargedUsd: 0.5, pricing: "reserved" });
      expect(result.proposals).toEqual([]);
      expect(yield* Ref.get(calls)).toBeGreaterThan(before);
      expect(result.message).not.toContain("fixture-secret");
    }));
});
