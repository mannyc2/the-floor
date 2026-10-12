import { Effect, Schema } from "effect";

class OutboundRequestDenied extends Schema.TaggedError<OutboundRequestDenied>()("OutboundRequestDenied", {
  origin: Schema.String,
}) {}

const nativeFetch = globalThis.fetch;
Object.defineProperty(globalThis, "fetch", {
  configurable: true,
  value: (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
      return Effect.runPromise(Effect.fail(new OutboundRequestDenied({ origin: url.origin })));
    }
    // The preload intercepts the native transport before Alchemy loads; using an HttpClient here would recurse.
    // oxlint-disable-next-line effecttsgo/global-fetch, effect/noGlobals -- Delegate only after the loopback guard at the native transport boundary.
    return nativeFetch(input, init); // @effect-diagnostics globalFetch:off -- This preload delegates to the guarded native transport.
  },
});
