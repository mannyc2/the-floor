import { BrowserCrypto } from "@effect/platform-browser";
import { Cause, Crypto, Effect, Exit, Schema } from "effect";
import { Hex } from "effect/encoding";
import { ProbeAssertion, ProbeError } from "./errors";

const Uuid = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
);

// These are the two Crypto operations used by the old policy hashes and IDs.
// The standard browser layer keeps the test independent of BunServices.
export const probeCrypto = Effect.gen(function*() {
  const service = yield* Crypto.Crypto;
  const digest = yield* service.digest("SHA-256", new TextEncoder().encode("abc"));
  const sha256 = Hex.encode(digest);
  if (sha256 !== "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad") {
    return yield* new ProbeAssertion({ invariant: "SHA-256 matches the published abc vector" });
  }
  const ids = yield* Effect.forEach(Array.from({ length: 32 }, (_, index) => index), () => service.randomUUIDv4());
  yield* Schema.decodeEffect(Schema.Array(Uuid))(ids);
  if (new Set(ids).size !== ids.length) {
    return yield* new ProbeAssertion({ invariant: "The 32 sampled UUIDs are distinct" });
  }
  const emptySha256 = Hex.encode(yield* service.digest("SHA-256", new Uint8Array()));
  if (emptySha256 !== "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855") {
    return yield* new ProbeAssertion({ invariant: "SHA-256 matches the empty-input vector" });
  }
  const invalidSize = yield* service.randomBytes(-1).pipe(Effect.exit);
  if (Exit.isSuccess(invalidSize) || !Cause.hasFails(invalidSize.cause)) {
    return yield* new ProbeAssertion({ invariant: "A negative random-byte size returns a typed failure" });
  }
  return {
    sha256,
    emptySha256,
    invalidSizeError: Cause.pretty(invalidSize.cause),
    uuidCount: ids.length,
    uuidVersion: 4,
    uuidDistinct: true,
    platformLayer: "@effect/platform-browser/BrowserCrypto",
    bunGlobalPresent: "Bun" in globalThis,
    processGlobalPresent: "process" in globalThis,
  };
}).pipe(
  // oxlint-disable-next-line effecttsgo/strict-effect-provide -- Standalone probe entrypoint; this layer owns no resources beyond the request.
  Effect.provide(BrowserCrypto.layer),
  Effect.mapError((cause) => new ProbeError({ operation: "crypto", cause })),
);
