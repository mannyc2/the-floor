import { formatRequestForAuthorizationSignature, PrivyClient } from "@privy-io/node";
import { expect } from "bun:test";
import { Effect, Layer, Option, Redacted, Schema } from "effect";
import { Base64 } from "effect/encoding";
import { FetchHttpClient } from "effect/http";
import { P256 } from "../src/privy/authorization";
import { canonicalize } from "../src/privy/canonical";
import { PrivySettings, PrivyWallets } from "../src/privy/client";
import { PrivyFailure } from "../src/privy/error";

export const appId = "synthetic-oracle-app";
export const appSecret = "synthetic-oracle-secret";
export interface Captured {
  readonly request: Request;
  readonly body: string;
}

// These are synthetic response bytes, not recordings or evidence of provider acceptance.
export const capture = <E = never>(
  reply: Schema.Json,
  status = 200,
  accept: (call: Captured) => Effect.Effect<boolean, E> = () => Effect.succeed(true),
) => {
  const calls: Captured[] = [];
  const fetch = FetchHttpClient.Fetch.of(Object.assign(
    (input: Parameters<typeof globalThis.fetch>[0], init?: Parameters<typeof globalThis.fetch>[1]) =>
      Effect.runPromise(Effect.gen(function*() {
        const request = input instanceof Request ? new Request(input, init) : new Request(String(input), init);
        const call = { request, body: yield* Effect.promise(() => request.text()) };
        calls.push(call);
        const accepted = yield* accept(call);
        const result = accepted ? reply : { code: "insufficient_correct_authorization_signatures" };
        return new Response(yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Json))(result), {
          status: accepted ? status : 401,
          headers: { "content-type": "application/json" },
        });
      })),
    { preconnect: () => {} },
  ));
  return {
    calls,
    sdk: new PrivyClient({
      appId,
      appSecret,
      fetch,
      maxRetries: 0,
      requestExpiry: { disabled: true },
    }),
    layer: PrivyWallets.layer.pipe(Layer.provideMerge(Layer.mergeAll(
      P256.layer,
      Layer.succeed(PrivySettings, PrivySettings.of({ appId, appSecret: Redacted.make(appSecret) })),
      Layer.succeed(FetchHttpClient.Fetch, fetch),
    ))),
  };
};

export const privateKey = Effect.fn("Privy.oracle.privateKey")((key: CryptoKey) =>
  Effect.promise(() => globalThis.crypto.subtle.exportKey("pkcs8", key)).pipe(
    Effect.map(bytes => Base64.encode(new Uint8Array(bytes))),
  )
);

// Decode the SDK's DER format independently of the native DER encoder.
export const fromDer = Effect.fn("Privy.oracle.fromDer")(function*(encoded: string) {
  const bytes = yield* Effect.fromResult(Base64.decode(encoded));
  const rLength = bytes[3] ?? 0;
  const sTag = 4 + rLength;
  const sLength = bytes[sTag + 1] ?? 0;
  if (
    bytes[0] !== 48 || bytes[1] !== bytes.length - 2 || bytes[2] !== 2 || bytes[sTag] !== 2
    || rLength < 1 || rLength > 33 || sLength < 1 || sLength > 33 || sTag + 2 + sLength !== bytes.length
  ) {
    return yield* new PrivyFailure({ operation: "oracle-der", detail: "Malformed DER signature" });
  }
  const r = bytes.slice(4, sTag).slice(-32);
  const s = bytes.slice(sTag + 2).slice(-32);
  const raw = new Uint8Array(64);
  raw.set(r, 32 - r.length);
  raw.set(s, 64 - s.length);
  return raw;
});

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
  const p256 = yield* P256;
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
      expect(yield* p256.verifyRaw(publicKey, oppositePayload, raw)).toBe(true);
    }
  }
});
