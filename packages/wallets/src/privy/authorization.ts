import { Context, Effect, Layer, Redacted, Result, Schema } from "effect";
import { Base64 } from "effect/encoding";
import { canonicalize } from "./canonical";
import { PrivyFailure } from "./error";

const integer = (part: Uint8Array) => {
  let start = 0;
  while (start < part.length - 1 && part[start] === 0) start++;
  const bytes = part.slice(start);
  const prefix = (bytes[0] ?? 0) >= 128 ? [0] : [];
  return [2, bytes.length + prefix.length, ...prefix, ...bytes];
};

// Web Crypto emits the fixed 64-byte IEEE-P1363 form; Privy's direct-signing
// examples require ASN.1 DER. Keep integers positive and minimally encoded.
export const signatureDer = (raw: Uint8Array): Result.Result<Uint8Array, PrivyFailure> => {
  if (raw.length !== 64) return Result.fail(new PrivyFailure({ operation: "signature-encoding" }));
  const r = integer(raw.slice(0, 32));
  const s = integer(raw.slice(32));
  return Result.succeed(new Uint8Array([48, r.length + s.length, ...r, ...s]));
};

export class P256 extends Context.Service<P256, {
  readonly importPrivate: (key: Redacted.Redacted) => Effect.Effect<CryptoKey, PrivyFailure>;
  readonly publicKey: (key: CryptoKey) => Effect.Effect<string, PrivyFailure>;
  readonly sign: (key: CryptoKey, payload: Schema.Json) => Effect.Effect<string, PrivyFailure>;
}>()("Floor/Privy/P256") {
  static readonly layer = Layer.sync(P256, () => {
    // Effect Crypto 4.0.3 has no asymmetric-key operations; this service owns SubtleCrypto.
    const subtle = globalThis.crypto.subtle;
    return P256.of({
      importPrivate: Effect.fn("Privy.P256.importPrivate")(function*(key) {
        const encoded = Redacted.value(key).replace(/^wallet-auth:/, "");
        const bytes = yield* Effect.fromResult(Base64.decode(encoded)).pipe(
          // The Base64 error embeds its input. Preserve it behind Redacted so a
          // malformed authorization key cannot appear in diagnostic output.
          Effect.mapError(cause => new PrivyFailure({ operation: "decode-private-key", cause: Redacted.make(cause) })),
        );
        return yield* Effect.tryPromise({
          try: () =>
            subtle.importKey("pkcs8", new Uint8Array(bytes), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]),
          catch: cause => new PrivyFailure({ operation: "import-private-key", cause }),
        });
      }),
      publicKey: Effect.fn("Privy.P256.publicKey")((key) =>
        Effect.tryPromise({
          try: () => subtle.exportKey("spki", key),
          catch: cause => new PrivyFailure({ operation: "export-public-key", cause }),
        }).pipe(Effect.map(buffer => Base64.encode(new Uint8Array(buffer))))
      ),
      sign: Effect.fn("Privy.P256.sign")(function*(key, payload) {
        const canonical = yield* canonicalize(payload);
        const raw = yield* Effect.tryPromise({
          try: () => subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(canonical)),
          catch: cause => new PrivyFailure({ operation: "sign", cause }),
        });
        return Base64.encode(yield* Effect.fromResult(signatureDer(new Uint8Array(raw))));
      }),
    });
  });
}
