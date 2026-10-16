import { WalletId } from "@floor/contract/identifiers";
import * as Test from "alchemy/Test/Bun";
import { expect } from "bun:test";
import { Effect, Exit, Layer, Schema } from "effect";
import { Base64 } from "effect/encoding";
import { P256 } from "../src/privy/authorization";
import { canonicalize } from "../src/privy/canonical";
import { PrivyWallets } from "../src/privy/client";
import { IdempotencyKey, PolicyInput, QuorumInput, WalletInput } from "../src/privy/schema";
import { appId, appSecret, capture } from "./_fixture";
import { fromDer, generate, verify } from "./_p256";

const { test } = Test.make({ providers: Layer.empty, dev: true, sidecar: false });
const signBody = {
  chain_type: "ethereum",
  method: "personal_sign",
  params: { message: "Floor offline probe", encoding: "utf-8" },
};
const signReply = { method: "personal_sign", data: { signature: `0x${"ab".repeat(65)}`, encoding: "hex" } };
const walletId = WalletId.make("offline-wallet");
const idempotencyKey = IdempotencyKey.make("offline-request-1");

const withFixture = <E>(
  name: string,
  fixture: ReturnType<typeof capture>,
  effect: Effect.Effect<void, E, PrivyWallets | P256>,
) => test(name, effect.pipe(Effect.provide(fixture.layer)));

const success = capture(signReply);
withFixture(
  "co-signatures cover the exact body, URL, app and idempotency header",
  success,
  Effect.gen(function*() {
    const p256 = yield* P256;
    const user = yield* generate;
    const server = yield* generate;
    const payload = {
      version: 1,
      method: "POST",
      url: "https://api.privy.io/v1/wallets/offline-wallet/rpc",
      body: signBody,
      headers: { "privy-app-id": appId, "privy-idempotency-key": idempotencyKey },
    };
    const userSignature = yield* p256.sign(user.privateKey, payload);
    const result = yield* (yield* PrivyWallets).signMessage({ walletId, message: "Floor offline probe" }, {
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
    expect(yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Json))(call.body)).toEqual(signBody);
    expect(call.request.headers.get("authorization")).toBe(`Basic ${Base64.encode(`${appId}:${appSecret}`)}`);
    const signatures = (call.request.headers.get("privy-authorization-signature") ?? "").split(",");
    expect(signatures).toHaveLength(2);
    const canonical = yield* canonicalize(payload);
    for (const [index, key] of [user.publicKey, server.publicKey].entries()) {
      const signature = yield* fromDer(signatures[index] ?? "");
      expect(yield* verify(key, canonical, signature)).toBe(true);
      expect(yield* verify(key, `${canonical} `, signature)).toBe(false);
    }
  }),
);

const create = capture({
  id: "offline-resource",
  address: `0x${"12".repeat(20)}`,
  chain_type: "ethereum",
  owner_id: "offline-quorum",
});
withFixture(
  "closed create-wallet, policy and quorum shapes use the documented endpoints",
  create,
  Effect.gen(function*() {
    const key = yield* generate;
    const publicKey = yield* (yield* P256).publicKey(key.publicKey);
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

const invalid = capture(signReply);
withFixture(
  "missing authorization and invalid wallet identity fail before transport",
  invalid,
  Effect.gen(function*() {
    const client = yield* PrivyWallets;
    for (const raw of ["offline-wallet", "../wallets"]) {
      const exit = yield* Schema.decodeEffect(WalletId)(raw).pipe(
        Effect.flatMap(id =>
          client.signMessage({ walletId: id, message: "Floor offline probe" }, {
            keys: [],
            coSignatures: [],
            idempotencyKey,
          })
        ),
        Effect.exit,
      );
      expect(Exit.isFailure(exit)).toBe(true);
    }
    expect(invalid.calls).toHaveLength(0);
  }),
);
