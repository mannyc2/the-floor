import { BrowserCrypto } from "@effect/platform-browser";
import type { Providers } from "alchemy/Cloudflare";
import { Request } from "alchemy/Cloudflare/Workers/Request";
import { Worker, type WorkerEnv } from "alchemy/Cloudflare/Workers/Worker";
import { Cause, Config, Crypto, Effect, Exit, Redacted, Schema } from "effect";
import { Hex } from "effect/encoding";
import { HttpServerResponse } from "effect/http";

class CryptoInvariant extends Schema.TaggedError<CryptoInvariant>()("CryptoInvariant", { invariant: Schema.String }) {}
const probe = Effect.gen(function*() {
  const crypto = yield* Crypto.Crypto;
  const sha256 = Hex.encode(yield* crypto.digest("SHA-256", new TextEncoder().encode("abc")));
  const emptySha256 = Hex.encode(yield* crypto.digest("SHA-256", new Uint8Array()));
  if (
    sha256 !== "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    || emptySha256 !== "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
  ) {
    return yield* new CryptoInvariant({ invariant: "Published SHA-256 vectors match" });
  }
  const ids = yield* Effect.forEach(Array.from({ length: 32 }, (_, index) => index), () => crypto.randomUUIDv4());
  if (
    new Set(ids).size !== 32
    || ids.some((id) => !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id))
  ) {
    return yield* new CryptoInvariant({ invariant: "32 sampled RFC UUID v4 values are distinct" });
  }
  const invalidSize = yield* crypto.randomBytes(-1).pipe(Effect.exit);
  if (Exit.isSuccess(invalidSize) || !Cause.hasFails(invalidSize.cause)) {
    return yield* new CryptoInvariant({ invariant: "Negative random-byte size is a typed failure" });
  }
  return {
    sha256,
    emptySha256,
    uuidCount: 32,
    uuidDistinct: true,
    invalidSizeError: Cause.pretty(invalidSize.cause),
    bunGlobalPresent: "Bun" in globalThis,
  };
});

export const makeCryptoWorker = (env: WorkerEnv = {}): Effect.Effect<Worker<{}>, never, Providers> =>
  Worker(
    "FloorHostedCrypto",
    { main: import.meta.url, compatibility: { date: "2026-08-18", flags: [] }, env, limits: { cpuMs: 10000 } },
    Effect.succeed({
      fetch: Effect.gen(function*() {
        const request = yield* Request;
        const token = yield* Config.Redacted("FLOOR_PROBE_TOKEN");
        if (request.headers.get("x-floor-probe-token") !== Redacted.value(token)) {
          return HttpServerResponse.empty({ status: 403 });
        }
        return HttpServerResponse.jsonUnsafe(yield* probe);
      }).pipe(Effect.orDie),
    }).pipe(
      // oxlint-disable-next-line effecttsgo/strict-effect-provide -- This hosted Worker fixture is the application boundary for its Web Crypto service.
      Effect.provide(BrowserCrypto.layer),
    ),
  );
export default makeCryptoWorker();
