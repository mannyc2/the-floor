import { Effect } from "effect";
import { Base64 } from "effect/encoding";
import { PrivyFailure } from "../src/privy/error";

// Test-only P-256 operations. Production imports an authorization key and signs;
// it never generates keys or verifies signatures.
const subtle = globalThis.crypto.subtle;

export const generate = Effect.promise(() =>
  subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])
);

export const verify = (key: CryptoKey, payload: string, signature: Uint8Array) =>
  Effect.promise(() =>
    subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, new Uint8Array(signature), new TextEncoder().encode(payload))
  );

// Decode the DER wire form independently of the native encoder, so either
// implementation's signature can be checked with Web Crypto.
export const fromDer = Effect.fn("Privy.test.fromDer")(function*(encoded: string) {
  const bytes = yield* Effect.fromResult(Base64.decode(encoded));
  const rLength = bytes[3] ?? 0;
  const sTag = 4 + rLength;
  const sLength = bytes[sTag + 1] ?? 0;
  if (
    bytes[0] !== 48 || bytes[1] !== bytes.length - 2 || bytes[2] !== 2 || bytes[sTag] !== 2
    || rLength < 1 || rLength > 33 || sLength < 1 || sLength > 33 || sTag + 2 + sLength !== bytes.length
  ) {
    return yield* new PrivyFailure({ operation: "decode-der" });
  }
  const r = bytes.slice(4, sTag).slice(-32);
  const s = bytes.slice(sTag + 2).slice(-32);
  const raw = new Uint8Array(64);
  raw.set(r, 32 - r.length);
  raw.set(s, 64 - s.length);
  return raw;
});
