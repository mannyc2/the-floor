import { Effect, Exit, Redacted, Schema } from "effect";
import { Base64 } from "effect/encoding";
import { P256, signatureDer } from "../authorization";
import { canonicalize } from "../canonical";
import { PrivyFailure } from "../error";

export const PrivyProbeResult = Schema.Struct({
  bunPresent: Schema.Boolean,
  processPresent: Schema.Boolean,
  nativeP256Verified: Schema.Literal(true),
  importedPkcs8Verified: Schema.Literal(true),
  tamperedPayloadRejected: Schema.Literal(true),
  independentKeyRejected: Schema.Literal(true),
  derSignatureBytes: Schema.Int,
  canonicalizationVerified: Schema.Literal(true),
  invalidUnicodeRejected: Schema.Literal(true),
  providerAccess: Schema.Literal("absent-from-probe"),
  sandboxSigning: Schema.Literal("not-run"),
});

// Ephemeral keys and no HTTP calls: this route measures native primitives only.
export const probePrivy = Effect.gen(function*() {
  const p256 = yield* P256;
  const first = yield* p256.generate;
  const second = yield* p256.generate;
  const canonical = yield* canonicalize({ z: [4.5, 2e-3, 1e30], "2": "two", "10": "ten", a: "😀" });
  const expected = "{\"10\":\"ten\",\"2\":\"two\",\"a\":\"😀\",\"z\":[4.5,0.002,1e+30]}";
  const raw = yield* p256.signRaw(first.privateKey, canonical);
  const exported = yield* Effect.tryPromise({
    // oxlint-disable-next-line effect/noGlobals -- Only this probe exports its ephemeral private key to test the production PKCS8 import boundary; no key leaves memory.
    try: () => globalThis.crypto.subtle.exportKey("pkcs8", first.privateKey),
    catch: cause => new PrivyFailure({ operation: "probe-export", detail: "Ephemeral key export failed", cause }),
  });
  const imported = yield* p256.importPrivate(Redacted.make(`wallet-auth:${Base64.encode(new Uint8Array(exported))}`));
  const importedRaw = yield* p256.signRaw(imported, canonical);
  const importedVerified = yield* p256.verifyRaw(first.publicKey, canonical, importedRaw);
  const verified = yield* p256.verifyRaw(first.publicKey, canonical, raw);
  const tampered = yield* p256.verifyRaw(first.publicKey, `${canonical} `, raw);
  const wrongKey = yield* p256.verifyRaw(second.publicKey, canonical, raw);
  const invalidUnicode = yield* canonicalize("\ud800").pipe(Effect.exit);
  const signature = yield* Effect.fromResult(signatureDer(raw));
  const publicKey = yield* p256.publicKey(first.publicKey);
  const decodedPublic = yield* Effect.fromResult(Base64.decode(publicKey));
  if (
    !verified || !importedVerified || tampered || wrongKey || canonical !== expected || Exit.isSuccess(invalidUnicode)
    || signature.length < 8 || signature.length > 72 || decodedPublic.length !== 91
  ) {
    return yield* new PrivyFailure({ operation: "local-probe", detail: "A native authorization invariant failed" });
  }
  return PrivyProbeResult.make({
    bunPresent: "Bun" in globalThis,
    processPresent: "process" in globalThis,
    nativeP256Verified: true,
    importedPkcs8Verified: true,
    tamperedPayloadRejected: true,
    independentKeyRejected: true,
    derSignatureBytes: signature.length,
    canonicalizationVerified: true,
    invalidUnicodeRejected: true,
    providerAccess: "absent-from-probe",
    sandboxSigning: "not-run",
  });
}).pipe(
  // oxlint-disable-next-line effecttsgo/strict-effect-provide -- The isolated Worker probe owns this native cryptographic edge.
  Effect.provide(P256.layer),
);
