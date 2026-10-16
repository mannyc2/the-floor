import { AuthenticateOwner, CurrentOwner } from "@floor/api/auth";
import { AuthenticatedOwner, AuthenticationError } from "@floor/contract/auth";
import * as Test from "alchemy/Test/Bun";
import { expect } from "bun:test";
import { ConfigProvider, Deferred, Effect, Fiber, Layer, Redacted, Schema, Struct } from "effect";
import { FetchHttpClient } from "effect/http";
import { Rpc, RpcGroup, RpcTest } from "effect/rpc";
import { TestClock } from "effect/testing";
import { CompactSign, exportJWK, generateKeyPair, UnsecuredJWT } from "jose";
import { PrivyTokenFailure, PrivyTokens } from "../src/owners/auth";

const { test } = Test.make({ providers: Layer.empty, dev: true, sidecar: false });
const appId = "synthetic-auth-app";
const now = 1_800_000_000;
const subject = "synthetic-owner";
const webClaims = {
  aud: appId,
  iss: "privy.io",
  sub: `did:privy:${subject}`,
  sid: "synthetic-session",
  exp: now + 60,
};
const cliClaims = {
  aud: appId,
  iss: `privy:${appId}`,
  sub: subject,
  grant: "device_code",
  exp: now + 60,
};
const json = Schema.fromJsonString(Schema.Json);
const signPayload = (payload: string, key: CryptoKey | Uint8Array, algorithm: string, keyId: string) =>
  Effect.promise(() =>
    new CompactSign(new TextEncoder().encode(payload)).setProtectedHeader({ alg: algorithm, kid: keyId }).sign(key)
  );
const sign = Effect.fnUntraced(function*(
  claims: Schema.JsonObject,
  key: CryptoKey | Uint8Array,
  algorithm: string = "ES256",
  keyId: string = "synthetic-key",
) {
  const payload = yield* Schema.encodeEffect(json)(claims);
  return yield* signPayload(payload, key, algorithm, keyId);
});

// Keys and claims are generated only for these offline tests. They are not a
// recording of Privy's sandbox or evidence of the provider's live behavior.
const fixture = Effect.gen(function*() {
  const trusted = yield* Effect.promise(() => generateKeyPair("ES256", { extractable: true }));
  const attacker = yield* Effect.promise(() => generateKeyPair("ES256", { extractable: true }));
  const es384 = yield* Effect.promise(() => generateKeyPair("ES384"));
  const publicKey = yield* Effect.promise(() => exportJWK(trusted.publicKey));
  const jwks = yield* Schema.decodeEffect(Schema.Json)({
    keys: [{ ...publicKey, kid: "synthetic-key", alg: "ES256", use: "sig" }],
  }).pipe(Effect.flatMap(Schema.encodeEffect(json)));
  return { trusted, attacker, es384, jwks };
});

const tokenLayer = (fetch: typeof globalThis.fetch, configured = true) =>
  PrivyTokens.layer.pipe(Layer.provide(Layer.mergeAll(
    Layer.succeed(FetchHttpClient.Fetch, fetch),
    ConfigProvider.layer(ConfigProvider.fromUnknown(configured ? { PRIVY_APP_ID: appId } : {})),
  )));

class SyntheticFetchFailure extends Schema.TaggedError<SyntheticFetchFailure>()("SyntheticFetchFailure", {
  operation: Schema.Literal("jwks"),
}) {}

const makeHarness = (body: string, options: {
  readonly status?: number;
  readonly unavailable?: boolean;
  readonly configured?: boolean;
} = {}) => {
  const requests: Request[] = [];
  const unavailable = new SyntheticFetchFailure({ operation: "jwks" });
  const fetch = FetchHttpClient.Fetch.of(Object.assign(
    (input: Parameters<typeof globalThis.fetch>[0], init?: Parameters<typeof globalThis.fetch>[1]) => {
      requests.push(input instanceof Request ? new Request(input, init) : new Request(String(input), init));
      return Effect.runPromise(
        options.unavailable === true
          ? Effect.fail(unavailable)
          : Effect.sync(() =>
            new Response(body, {
              status: options.status ?? 200,
              headers: { "content-type": "application/json" },
            })
          ),
      );
    },
    { preconnect: () => {} },
  ));
  const layer = tokenLayer(fetch, options.configured);
  return { requests, unavailable, layer };
};

