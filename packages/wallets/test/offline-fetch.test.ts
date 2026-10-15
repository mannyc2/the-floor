import { expect, test } from "bun:test";
import { Effect, Layer, Redacted, Schema } from "effect";
import { HttpClientError } from "effect/http";
import { P256 } from "../src/privy/authorization";
import { PrivySettings, PrivyWallets } from "../src/privy/client";
import { makeOfflineFetch, offlineFetchMarker, OutboundRequestDenied } from "./_offline-fetch";

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

class FetchRejected extends Schema.TaggedError<FetchRejected>()("FetchRejected", {
  cause: Schema.Unknown,
}) {}

test("the offline preload is active before wallet tests load", () => {
  // This test imports only the pure guard factory, never the installing preload.
  expect(Object.hasOwn(globalThis.fetch, offlineFetchMarker)).toBe(true);
});

test("an accidental default Privy transport is blocked before native Fetch", () => {
  // Refuse to exercise the client if a direct invocation skipped its preload.
  expect(Object.hasOwn(globalThis.fetch, offlineFetchMarker)).toBe(true);
  let nativeCalls = 0;
  const sentinel = Object.assign(() => {
    nativeCalls++;
    return run(Effect.fail(new OutboundRequestDenied({ origin: "sentinel-native-transport" })));
  }, { preconnect: () => {} });
  const layer = PrivyWallets.layer.pipe(Layer.provide(Layer.mergeAll(
    P256.layer,
    Layer.succeed(
      PrivySettings,
      PrivySettings.of({ appId: "offline-guard", appSecret: Redacted.make("synthetic-secret") }),
    ),
  )));
  return run(
    Effect.gen(function*() {
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          const previous = globalThis.fetch;
          // Even a broken guard can reach only this sentinel, never a real socket.
          // oxlint-disable-next-line effect/noTestGlobals -- This regression must exercise the global fallback; a provided fake Fetch would conceal the escaped-service bug.
          Object.defineProperty(globalThis, "fetch", { configurable: true, value: makeOfflineFetch(sentinel) });
          return { previous };
        }),
        resource =>
          Effect.sync(() => {
            // oxlint-disable-next-line effect/noTestGlobals -- The scoped regression restores the preloaded guard after its sentinel fallback test.
            Object.defineProperty(globalThis, "fetch", { configurable: true, value: resource.previous });
          }),
      );
      const error = yield* PrivyWallets.use(client => client.getWallet("synthetic-wallet")).pipe(
        Effect.provide(layer),
        Effect.flip,
      );
      expect(error._tag).toBe("PrivyFailure");
      expect(Redacted.isRedacted(error.cause)).toBe(true);
      if (Redacted.isRedacted(error.cause)) {
        const cause = Redacted.value(error.cause);
        expect(HttpClientError.isHttpClientError(cause)).toBe(true);
        if (HttpClientError.isHttpClientError(cause)) {
          expect("cause" in cause.reason).toBe(true);
          if ("cause" in cause.reason) {
            expect(Schema.is(OutboundRequestDenied)(cause.reason.cause)).toBe(true);
            if (Schema.is(OutboundRequestDenied)(cause.reason.cause)) {
              expect(cause.reason.cause.origin).toBe("https://api.privy.io");
            }
          }
        }
      }
      expect(nativeCalls).toBe(0);
    }).pipe(Effect.scoped),
  );
});

test("external strings, URLs and Requests cannot reach the native transport", () => {
  let nativeCalls = 0;
  const guarded = makeOfflineFetch(Object.assign(() => {
    nativeCalls++;
    return run(Effect.succeed(new Response("synthetic")));
  }, { preconnect: () => {} }));
  return run(Effect.gen(function*() {
    for (
      const input of [
        "https://api.privy.io/v1/wallets/synthetic-wallet",
        new URL("https://api.privy.io/v1/wallets/synthetic-wallet"),
        new Request("https://api.privy.io/v1/wallets/synthetic-wallet"),
        "https://localhost.example.invalid/",
        "file:///synthetic-path",
      ]
    ) {
      const error = yield* Effect.tryPromise({
        try: () => guarded(input),
        catch: cause => new FetchRejected({ cause }),
      }).pipe(Effect.flip);
      expect(Schema.is(OutboundRequestDenied)(error.cause)).toBe(true);
    }
    expect(nativeCalls).toBe(0);
  }));
});

test("loopback requests keep their options but cannot follow external redirects", () => {
  const forwarded: Array<Parameters<typeof globalThis.fetch>> = [];
  const guarded = makeOfflineFetch(Object.assign(
    (...args: Parameters<typeof globalThis.fetch>) => {
      forwarded.push(args);
      return run(Effect.succeed(new Response("synthetic", { status: 202 })));
    },
    { preconnect: () => {} },
  ));
  return run(Effect.gen(function*() {
    for (
      const input of [
        "http://localhost:8787/api/health",
        new URL("http://127.0.0.1:8787/api/health"),
        new Request("http://[::1]:8787/api/health"),
      ]
    ) {
      const response = yield* Effect.promise(() => guarded(input, { method: "POST", redirect: "follow" }));
      expect(response.status).toBe(202);
    }
    expect(forwarded).toHaveLength(3);
    for (const [, init] of forwarded) {
      expect(init?.method).toBe("POST");
      expect(init?.redirect).toBe("error");
    }
  }));
});
