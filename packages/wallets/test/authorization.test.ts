import * as Test from "alchemy/Test/Bun";
import { expect } from "bun:test";
import { Effect, Layer, Redacted, Result } from "effect";
import { P256, signatureDer } from "../src/privy/authorization";

const { test } = Test.make({ providers: Layer.empty, dev: true, sidecar: false });
test(
  "DER encoding uses positive minimal integers and rejects malformed raw lengths",
  Effect.sync(() => {
    const raw = new Uint8Array(64);
    raw[31] = 1;
    raw[32] = 128;
    const encoded = signatureDer(raw);
    expect(Result.isSuccess(encoded)).toBe(true);
    if (Result.isFailure(encoded)) return;
    expect([...encoded.success]).toEqual([48, 38, 2, 1, 1, 2, 33, 0, 128, ...new Uint8Array(31)]);
    expect(Result.isFailure(signatureDer(new Uint8Array(63)))).toBe(true);
  }),
);
test(
  "invalid PKCS8 retains a structured native failure",
  Effect.gen(function*() {
    const error = yield* (yield* P256).importPrivate(Redacted.make("wallet-auth:AQID")).pipe(Effect.flip);
    expect(error.operation).toBe("import-private-key");
    expect(error.cause).toBeDefined();
  }).pipe(
    Effect.provide(P256.layer),
  ),
);

test(
  "malformed encoded private keys keep input-bearing errors redacted",
  Effect.gen(function*() {
    const error = yield* (yield* P256).importPrivate(Redacted.make("wallet-auth:local-private-material")).pipe(
      Effect.flip,
    );
    expect(error.operation).toBe("decode-private-key");
    expect(Redacted.isRedacted(error.cause)).toBe(true);
    expect(String(error.cause).includes("private-material")).toBe(false);
  }).pipe(
    Effect.provide(P256.layer),
  ),
);