const stalledHarness = Effect.fnUntraced(function*(body: string) {
  const started = yield* Deferred.make<void>();
  const release = yield* Deferred.make<void>();
  const requests: Request[] = [];
  const context = yield* Effect.context();
  // The native fetch edge requires a Promise. Bind it to this test's context
  // and cancellation signal so a stalled response never opens a socket.
  const run = Effect.runPromiseWith(context);
  const fetch = FetchHttpClient.Fetch.of(Object.assign(
    (input: Parameters<typeof globalThis.fetch>[0], init?: Parameters<typeof globalThis.fetch>[1]) => {
      const request = input instanceof Request ? new Request(input, init) : new Request(String(input), init);
      requests.push(request);
      return run(
        Effect.gen(function*() {
          yield* Deferred.succeed(started, void 0);
          yield* Deferred.await(release);
          return new Response(body, { headers: { "content-type": "application/json" } });
        }),
        { signal: request.signal },
      );
    },
    { preconnect: () => {} },
  ));
  return { requests, started, release, layer: tokenLayer(fetch) };
});

const withTokens = <E>(
  harness: { readonly layer: ReturnType<typeof tokenLayer> },
  check: Effect.Effect<void, E, PrivyTokens>,
) =>
  Effect.gen(function*() {
    yield* TestClock.setTime(now * 1000);
    yield* check;
  }).pipe(Effect.provide(Layer.mergeAll(harness.layer, TestClock.layer())));

test(
  "signed web and CLI claims normalize the subject and retain their distinct origins",
  Effect.gen(function*() {
    const keys = yield* fixture;
    const harness = makeHarness(keys.jwks);
    yield* withTokens(
      harness,
      Effect.gen(function*() {
        const tokens = yield* PrivyTokens;
        const web = yield* sign(
          { ...webClaims, iat: now - 60, nbf: now, custom: "ignored claim" },
          keys.trusted.privateKey,
        );
        const cli = yield* sign(cliClaims, keys.trusted.privateKey);
        expect(yield* tokens.verify(Redacted.make(web))).toEqual({ subject: `did:privy:${subject}`, origin: "web" });
        expect(yield* tokens.verify(Redacted.make(cli))).toEqual({ subject: `did:privy:${subject}`, origin: "cli" });
        expect(harness.requests.map((request) => ({ url: request.url, method: request.method }))).toEqual([{
          url: `https://api.privy.io/v1/apps/${appId}/jwks.json`,
          method: "GET",
        }]);
        expect(harness.requests.every((request) => !request.headers.has("authorization"))).toBe(true);
      }),
    );
  }),
);

