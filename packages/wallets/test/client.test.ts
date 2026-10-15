import * as Test from "alchemy/Test/Bun";
import { inspect } from "bun";
import { expect } from "bun:test";
import { Effect, Exit, Layer, Option, Redacted, Schema } from "effect";
import { Base64 } from "effect/encoding";
import { FetchHttpClient, HttpClientError } from "effect/http";
import { P256 } from "../src/privy/authorization";
import { canonicalize } from "../src/privy/canonical";
import { PolicyInput, PrivySettings, PrivyWallets, QuorumInput, WalletInput } from "../src/privy/client";
import { PrivyFailure } from "../src/privy/error";

const { test } = Test.make({ providers: Layer.empty, dev: true, sidecar: false });
const signBody = {
  chain_type: "ethereum",
  method: "personal_sign",
  params: { message: "Floor offline probe", encoding: "utf-8" },
};
const signReply = { method: "personal_sign", data: { signature: `0x${"ab".repeat(65)}`, encoding: "hex" } };
const appId = "offline-app";
const idempotencyKey = "offline-request-1";

const harness = (reply: Schema.Json, status = 200) => {
  const calls: { readonly request: Request; readonly body: Schema.Json }[] = [];
  const fetch = FetchHttpClient.Fetch.of(Object.assign(
    (input: Parameters<typeof globalThis.fetch>[0], init?: Parameters<typeof globalThis.fetch>[1]) =>
      Effect.runPromise(Effect.gen(function*() {
        const request = input instanceof Request ? new Request(input, init) : new Request(String(input), init);
        const body = yield* Effect.promise(() => request.text()).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Json))),
        );
        calls.push({ request, body });
        return new Response(yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Json))(reply), {
          status,
          headers: { "content-type": "application/json" },
        });
      })),
    { preconnect: () => {} },
  ));
  return {
    calls,
    layer: PrivyWallets.layer.pipe(Layer.provideMerge(Layer.mergeAll(
      P256.layer,
      Layer.succeed(PrivySettings, PrivySettings.of({ appId, appSecret: Redacted.make("offline-secret") })),
      Layer.succeed(FetchHttpClient.Fetch, fetch),
    ))),
  };
};
const withHarness = <E>(
  name: string,
  fixture: ReturnType<typeof harness>,
  effect: Effect.Effect<void, E, PrivyWallets | P256>,
) => test(name, effect.pipe(Effect.provide(fixture.layer)));

// An independent test decoder feeds the DER wire form back into Web Crypto.
const fromDer = Effect.fn("Privy.test.fromDer")(function*(encoded: string) {
  const bytes = yield* Effect.fromResult(Base64.decode(encoded));
  const rLength = bytes[3] ?? 0;
  const sTag = 4 + rLength;
  const sLength = bytes[sTag + 1] ?? 0;
  if (
    bytes[0] !== 48 || bytes[1] !== bytes.length - 2 || bytes[2] !== 2 || bytes[sTag] !== 2
    || rLength < 1 || rLength > 33 || sLength < 1 || sLength > 33 || sTag + 2 + sLength !== bytes.length
  ) {
    return yield* new PrivyFailure({ operation: "test-der", detail: "Invalid DER signature" });
  }
  const r = bytes.slice(4, sTag).slice(-32);
  const s = bytes.slice(sTag + 2).slice(-32);
  const raw = new Uint8Array(64);
  raw.set(r, 32 - r.length);
  raw.set(s, 64 - s.length);
  return raw;
});

const success = harness(signReply);
withHarness(
  "co-signatures cover the exact body, URL, app and idempotency header",
  success,
  Effect.gen(function*() {
    const p256 = yield* P256;
    const user = yield* p256.generate;
    const server = yield* p256.generate;
    const payload = {
      version: 1,
      method: "POST",
      url: "https://api.privy.io/v1/wallets/offline-wallet/rpc",
      body: signBody,
      headers: { "privy-app-id": appId, "privy-idempotency-key": idempotencyKey },
    };
    const userSignature = yield* p256.sign(user.privateKey, payload);
    const result = yield* (yield* PrivyWallets).signMessage({
      walletId: "offline-wallet",
      message: "Floor offline probe",
    }, {
      keys: [server.privateKey],
      coSignatures: [userSignature],
      idempotencyKey,
    });
    expect(result.method).toBe("personal_sign");
    expect(result.data.signature).toBe(signReply.data.signature);
    expect(result.data.encoding).toBe("hex");
    expect(success.calls).toHaveLength(1);
    const call = success.calls[0];
    if (!call) return;
    expect(call.request.url).toBe(payload.url);
    expect(call.request.method).toBe("POST");
    expect(call.body).toEqual(signBody);
    expect(call.request.headers.get("authorization")).toBe(`Basic ${Base64.encode("offline-app:offline-secret")}`);
    const signatures = (call.request.headers.get("privy-authorization-signature") ?? "").split(",");
    expect(signatures).toHaveLength(2);
    const canonical = yield* canonicalize(payload);
    for (const [index, key] of [user.publicKey, server.publicKey].entries()) {
      const signature = yield* fromDer(signatures[index] ?? "");
      expect(yield* p256.verifyRaw(key, canonical, signature)).toBe(true);
      expect(yield* p256.verifyRaw(key, `${canonical} `, signature)).toBe(false);
    }
  }),
);

