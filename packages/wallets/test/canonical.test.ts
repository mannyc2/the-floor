import { formatRequestForAuthorizationSignature } from "@privy-io/node";
import * as Test from "alchemy/Test/Bun";
import { expect } from "bun:test";
import { Arbitrary, Effect, FileSystem, Layer, Path, Schema } from "effect";
import { canonicalize } from "../src/privy/canonical";

const { test } = Test.make({ providers: Layer.empty, dev: true, sidecar: false });

// UTF-8 replacement provides an independent rejection oracle for the native
// isWellFormed check. JSON permits lone surrogates; RFC 8785 explicitly does not.
const Unicode = Schema.String.check(
  Schema.makeFilter(value =>
    new TextDecoder("utf-8", { ignoreBOM: true }).decode(new TextEncoder().encode(value)) === value
  ),
);
const CanonicalJson: Schema.Codec<Schema.Json> = Schema.suspend(() =>
  Schema.Union([
    Schema.Null,
    Schema.Boolean,
    Schema.Finite,
    Unicode,
    Schema.Array(CanonicalJson),
    Schema.Record(Schema.String, CanonicalJson).check(
      Schema.makeFilter(value => Object.keys(value).every(key => Schema.is(Unicode)(key))),
    ),
  ])
);

for (const name of ["arrays", "french", "structures", "unicode", "values", "weird"]) {
  test(
    `RFC 8785 upstream reference bytes: ${name}`,
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const inputPath = yield* path.fromFileUrl(
        new URL(`./fixtures/canonical-json/input/${name}.json`, import.meta.url),
      );
      const outputPath = yield* path.fromFileUrl(
        new URL(`./fixtures/canonical-json/output/${name}.json`, import.meta.url),
      );
      const input = yield* fs.readFileString(inputPath).pipe(
        Effect.flatMap(Schema.decodeEffect(Schema.fromJsonString(Schema.Json))),
      );
      const expected = yield* fs.readFile(outputPath);
      expect(new TextEncoder().encode(yield* canonicalize(input))).toEqual(new Uint8Array(expected));
    }),
  );
}

const matchesSdk = Effect.fnUntraced(function*(value: Schema.Json) {
  // The formatter treats an empty request body specially. A nonempty envelope
  // keeps this comparison about JCS, including empty JSON arrays and objects.
  const payload = {
    version: 1,
    method: "POST",
    url: "https://api.privy.io/v1/wallets/offline-canonical/rpc",
    body: { value },
    headers: { "privy-app-id": "offline-canonical" },
  } satisfies {
    readonly version: 1;
    readonly method: "POST";
    readonly url: string;
    readonly body: { readonly value: Schema.Json };
    readonly headers: { readonly "privy-app-id": string };
  };
  const expected = formatRequestForAuthorizationSignature(payload);
  expect(new TextEncoder().encode(yield* canonicalize(payload))).toEqual(new Uint8Array(expected));
});

test(
  "JCS numeric boundaries and adversarial property names match the SDK",
  Effect.gen(function*() {
    const numbers = [
      1e21,
      5e-324,
      -0,
      Number.MAX_VALUE,
      -Number.MAX_VALUE,
      Number.MIN_VALUE,
      Number.MAX_SAFE_INTEGER,
      Number.MIN_SAFE_INTEGER,
      1e-7,
      1e-6,
      1e20,
      333333333.3333333,
      1.0000000000000002,
      2.2250738585072014e-308,
    ];
    for (const number of numbers) {
      yield* matchesSdk(number);
      yield* matchesSdk({
        "2": number,
        "10": [number, { "é": number, "e\u0301": number }],
        "01": "not an array index",
        "\uFEFFkey": "\uFEFFvalue",
        "4294967295": { "\uE000": number, "😀": number, "\r": number },
        "": { "constructor": number, ["__proto__"]: number },
      });
    }
  }),
);

for (const seed of [8785, 256, 20261013]) {
  test(
    `JCS generated JSON parity or explicit Unicode rejection (seed ${seed}, 500 values)`,
    Effect.gen(function*() {
      const values = yield* Arbitrary.sampleEffect(Arbitrary.schema(Schema.Json), { seed, count: 500, size: 12 }); // @effect-diagnostics unstableApiUsage:off -- The dev-only generator is verified against pinned Effect 4.0.3; no unstable types reach production.
      expect(values).toHaveLength(500);
      let matched = 0;
      let rejected = 0;
      for (const value of values) {
        if (Schema.is(CanonicalJson)(value)) {
          yield* matchesSdk(value);
          matched++;
        } else {
          const error = yield* canonicalize(value).pipe(Effect.flip);
          expect(error.operation).toBe("canonicalize");
          expect(error.detail).toBe("Lone surrogate");
          rejected++;
        }
      }
      expect(matched).toBeGreaterThan(100);
      expect(rejected).toBeGreaterThan(0);
    }),
  );
}

test(
  "the SDK accepts lone surrogates which RFC 8785 requires us to reject",
  Effect.gen(function*() {
    for (const value of ["\ud800", "\udfff", { "\ud800": "invalid key" }, { value: ["\udfff"] }]) {
      const sdk = formatRequestForAuthorizationSignature({
        version: 1,
        method: "POST",
        url: "https://api.privy.io/v1/wallets/offline-canonical/rpc",
        body: { value },
        headers: { "privy-app-id": "offline-canonical" },
      });
      expect(sdk.byteLength).toBeGreaterThan(0);
      const error = yield* canonicalize(value).pipe(Effect.flip);
      expect(error.detail).toBe("Lone surrogate");
    }
  }),
);
