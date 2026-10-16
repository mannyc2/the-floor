import { formatRequestForAuthorizationSignature, PrivyClient } from "@privy-io/node";
import { expect } from "bun:test";
import { Effect, Option, Schema } from "effect";
import { Base64 } from "effect/encoding";
import { canonicalize } from "../src/privy/canonical";
import { appId, appSecret, type Captured } from "./_fixture";
import { fromDer, verify } from "./_p256";

// The pinned SDK over the same fake transport as the native client.
export const oracleClient = (fetch: typeof globalThis.fetch) =>
  new PrivyClient({ appId, appSecret, fetch, maxRetries: 0, requestExpiry: { disabled: true } });

export const privateKey = Effect.fn("Privy.oracle.privateKey")((key: CryptoKey) =>
  Effect.promise(() => globalThis.crypto.subtle.exportKey("pkcs8", key)).pipe(
    Effect.map(bytes => Base64.encode(new Uint8Array(bytes))),
  )
);

export const signingInput = Effect.fn("Privy.oracle.signingInput")(function*(call: Captured) {
  const body = yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Json))(call.body);
  const method = yield* Schema.decodeUnknownEffect(Schema.Literals(["POST", "PATCH"]))(call.request.method);
  const idempotency = Option.fromNullishOr(call.request.headers.get("privy-idempotency-key"));
  const expiry = Option.fromNullishOr(call.request.headers.get("privy-request-expiry"));
  const headers = {
    "privy-app-id": call.request.headers.get("privy-app-id") ?? "",
    ...Option.match(idempotency, { onNone: () => ({}), onSome: value => ({ "privy-idempotency-key": value }) }),
    ...Option.match(expiry, { onNone: () => ({}), onSome: value => ({ "privy-request-expiry": value }) }),
  };
  return { version: 1, method, url: call.request.url, body, headers } satisfies Parameters<
    typeof formatRequestForAuthorizationSignature
  >[0];
});

const sdkDiagnosticHeaders = new Set([
  "accept",
  "privy-client",
  "user-agent",
  "x-stainless-arch",
  "x-stainless-lang",
  "x-stainless-os",
  "x-stainless-package-version",
  "x-stainless-retry-count",
  "x-stainless-runtime",
  "x-stainless-runtime-version",
]);

export const compareWire = (native: Captured, sdk: Captured) => {
  expect(native.request.method).toBe(sdk.request.method);
  expect(native.request.url).toBe(sdk.request.url);
  expect(new TextEncoder().encode(native.body)).toEqual(new TextEncoder().encode(sdk.body));
  const nativeHeaders = new Map(native.request.headers);
  const sdkHeaders = new Map(sdk.request.headers);
  nativeHeaders.delete("privy-authorization-signature");
  sdkHeaders.delete("privy-authorization-signature");
  const nativeExtra = [...nativeHeaders.keys()].filter(name => !sdkHeaders.has(name));
  expect(new Set(nativeExtra)).toEqual(new Set(["b3", "traceparent"]));
  expect(nativeHeaders.get("traceparent")).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
  for (const name of nativeExtra) nativeHeaders.delete(name);
  // SDK identity/runtime diagnostics are a recorded wire difference, not signature inputs.
  // Assert their exact names before comparing every application/authentication header.
  const extra = [...sdkHeaders.keys()].filter(name => !nativeHeaders.has(name));
  expect(new Set(extra)).toEqual(sdkDiagnosticHeaders);
  expect(sdkHeaders.get("privy-client")).toBe("node:0.35.0");
  expect(sdkHeaders.get("accept")).toBe("application/json");
  expect(sdkHeaders.get("x-stainless-retry-count")).toBe("0");
  for (const name of extra) sdkHeaders.delete(name);
  expect(nativeHeaders).toEqual(sdkHeaders);
};

export const compareSignatures = Effect.fn("Privy.oracle.compareSignatures")(function*(
  native: Captured,
  sdk: Captured,
  publicKeys: readonly CryptoKey[],
) {
  const nativeInput = yield* signingInput(native);
  const sdkInput = yield* signingInput(sdk);
  const nativePayload = yield* canonicalize(nativeInput);
  const sdkPayload = new TextDecoder().decode(formatRequestForAuthorizationSignature(sdkInput));
  expect(new TextEncoder().encode(nativePayload)).toEqual(new TextEncoder().encode(sdkPayload));
  for (const [call, oppositePayload] of [[native, sdkPayload], [sdk, nativePayload]] as const) {
    const signatures = (call.request.headers.get("privy-authorization-signature") ?? "").split(",");
    expect(signatures).toHaveLength(publicKeys.length);
    for (const [index, publicKey] of publicKeys.entries()) {
      const raw = yield* fromDer(signatures[index] ?? "");
      expect(yield* verify(publicKey, oppositePayload, raw)).toBe(true);
    }
  }
});