const create = harness({
  id: "offline-resource",
  address: `0x${"12".repeat(20)}`,
  chain_type: "ethereum",
  owner_id: "offline-quorum",
});
withHarness(
  "closed create-wallet, policy and quorum shapes use the documented endpoints",
  create,
  Effect.gen(function*() {
    const p256 = yield* P256;
    const key = yield* p256.generate;
    const publicKey = yield* p256.publicKey(key.publicKey);
    const client = yield* PrivyWallets;
    yield* client.createQuorum(
      QuorumInput.make({
        display_name: "Offline quorum",
        public_keys: [publicKey],
        user_ids: ["did:privy:offline-user"],
        authorization_threshold: 2,
      }),
    );
    yield* client.createPolicy(
      PolicyInput.make({
        version: "1.0",
        name: "Offline message only",
        chain_type: "ethereum",
        owner_id: "offline-quorum",
        rules: [{
          name: "Exact message",
          method: "personal_sign",
          action: "ALLOW",
          conditions: [{ field_source: "message", field: "content", operator: "eq", value: "Floor offline probe" }],
        }],
      }),
      idempotencyKey,
    );
    yield* client.createWallet(
      WalletInput.make({ chain_type: "ethereum", owner_id: "offline-quorum", policy_ids: ["offline-policy"] }),
      idempotencyKey,
    );
    expect(create.calls.map(call => call.request.url)).toEqual([
      "https://api.privy.io/v1/key_quorums",
      "https://api.privy.io/v1/policies",
      "https://api.privy.io/v1/wallets",
    ]);
    expect(create.calls.every(call => !call.request.headers.has("privy-authorization-signature"))).toBe(true);
    expect(create.calls.map(call => call.request.headers.get("privy-idempotency-key") ?? "absent")).toEqual([
      "absent",
      idempotencyKey,
      idempotencyKey,
    ]);
  }),
);

for (
  const [name, fixture] of [["HTTP refusal", harness({ error: "denied" }, 403)], [
    "malformed success",
    harness({}),
  ]] as const
) {
  withHarness(
    `${name} retains a redacted original cause and never retries`,
    fixture,
    Effect.gen(function*() {
      const key = yield* (yield* P256).generate;
      const error = yield* (yield* PrivyWallets).signMessage({
        walletId: "offline-wallet",
        message: "Floor offline probe",
      }, { keys: [key.privateKey], coSignatures: [], idempotencyKey }).pipe(Effect.flip);
      expect(Redacted.isRedacted(error.cause)).toBe(true);
      expect(fixture.calls).toHaveLength(1);
      if (!Redacted.isRedacted(error.cause)) return;
      const cause = Redacted.value(error.cause);
      const header = Option.fromNullishOr(fixture.calls[0]?.request.headers.get("privy-authorization-signature"));
      expect(Option.isSome(header)).toBe(true);
      if (Option.isNone(header)) return;
      const signature = header.value;
      // oxlint-disable-next-line effect/noGlobals -- Check the actual generic JSON logging boundary, independently of PrivyFailure's schema encoder.
      const json = JSON.stringify(error); // @effect-diagnostics preferSchemaOverJson:off -- Native JSON logging is the behavior under test.
      const serialized = [json, inspect(error), String(error)];
      for (const secret of ["offline-secret", Base64.encode("offline-app:offline-secret"), signature]) {
        expect(serialized.every(value => !value.includes(secret))).toBe(true);
      }
      if (name === "HTTP refusal") {
        expect(HttpClientError.isHttpClientError(cause)).toBe(true);
        if (HttpClientError.isHttpClientError(cause) && cause.reason._tag === "StatusCodeError") {
          expect(cause.reason.response.status).toBe(403);
          expect(cause.request.headers["privy-authorization-signature"]).toBe(signature);
        }
      }
    }),
  );
}
const invalid = harness(signReply);
withHarness(
  "missing authorization and invalid wallet identity fail before transport",
  invalid,
  Effect.gen(function*() {
    for (const walletId of ["offline-wallet", "../wallets"]) {
      const exit = yield* (yield* PrivyWallets).signMessage({ walletId, message: "Floor offline probe" }, {
        keys: [],
        coSignatures: [],
        idempotencyKey,
      }).pipe(Effect.exit);
      expect(Exit.isFailure(exit)).toBe(true);
    }
    expect(invalid.calls).toHaveLength(0);
  }),
);
