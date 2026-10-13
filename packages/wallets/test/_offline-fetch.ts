import { Effect, Schema } from "effect";

export class OutboundRequestDenied extends Schema.TaggedError<OutboundRequestDenied>()("OutboundRequestDenied", {
  origin: Schema.String,
}) {}

export const offlineFetchMarker = Symbol.for("floor/test/offline-fetch");

// A missing fake Fetch Layer must fail before a socket opens. This preload also
// covers the SDK's fallback to global fetch; service-level fakes are not a fence.
export const makeOfflineFetch = (nativeFetch: typeof globalThis.fetch): typeof globalThis.fetch =>
  Object.assign(
    (input: Parameters<typeof globalThis.fetch>[0], init?: Parameters<typeof globalThis.fetch>[1]) => {
      const url = new URL(input instanceof Request ? input.url : input);
      if (
        !["http:", "https:"].includes(url.protocol)
        || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
      ) {
        return Effect.runPromise(Effect.fail(new OutboundRequestDenied({ origin: url.origin })));
      }
      // A loopback redirect must not escape to a provider after this check.
      // oxlint-disable-next-line effecttsgo/global-fetch, effect/noGlobals -- This native test boundary delegates only checked loopback requests and disables automatic redirects.
      return nativeFetch(input, { ...init, redirect: "error" }); // @effect-diagnostics globalFetch:off -- Guarded loopback-only native transport.
    },
    {
      [offlineFetchMarker]: true,
      // Connection warmup is unnecessary in tests and must not bypass Fetch.
      preconnect: () => {},
    },
  );
