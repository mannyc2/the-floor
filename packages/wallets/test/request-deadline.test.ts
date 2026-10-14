import * as Test from "alchemy/Test/Bun";
import { expect } from "bun:test";
import { Cause, Deferred, Effect, Fiber, Layer, Option, Redacted, Result, Schema } from "effect";
import { FetchHttpClient } from "effect/http";
import { TestClock } from "effect/testing";
import { P256 } from "../src/privy/authorization";
import { PrivySettings, PrivyWallets } from "../src/privy/client";
import { PrivyFailure } from "../src/privy/error";

const { test } = Test.make({ providers: Layer.empty, dev: true, sidecar: false });

const stalled = Effect.fn("Privy.test.stalled")(function*(status: number) {
  const context = yield* Effect.context();
  const reading = yield* Deferred.make<void>();
  const requests: Request[] = [];
  const aborted: Request[] = [];
  // Fetch and ReadableStream consume Promises. Keep this single test adapter
  // bound to the test's Effect context; it never opens a network connection.
  // oxlint-disable-next-line effect/noEffectRunInTests -- This is the fake Fetch/ReadableStream Promise adapter, retaining the test context for its readiness signal.
  const run = Effect.runPromiseWith(context);
  const fetch = FetchHttpClient.Fetch.of(Object.assign(
    (input: Parameters<typeof globalThis.fetch>[0], init?: Parameters<typeof globalThis.fetch>[1]) =>
      run(Effect.sync(() => {
        const request = input instanceof Request ? new Request(input, init) : new Request(String(input), init);
        requests.push(request);
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            // Native fetch errors an in-flight response body when its signal
            // aborts. This fixture models that contract without a real socket.
            request.signal.addEventListener("abort", () => {
              aborted.push(request);
              controller.error(new PrivyFailure({ operation: "synthetic-fetch", detail: "Body cancelled" }));
            }, { once: true });
          },
          pull() {
            return run(Deferred.succeed(reading, void 0).pipe(Effect.asVoid));
          },
        }, { highWaterMark: 0 });
        return new Response(body, { status, headers: { "content-type": "application/json" } });
      })),
    { preconnect: () => {} },
  ));
  const layer = PrivyWallets.layer.pipe(Layer.provideMerge(Layer.mergeAll(
    P256.layer,
    Layer.succeed(
      PrivySettings,
      PrivySettings.of({ appId: "synthetic-timeout-app", appSecret: Redacted.make("synthetic-secret") }),
    ),
    Layer.succeed(FetchHttpClient.Fetch, fetch),
  )));
  return { layer, requests, aborted, reading };
});

for (const status of [200, 403]) {
  const program = Effect.gen(function*() {
    const fixture = yield* stalled(status);
    const finished = yield* Deferred.make<void>();
    const operation = Effect.gen(function*() {
      return yield* (yield* PrivyWallets).getWallet("synthetic-stalled-wallet");
    }).pipe(
      // oxlint-disable-next-line effect/noInlineProvide, effecttsgo/strict-effect-provide -- Each deadline test owns its abort-aware fake Fetch and client settings.
      Effect.provide(fixture.layer),
      Effect.result,
      Effect.tap(() => Deferred.succeed(finished, void 0)),
    );
    const fiber = yield* Effect.forkScoped(operation);
    yield* Deferred.await(fixture.reading);
    yield* TestClock.adjust("9 seconds");
    expect(yield* Deferred.isDone(finished)).toBe(false);
    expect(fixture.aborted).toHaveLength(0);
    yield* TestClock.adjust("1 second");
    expect(yield* Deferred.isDone(finished)).toBe(true);
    const result = yield* Fiber.join(fiber);
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(Schema.is(PrivyFailure)(result.failure)).toBe(true);
      if (Schema.is(PrivyFailure)(result.failure)) {
        expect(result.failure.kind).toBe("transport");
        expect(result.failure.operation).toBe("get-wallet");
        expect(Option.isNone(Option.fromUndefinedOr(result.failure.code))).toBe(true);
      }
      expect(Redacted.isRedacted(result.failure.cause)).toBe(true);
      if (Redacted.isRedacted(result.failure.cause)) {
        expect(Cause.isTimeoutError(Redacted.value(result.failure.cause))).toBe(true);
      }
    }
    expect(fixture.requests).toHaveLength(1);
    expect(fixture.aborted).toHaveLength(1);
    expect(fixture.requests.every(request => request.signal.aborted)).toBe(true);
  }).pipe(
    Effect.scoped,
    // oxlint-disable-next-line effect/noInlineProvide, effecttsgo/strict-effect-provide -- The deadline is exercised through a deterministic test clock, never a wall-clock wait.
    Effect.provide(TestClock.layer()),
  );
  test(`the whole request deadline cancels a stalled ${status} body and never retries`, program);
}
