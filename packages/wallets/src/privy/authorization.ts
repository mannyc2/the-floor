import { Context, Effect, Layer, Redacted, Result, Schema } from "effect";
import { Base64 } from "effect/encoding";
import { canonicalize } from "./canonical";
import { PrivyFailure } from "./error";

const failure = (operation: string, cause: unknown) =>
  new PrivyFailure({ operation, detail: "Native P-256 operation failed", cause });

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
  if (raw.length !== 64) {
    return Result.fail(
      new PrivyFailure({ operation: "signature-encoding", detail: "Expected 64-byte P-256 signature" }),
    );
  }
  const r = integer(raw.slice(0, 32));
  const s = integer(raw.slice(32));
  return Result.succeed(new Uint8Array([48, r.length + s.length, ...r, ...s]));
};

export class P256 extends Context.Service<P256, {
  readonly generate: Effect.Effect<CryptoKeyPair, PrivyFailure>;
  readonly importPrivate: (key: Redacted.Redacted) => Effect.Effect<CryptoKey, PrivyFailure>;
  readonly publicKey: (key: CryptoKey) => Effect.Effect<string, PrivyFailure>;
  readonly sign: (key: CryptoKey, payload: Schema.Json) => Effect.Effect<string, PrivyFailure>;
  readonly verifyRaw: (key: CryptoKey, payload: string, signature: Uint8Array) => Effect.Effect<boolean, PrivyFailure>;
  readonly signRaw: (key: CryptoKey, payload: string) => Effect.Effect<Uint8Array, PrivyFailure>;
}>()("Floor/Privy/P256") {
  static readonly layer = Layer.sync(P256, () => {
    // oxlint-disable-next-line effect/noGlobals -- Effect Crypto 4.0.3 has no asymmetric-key operations; this single platform edge owns native SubtleCrypto access.
    const subtle = globalThis.crypto.subtle;
    const signRaw = Effect.fn("Privy.P256.signRaw")((key: CryptoKey, payload: string) =>
      Effect.tryPromise({
        try: () => subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(payload)),
        catch: cause => failure("sign", cause),
      }).pipe(Effect.map(buffer => new Uint8Array(buffer)))
    );
    return P256.of({
      generate: Effect.tryPromise({
        try: () => subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]),
        catch: cause => failure("generate", cause),
      }),
      importPrivate: Effect.fn("Privy.P256.importPrivate")(function*(key) {
        const encoded = Redacted.value(key).replace(/^wallet-auth:/, "");
        const bytes = yield* Effect.fromResult(Base64.decode(encoded)).pipe(
          // The Base64 error embeds its input. Preserve it behind Redacted so a
          // malformed authorization key cannot appear in diagnostic output.
          Effect.mapError(cause => failure("decode-private-key", Redacted.make(cause))),
        );
        return yield* Effect.tryPromise({
          try: () =>
            subtle.importKey("pkcs8", new Uint8Array(bytes), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]),
          catch: cause => failure("import-private-key", cause),
        });
      }),
      publicKey: Effect.fn("Privy.P256.publicKey")((key) =>
        Effect.tryPromise({
          try: () => subtle.exportKey("spki", key),
          catch: cause => failure("export-public-key", cause),
        }).pipe(Effect.map(buffer => Base64.encode(new Uint8Array(buffer))))
      ),
      signRaw,
      sign: Effect.fn("Privy.P256.sign")(function*(key, payload) {
        const canonical = yield* canonicalize(payload);
        const raw = yield* signRaw(key, canonical);
        return Base64.encode(yield* Effect.fromResult(signatureDer(raw)));
      }),
      verifyRaw: Effect.fn("Privy.P256.verify")((key, payload, signature) =>
        Effect.tryPromise({
          try: () =>
            subtle.verify(
              { name: "ECDSA", hash: "SHA-256" },
              key,
              new Uint8Array(signature),
              new TextEncoder().encode(payload),
            ),
          catch: cause => failure("verify", cause),
        })
      ),
    });
  });
}