const invalidClaims: ReadonlyArray<readonly [string, Schema.JsonObject]> = [
  ["missing audience", Struct.omit(webClaims, ["aud"])],
  ["another audience", { ...webClaims, aud: "another-app" }],
  ["audience list", { ...webClaims, aud: [appId, "another-app"] }],
  ["missing issuer", Struct.omit(webClaims, ["iss"])],
  ["unknown issuer", { ...webClaims, iss: "https://privy.io" }],
  ["another CLI application", { ...cliClaims, iss: "privy:another-app" }],
  ["web issuer with CLI claims", { ...cliClaims, iss: "privy.io" }],
  ["CLI issuer with web claims", { ...webClaims, iss: `privy:${appId}` }],
  ["missing web session", Struct.omit(webClaims, ["sid"])],
  ["empty web session", { ...webClaims, sid: "" }],
  ["non-string web session", { ...webClaims, sid: 42 }],
  ["web device grant", { ...webClaims, grant: "device_code" }],
  ["web other grant", { ...webClaims, grant: "authorization_code" }],
  ["unprefixed web subject", { ...webClaims, sub: subject }],
  ["empty web DID suffix", { ...webClaims, sub: "did:privy:" }],
  ["missing web subject", Struct.omit(webClaims, ["sub"])],
  ["non-string web subject", { ...webClaims, sub: 42 }],
  ["missing CLI grant", Struct.omit(cliClaims, ["grant"])],
  ["other CLI grant", { ...cliClaims, grant: "authorization_code" }],
  ["CLI session", { ...cliClaims, sid: "synthetic-session" }],
  ["prefixed CLI subject", { ...cliClaims, sub: `did:privy:${subject}` }],
  ["empty CLI subject", { ...cliClaims, sub: "" }],
  ["missing CLI subject", Struct.omit(cliClaims, ["sub"])],
  ["whitespace CLI subject", { ...cliClaims, sub: "synthetic owner" }],
  ["expired token", { ...webClaims, exp: now - 1 }],
  ["expiry at the current instant", { ...webClaims, exp: now }],
  ["missing expiry", Struct.omit(webClaims, ["exp"])],
  ["string expiry", { ...webClaims, exp: String(now + 60) }],
  ["future not-before", { ...webClaims, nbf: now + 1 }],
  ["string not-before", { ...webClaims, nbf: String(now) }],
  ["string issued-at", { ...webClaims, iat: String(now) }],
];
for (const [name, claims] of invalidClaims) {
  test(
    `signed token rejects ${name}`,
    Effect.gen(function*() {
      const keys = yield* fixture;
      const harness = makeHarness(keys.jwks);
      const token = yield* sign(claims, keys.trusted.privateKey);
      yield* withTokens(
        harness,
        Effect.gen(function*() {
          const failure = yield* (yield* PrivyTokens).verify(Redacted.make(token)).pipe(Effect.flip);
          expect(Schema.is(PrivyTokenFailure)(failure)).toBe(true);
          expect(Redacted.isRedacted(failure.cause)).toBe(true);
        }),
      );
    }),
  );
}

const invalidNumericClaims: ReadonlyArray<readonly [string, string]> = [
  ["null expiry", "\"exp\":null"],
  ["non-finite expiry", "\"exp\":1e309"],
  ["non-finite issued-at", `"exp":${now + 60},"iat":1e309`],
  ["non-finite not-before", `"exp":${now + 60},"nbf":1e309`],
];
for (const [name, fields] of invalidNumericClaims) {
  test(
    `signed wire token rejects ${name}`,
    Effect.gen(function*() {
      const keys = yield* fixture;
      // Raw wire text preserves invalid numeric claims that the typed JSON
      // encoder refuses before a synthetic token can reach the verifier.
      const payload =
        `{"aud":"${appId}","iss":"privy.io","sub":"did:privy:${subject}","sid":"synthetic-session",${fields}}`;
      const token = yield* signPayload(payload, keys.trusted.privateKey, "ES256", "synthetic-key");
      const harness = makeHarness(keys.jwks);
      yield* withTokens(
        harness,
        Effect.gen(function*() {
          const failure = yield* (yield* PrivyTokens).verify(Redacted.make(token)).pipe(Effect.flip);
          expect(Schema.is(PrivyTokenFailure)(failure)).toBe(true);
        }),
      );
    }),
  );
}

test(
  "expiry follows the Effect clock on every verification, including cached signing keys",
  Effect.gen(function*() {
    const keys = yield* fixture;
    const token = yield* sign(webClaims, keys.trusted.privateKey);
    const harness = makeHarness(keys.jwks);
    yield* withTokens(
      harness,
      Effect.gen(function*() {
        const tokens = yield* PrivyTokens;
        expect((yield* tokens.verify(Redacted.make(token))).origin).toBe("web");
        yield* TestClock.adjust("60 seconds");
        const failure = yield* tokens.verify(Redacted.make(token)).pipe(Effect.flip);
        expect(failure.stage).toBe("verification");
        expect(harness.requests).toHaveLength(1);
      }),
    );
  }),
);

