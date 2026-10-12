import * as Test from "alchemy/Test/Bun";
import { expect } from "bun:test";
import { Effect, Exit, Layer, Redacted, Result } from "effect";
import { P256, signatureDer } from "../../src/privy/authorization";
import { canonicalize } from "../../src/privy/canonical";

const { test } = Test.make({ providers: Layer.empty, dev: true, sidecar: false });
test(
  "JCS orders UTF-16 keys and retains numeric-key order, number formatting and arrays",
  Effect.gen(function*() {
    expect(yield* canonicalize({ "2": "b", "10": "a", z: [1e30, 4.5, 0.002, -0], a: "\n\u000f😀" })).toBe(
      "{\"10\":\"a\",\"2\":\"b\",\"a\":\"\\n\\u000f😀\",\"z\":[1e+30,4.5,0.002,0]}",
    );
    expect(yield* canonicalize({ "€": 3, "\r": 1, "😀": 6, "ö": 2, "דּ": 7, "1": 0, "\u0080": 4 })).toBe(
      "{\"\\r\":1,\"1\":0,\"\u0080\":4,\"ö\":2,\"€\":3,\"😀\":6,\"דּ\":7}",
    );
  }),
);
test(
  "JCS rejects invalid Unicode and non-finite values instead of silently changing signed data",
  Effect.gen(function*() {
    for (const input of ["\ud800", "\udfff", Number.NaN, Number.POSITIVE_INFINITY, { "\ud800": "bad-key" }]) {
      expect(Exit.isFailure(yield* canonicalize(input).pipe(Effect.exit))).toBe(true);
    }
  }),
);
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
    // oxlint-disable-next-line effecttsgo/strict-effect-provide -- Alchemy owns this isolated test entry and the native edge is scoped to it.
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
    // oxlint-disable-next-line effecttsgo/strict-effect-provide -- This test owns the native edge and checks that decoder diagnostics cannot reveal a private-key input.
    Effect.provide(P256.layer),
  ),
);
