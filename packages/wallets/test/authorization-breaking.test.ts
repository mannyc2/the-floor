import { formatRequestForAuthorizationSignature, generateAuthorizationSignature } from "@privy-io/node";
import * as Test from "alchemy/Test/Bun";
import { expect } from "bun:test";
import { DateTime, Effect, Layer } from "effect";
import { P256 } from "../src/privy/authorization";
import { type Authorization, PrivyWallets } from "../src/privy/client";
import { appId, capture, type Captured, fromDer, privateKey, signingInput } from "./_oracle";

const { test } = Test.make({ providers: Layer.empty, dev: true, sidecar: false });
const walletId = "synthetic-wallet";
const message = "Synthetic authorization probe";
const idempotencyKey = "synthetic-request";
const requestExpiry = DateTime.makeUnsafe(1800000000000);
const body = { chain_type: "ethereum", method: "personal_sign", params: { message, encoding: "utf-8" } };
const reply = { method: "personal_sign", data: { signature: `0x${"ab".repeat(65)}`, encoding: "hex" } };
const input = {
  version: 1,
  method: "POST",
  url: `https://api.privy.io/v1/wallets/${walletId}/rpc`,
  body,
  headers: {
    "privy-app-id": appId,
    "privy-idempotency-key": idempotencyKey,
    "privy-request-expiry": String(DateTime.toEpochMillis(requestExpiry)),
  },
} satisfies Parameters<typeof formatRequestForAuthorizationSignature>[0];

// This is an offline cryptographic verifier, not a substitute for a Privy sandbox
// acceptance run. It independently uses the SDK's payload and counts identities,
// so two valid signatures from one key cannot satisfy a two-owner quorum.
const verifyQuorum = (
  p256: P256["Service"],
  publicKeys: readonly CryptoKey[],
  required: number,
) =>
  Effect.fn("Privy.breaking.verifyQuorum")(function*(call: Captured) {
    const actual = yield* signingInput(call);
    const payload = new TextDecoder().decode(formatRequestForAuthorizationSignature(actual));
    const signatures = (call.request.headers.get("privy-authorization-signature") ?? "").split(",");
    const identities = yield* Effect.forEach(publicKeys, key =>
      Effect.forEach(signatures, encoded =>
        fromDer(encoded).pipe(Effect.flatMap(raw =>
          p256.verifyRaw(key, payload, raw)
        ))).pipe(
          Effect.map(results => results.some(Boolean)),
        ));
    return identities.filter(Boolean).length >= required;
  });

const submit = (fixture: ReturnType<typeof capture>, authorization: Authorization) =>
  PrivyWallets.use(client => client.signMessage({ walletId, message }, { ...authorization, requestExpiry })).pipe(
    Effect.provide(fixture.layer),
  );

const variations = [
  { name: "body", changed: { ...input, body: { ...body, params: { ...body.params, message: "Tampered" } } } },
  { name: "URL", changed: { ...input, url: `${input.url}/changed` } },
  { name: "method", changed: { ...input, method: "PATCH" } },
  { name: "app ID", changed: { ...input, headers: { ...input.headers, "privy-app-id": "other-app" } } },
  {
    name: "idempotency key",
    changed: { ...input, headers: { ...input.headers, "privy-idempotency-key": "other-key" } },
  },
  {
    name: "expiry",
    changed: { ...input, headers: { ...input.headers, "privy-request-expiry": "1800000000001" } },
  },
] satisfies ReadonlyArray<
  { readonly name: string; readonly changed: Parameters<typeof formatRequestForAuthorizationSignature>[0] }
>;

for (const { name, changed } of variations) {
  test(
    `a signature over a different ${name} is refused by the independent verifier`,
    Effect.gen(function*() {
      const p256 = yield* P256;
      const key = yield* p256.generate;
      const encoded = yield* privateKey(key.privateKey);
      const fixture = capture(reply, 200, verifyQuorum(p256, [key.publicKey], 1));
      const correct = generateAuthorizationSignature({ authorizationPrivateKey: encoded, input });
      const wrong = generateAuthorizationSignature({ authorizationPrivateKey: encoded, input: changed });
      yield* submit(fixture, { keys: [], coSignatures: [correct], idempotencyKey });
      const error = yield* submit(fixture, { keys: [], coSignatures: [wrong], idempotencyKey }).pipe(Effect.flip);
      expect(error._tag).toBe("PrivyFailure");
      if (error._tag === "PrivyFailure") expect(error.kind).toBe("authorization");
      expect(fixture.calls).toHaveLength(2);
    }).pipe(
      Effect.provide(P256.layer),
    ),
  );
}

test(
  "a missing quorum co-signature fails although the one supplied signature is valid",
  Effect.gen(function*() {
    const p256 = yield* P256;
    const user = yield* p256.generate;
    const server = yield* p256.generate;
    const fixture = capture(reply, 200, verifyQuorum(p256, [user.publicKey, server.publicKey], 2));
    const supplied = yield* p256.sign(user.privateKey, input);
    yield* submit(fixture, { keys: [server.privateKey], coSignatures: [supplied], idempotencyKey });
    const error = yield* submit(fixture, { keys: [], coSignatures: [supplied], idempotencyKey }).pipe(Effect.flip);
    expect(error._tag).toBe("PrivyFailure");
    if (error._tag === "PrivyFailure") expect(error.code).toBe("insufficient_correct_authorization_signatures");
    expect(fixture.calls).toHaveLength(2);
  }).pipe(
    Effect.provide(P256.layer),
  ),
);

test(
  "duplicate local keys and supplied signatures fail before transport",
  Effect.gen(function*() {
    const p256 = yield* P256;
    const key = yield* p256.generate;
    const signature = yield* p256.sign(key.privateKey, input);
    const fixture = capture(reply);
    for (
      const authorization of [
        { keys: [key.privateKey, key.privateKey], coSignatures: [], idempotencyKey },
        { keys: [], coSignatures: [signature, signature], idempotencyKey },
      ]
    ) {
      const error = yield* submit(fixture, authorization).pipe(Effect.flip);
      expect(error._tag).toBe("PrivyFailure");
      if (error._tag === "PrivyFailure") expect(error.kind).toBe("authorization");
    }
    expect(fixture.calls).toHaveLength(0);
  }).pipe(
    Effect.provide(P256.layer),
  ),
);

test(
  "two signatures by one cryptographic identity cannot fill a two-owner quorum",
  Effect.gen(function*() {
    const p256 = yield* P256;
    const user = yield* p256.generate;
    const other = yield* p256.generate;
    const fixture = capture(reply, 200, verifyQuorum(p256, [user.publicKey, other.publicKey], 2));
    // Separate signature bytes bypass the superficial duplicate-string check.
    const first = yield* p256.sign(user.privateKey, input);
    const second = yield* p256.sign(user.privateKey, input);
    const error = yield* submit(fixture, { keys: [], coSignatures: [first, second], idempotencyKey }).pipe(Effect.flip);
    expect(error._tag).toBe("PrivyFailure");
    if (error._tag === "PrivyFailure") expect(error.code).toBe("insufficient_correct_authorization_signatures");
    expect(fixture.calls).toHaveLength(1);
  }).pipe(
    Effect.provide(P256.layer),
  ),
);