test(
  "a token expiring while JWKS is pending cannot authenticate when the keys arrive",
  Effect.gen(function*() {
    const keys = yield* fixture;
    const token = yield* sign(webClaims, keys.trusted.privateKey);
    const harness = yield* stalledHarness(keys.jwks);
    yield* withTokens(
      harness,
      Effect.gen(function*() {
        const tokens = yield* PrivyTokens;
        const verifying = yield* tokens.verify(Redacted.make(token)).pipe(Effect.forkChild);
        yield* Deferred.await(harness.started);
        yield* TestClock.adjust("60 seconds");
        yield* Deferred.succeed(harness.release, void 0);
        const failure = yield* Fiber.join(verifying).pipe(Effect.flip);
        expect(failure.stage).toBe("claims");
        expect(harness.requests).toHaveLength(1);
      }),
    );
  }),
);

test(
  "closing the verifier scope aborts its pending shared JWKS request",
  Effect.gen(function*() {
    const keys = yield* fixture;
    const token = yield* sign(webClaims, keys.trusted.privateKey);
    const harness = yield* stalledHarness(keys.jwks);
    yield* withTokens(
      harness,
      Effect.gen(function*() {
        const verifying = yield* (yield* PrivyTokens).verify(Redacted.make(token)).pipe(Effect.forkChild);
        yield* Deferred.await(harness.started);
        yield* Fiber.interrupt(verifying);
        expect(harness.requests.every((request) => request.signal.aborted)).toBe(false);
      }),
    );
    expect(harness.requests).toHaveLength(1);
    expect(harness.requests.every((request) => request.signal.aborted)).toBe(true);
  }),
);

test(
  "missing application configuration fails before accessing JWKS",
  Effect.gen(function*() {
    const keys = yield* fixture;
    const harness = makeHarness(keys.jwks, { configured: false });
    const failure = yield* Effect.provide(PrivyTokens, harness.layer).pipe(Effect.flip);
    expect(failure._tag).toBe("ConfigError");
    expect(harness.requests).toHaveLength(0);
  }),
);

test(
  "signature verification rejects attacker keys, altered payloads, unsupported algorithms and malformed tokens",
  Effect.gen(function*() {
    const keys = yield* fixture;
    const trusted = yield* sign(webClaims, keys.trusted.privateKey);
    const attacker = yield* sign(webClaims, keys.attacker.privateKey);
    const otherPayload = yield* sign({ ...webClaims, sub: "did:privy:another-owner" }, keys.trusted.privateKey);
    const trustedParts = trusted.split(".");
    const changedParts = otherPayload.split(".");
    const altered = [trustedParts[0], changedParts[1], trustedParts[2]].join(".");
    const es384 = yield* sign(webClaims, keys.es384.privateKey, "ES384");
    const hs256 = yield* sign(webClaims, new TextEncoder().encode("synthetic-HMAC-secret-with-enough-bytes"), "HS256");
    const unknownKey = yield* sign(webClaims, keys.trusted.privateKey, "ES256", "unknown-key");
    const unsigned = new UnsecuredJWT(webClaims).encode();
    const attackerPublic = yield* Effect.promise(() => exportJWK(keys.attacker.publicKey));
    const attackerPayload = yield* Schema.encodeEffect(json)(webClaims);
    const selfPublished = yield* Effect.promise(() =>
      new CompactSign(new TextEncoder().encode(attackerPayload)).setProtectedHeader({
        alg: "ES256",
        kid: "synthetic-key",
        jwk: attackerPublic,
        jku: "https://attacker.invalid/jwks.json",
      }).sign(keys.attacker.privateKey)
    );
    const harness = makeHarness(keys.jwks);
    yield* withTokens(
      harness,
      Effect.gen(function*() {
        const tokens = yield* PrivyTokens;
        for (const token of [attacker, altered, es384, hs256, unknownKey, unsigned, selfPublished, "not-a-jwt", ""]) {
          const failure = yield* tokens.verify(Redacted.make(token)).pipe(Effect.flip);
          expect(failure.stage).toBe("verification");
        }
        expect(harness.requests.map((request) => request.url)).toEqual([
          `https://api.privy.io/v1/apps/${appId}/jwks.json`,
        ]);
      }),
    );
  }),
);

const invalidJwks: ReadonlyArray<readonly [string, string, number]> = [
  ["HTTP refusal", "{}", 403],
  ["invalid JSON", "not-json", 200],
  ["invalid JWKS shape", "{}", 200],
  ["empty signing set", "{\"keys\":[]}", 200],
  [
    "invalid key material",
    "{\"keys\":[{\"kty\":\"EC\",\"crv\":\"P-256\",\"kid\":\"synthetic-key\",\"x\":\"invalid\",\"y\":\"invalid\"}]}",
    200,
  ],
];
for (const [name, body, status] of invalidJwks) {
  test(
    `JWKS fails closed on ${name}`,
    Effect.gen(function*() {
      const keys = yield* fixture;
      const token = yield* sign(webClaims, keys.trusted.privateKey);
      const harness = makeHarness(body, { status });
      yield* withTokens(
        harness,
        Effect.gen(function*() {
          const failure = yield* (yield* PrivyTokens).verify(Redacted.make(token)).pipe(Effect.flip);
          expect(failure.stage).toBe("verification");
          expect(harness.requests).toHaveLength(1);
        }),
      );
    }),
  );
}

test(
  "JWKS transport failures retain their original cause behind redaction",
  Effect.gen(function*() {
    const keys = yield* fixture;
    const token = yield* sign(webClaims, keys.trusted.privateKey);
    const harness = makeHarness(keys.jwks, { unavailable: true });
    yield* withTokens(
      harness,
      Effect.gen(function*() {
        const failure = yield* (yield* PrivyTokens).verify(Redacted.make(token)).pipe(Effect.flip);
        expect(Redacted.isRedacted(failure.cause)).toBe(true);
        if (Redacted.isRedacted(failure.cause)) expect(Redacted.value(failure.cause)).toBe(harness.unavailable);
      }),
    );
  }),
);

const Protected = RpcGroup.make(Rpc.make("owner", {
  payload: Schema.Record(Schema.String, Schema.Never),
  success: AuthenticatedOwner,
})).middleware(AuthenticateOwner);

test(
  "protected RPC injects authenticated owners and denies failures before executing the handler",
  Effect.gen(function*() {
    const keys = yield* fixture;
    const web = yield* sign(webClaims, keys.trusted.privateKey);
    const cli = yield* sign(cliClaims, keys.trusted.privateKey);
    const leakedMarker = "signed-sensitive-marker";
    const invalid = yield* sign({ ...webClaims, sid: "", private_marker: leakedMarker }, keys.trusted.privateKey);
    const harness = makeHarness(keys.jwks);
    let calls = 0;
    const handlers = Protected.toLayer({
      owner: () =>
        Effect.gen(function*() {
          const owner = yield* CurrentOwner;
          calls += 1;
          return owner;
        }),
    });
    yield* Effect.gen(function*() {
      yield* TestClock.setTime(now * 1000);
      const client = yield* RpcTest.makeClient(Protected);
      expect(yield* client.owner({}, { headers: { authorization: `Bearer ${web}` } })).toEqual({
        subject: `did:privy:${subject}`,
        origin: "web",
      });
      expect(yield* client.owner({}, { headers: { authorization: `bearer ${cli}` } })).toEqual({
        subject: `did:privy:${subject}`,
        origin: "cli",
      });
      const missing = yield* client.owner({}).pipe(Effect.flip);
      expect(missing._tag).toBe("AuthenticationError");
      expect(missing.reason).toBe("missing_token");
      for (const authorization of ["", "Bearer", `Basic ${web}`, `Bearer ${web},${cli}`, `Bearer ${invalid}`]) {
        const failure = yield* client.owner({}, { headers: { authorization } }).pipe(Effect.flip);
        expect(failure._tag).toBe("AuthenticationError");
        expect(failure.reason).toBe("invalid_token");
        const encoded = yield* Schema.encodeEffect(Schema.fromJsonString(AuthenticationError))(failure);
        expect(encoded).not.toContain(leakedMarker);
        expect(encoded).not.toContain(web);
        expect(encoded).not.toContain(invalid);
      }
      expect(calls).toBe(2);
    }).pipe(
      Effect.scoped,
      Effect.provide(Layer.mergeAll(
        handlers,
        Layer.unwrap(
          Effect.map(PrivyTokens, ({ verify }) => AuthenticateOwner.layer(verify)),
        ).pipe(Layer.provide(harness.layer)),
        TestClock.layer(),
      )),
    );
  }),
);
