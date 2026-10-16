import { WalletId } from "@floor/contract/identifiers";
import {
  formatRequestForAuthorizationSignature,
  generateAuthorizationSignature,
  type PrivyClient,
} from "@privy-io/node";
import * as Test from "alchemy/Test/Bun";
import { expect } from "bun:test";
import { DateTime, Effect, Layer, Option, Random, Schema } from "effect";
import { Base64 } from "effect/encoding";
// The pinned SDK exports its signing helpers, but not prepareRequest. This test-only
// import deliberately checks the same internal helper its public methods execute.
import { prepareRequest } from "../node_modules/@privy-io/node/lib/authorization.mjs";
import { P256 } from "../src/privy/authorization";
import { canonicalize } from "../src/privy/canonical";
import { type Authorization, PrivyWallets } from "../src/privy/client";
import { IdempotencyKey, PolicyId } from "../src/privy/schema";
import { appId, capture } from "./_fixture";
import { compareSignatures, compareWire, oracleClient, privateKey } from "./_oracle";
import { generate } from "./_p256";

const { test } = Test.make({ providers: Layer.empty, dev: true, sidecar: false });
const messageReply = { method: "personal_sign", data: { signature: `0x${"ab".repeat(65)}`, encoding: "hex" } };
const transactionReply = { method: "signTransaction", data: { signed_transaction: "AQID", encoding: "base64" } };

const check = Effect.fn("Privy.oracle.check")(function*<A, B, E>(
  reply: Schema.Json,
  nativeCall: (client: PrivyWallets["Service"]) => Effect.Effect<A, E>,
  sdkCall: (sdk: PrivyClient) => PromiseLike<B> | Effect.Effect<B>,
  publicKeys: readonly CryptoKey[] = [],
) {
  const fixture = capture(reply);
  yield* PrivyWallets.use(nativeCall).pipe(
    Effect.provide(fixture.layer),
  );
  const sdkResult = sdkCall(oracleClient(fixture.fetch));
  yield* Effect.isEffect(sdkResult) ? sdkResult : Effect.promise(() => sdkResult);
  expect(fixture.calls).toHaveLength(2);
  const [native, sdk] = fixture.calls;
  if (!native || !sdk) return;
  compareWire(native, sdk);
  if (publicKeys.length > 0) yield* compareSignatures(native, sdk, publicKeys);
  else {
    expect(native.request.headers.has("privy-authorization-signature")).toBe(false);
    expect(sdk.request.headers.has("privy-authorization-signature")).toBe(false);
  }
});

const generatedCases = Effect.gen(function*() {
  const p256 = yield* P256;
  const keys = yield* Effect.all([generate, generate, generate]);
  const exported = yield* Effect.forEach(keys, key => privateKey(key.privateKey));
  const publicKeys = keys.map(key => key.publicKey);
  const sdkPrivateKeys = exported.slice(1);
  const userKey = exported[0];
  expect(exported).toHaveLength(3);
  expect(userKey).toBeDefined();
  expect(userKey).not.toBe("");
  if (!userKey) return;
  const quorumPublicKeys = yield* Effect.forEach(publicKeys, p256.publicKey);

  for (let index = 0; index < 12; index++) {
    const token = String(yield* Random.nextIntBetween(100000, 999999));
    const id = `synthetic-${token}`;
    const walletId = WalletId.make(id);
    const policyId = PolicyId.make(id);
    const owner = `owner-${token}`;
    const idempotencyKey = IdempotencyKey.make(`request-${token}`);
    const requestExpiry = index % 2 === 0
      ? Option.some(DateTime.makeUnsafe(1800000000000 + index * 1000))
      : Option.none();
    const expiryMillis = Option.map(requestExpiry, DateTime.toEpochMillis);
    const message = `Synthetic ${token}: ö € 😀\n`;
    const transaction = Base64.encode(new Uint8Array([index, 0, 255, ...new TextEncoder().encode(token)]));
    const walletReply = {
      id,
      address: "So11111111111111111111111111111111111111112",
      chain_type: "solana",
      owner_id: owner,
      policy_ids: [`policy-${token}`],
    };
    const ethereumWallet = { ...walletReply, address: `0x${token.padEnd(40, "0")}`, chain_type: "ethereum" };
    // Construct SDK inputs in lexical order because its ordinary JSON serializer
    // retains insertion order. The raw-order witness below preserves that difference.
    const quorum = {
      authorization_threshold: index % 3 + 1,
      display_name: `Synthetic quorum ${token}`,
      public_keys: [quorumPublicKeys[0] ?? "", ...quorumPublicKeys.slice(1)],
      user_ids: index % 2 === 0 ? [`did:privy:${token}`] : [],
    } satisfies Parameters<PrivyWallets["Service"]["createQuorum"]>[0];
    yield* check(
      { id },
      client => client.createQuorum(quorum),
      sdk =>
        sdk.keyQuorums().create(
          quorum.user_ids.length > 0 ? quorum : {
            authorization_threshold: quorum.authorization_threshold,
            display_name: quorum.display_name,
            public_keys: quorum.public_keys,
          },
        ),
    );
    const policy = {
      chain_type: "ethereum",
      name: `Synthetic policy ${token}`,
      owner_id: owner,
      rules: [{
        action: "ALLOW",
        conditions: [{ field: "content", field_source: "message", operator: "eq", value: message }],
        method: "personal_sign",
        name: "Exact message",
      }],
      version: "1.0",
    } satisfies Parameters<PrivyWallets["Service"]["createPolicy"]>[0];
    const policyReply = {
      ...policy,
      id,
      created_at: 1800000000000,
      rules: policy.rules.map(rule => ({ ...rule, id })),
    };
    yield* check(
      policyReply,
      client => client.createPolicy(policy, idempotencyKey),
      sdk => sdk.policies().create({ ...policy, idempotency_key: idempotencyKey }),
    );
    const solanaPolicy = {
      chain_type: "solana",
      name: `Synthetic SOL cap ${token}`,
      owner_id: owner,
      rules: [{
        action: "ALLOW",
        conditions: [{
          field: "programId",
          field_source: "solana_program_instruction",
          operator: "in",
          value: [walletReply.address],
        }],
        method: "signTransaction",
        name: "Synthetic program allowlist",
      }, {
        action: "ALLOW",
        conditions: [
          {
            field: "programId",
            field_source: "solana_program_instruction",
            operator: "eq",
            value: "11111111111111111111111111111111",
          },
          {
            field: "Transfer.lamports",
            field_source: "solana_system_program_instruction",
            operator: "lte",
            value: token,
          },
          {
            field: "Transfer.to",
            field_source: "solana_system_program_instruction",
            operator: "in",
            value: [walletReply.address],
          },
        ],
        method: "signTransaction",
        name: "Capped SOL transfer",
      }, {
        action: "ALLOW",
        conditions: [{
          field: "programId",
          field_source: "solana_program_instruction",
          operator: "in",
          value: ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"],
        }, {
          field: "TransferChecked.mint",
          field_source: "solana_token_program_instruction",
          operator: "eq",
          value: walletReply.address,
        }, {
          field: "TransferChecked.amount",
          field_source: "solana_token_program_instruction",
          operator: "lte",
          value: token,
        }, {
          field: "TransferChecked.destination",
          field_source: "solana_token_program_instruction",
          operator: "in",
          value: [walletReply.address],
        }],
        method: "signTransaction",
        name: "Capped token transfer",
      }],
      version: "1.0",
    } satisfies Parameters<PrivyWallets["Service"]["createPolicy"]>[0];
    const solanaPolicyReply = {
      ...solanaPolicy,
      id,
      created_at: 1800000000000,
      rules: solanaPolicy.rules.map(rule => ({ ...rule, id })),
    };
    yield* check(
      solanaPolicyReply,
      client => client.createPolicy(solanaPolicy, idempotencyKey),
      sdk => sdk.policies().create({ ...solanaPolicy, idempotency_key: idempotencyKey }),
    );
    for (const chain_type of ["ethereum", "solana"] as const) {
      const wallet = { chain_type, owner_id: owner, policy_ids: [`policy-${token}`] } satisfies Parameters<
        PrivyWallets["Service"]["createWallet"]
      >[0];
      yield* check(
        chain_type === "solana" ? walletReply : ethereumWallet,
        client => client.createWallet(wallet, idempotencyKey),
        sdk => sdk.wallets().create({ ...wallet, idempotency_key: idempotencyKey }),
      );
    }
    yield* check(walletReply, client => client.getWallet(id), sdk => sdk.wallets().get(id));
    yield* check(ethereumWallet, client => client.getWallet(id), sdk => sdk.wallets().get(id));
    yield* check(policyReply, client => client.getPolicy(policyId), sdk => sdk.policies().get(id));
    yield* check(solanaPolicyReply, client => client.getPolicy(policyId), sdk => sdk.policies().get(id));

    const authorize = (method: "POST" | "PATCH", path: string, body: Schema.Json) => {
      const input = {
        version: 1,
        method,
        url: `https://api.privy.io/v1/${path}`,
        body,
        headers: {
          "privy-app-id": appId,
          "privy-idempotency-key": idempotencyKey,
          ...Option.match(expiryMillis, {
            onNone: () => ({}),
            onSome: value => ({ "privy-request-expiry": String(value) }),
          }),
        },
      } satisfies Parameters<typeof formatRequestForAuthorizationSignature>[0];
      const signature = generateAuthorizationSignature({ authorizationPrivateKey: userKey, input });
      return {
        native: {
          keys: keys.slice(1).map(key => key.privateKey),
          coSignatures: [signature],
          idempotencyKey,
          ...Option.match(requestExpiry, { onNone: () => ({}), onSome: value => ({ requestExpiry: value }) }),
        } satisfies Authorization,
        sdk: {
          authorization_context: { authorization_private_keys: sdkPrivateKeys, signatures: [signature] },
          idempotency_key: idempotencyKey,
          ...Option.match(expiryMillis, { onNone: () => ({}), onSome: value => ({ request_expiry: value }) }),
        },
        input,
      };
    };
    const messageBody = {
      chain_type: "ethereum",
      method: "personal_sign",
      params: { encoding: "utf-8", message },
    } satisfies Parameters<ReturnType<PrivyClient["wallets"]>["rpc"]>[1];
    const messageAuth = authorize("POST", `wallets/${id}/rpc`, messageBody);
    yield* check(
      messageReply,
      client => client.signMessage({ walletId, message }, messageAuth.native),
      sdk => sdk.wallets().rpc(id, { ...messageBody, ...messageAuth.sdk }),
      publicKeys,
    );
    const transactionBody = {
      chain_type: "solana",
      method: "signTransaction",
      params: { encoding: "base64", transaction },
    } satisfies Parameters<ReturnType<PrivyClient["wallets"]>["rpc"]>[1];
    const transactionAuth = authorize("POST", `wallets/${id}/rpc`, transactionBody);
    yield* check(
      transactionReply,
      client => client.signTransaction({ walletId, transaction }, transactionAuth.native),
      sdk => sdk.wallets().rpc(id, { ...transactionBody, ...transactionAuth.sdk }),
      publicKeys,
    );

    const walletUpdate = { owner_id: owner, policy_ids: [`replacement-${token}`] } satisfies Parameters<
      PrivyWallets["Service"]["updateWallet"]
    >[1];
    const walletAuth = authorize("PATCH", `wallets/${id}`, walletUpdate);
    yield* check(
      walletReply,
      client => client.updateWallet(walletId, walletUpdate, walletAuth.native),
      sdk =>
        Effect.gen(function*() {
          const prepared = yield* Effect.promise(() =>
            prepareRequest(sdk, appId, {
              authorizationContext: walletAuth.sdk.authorization_context,
              idempotencyKey,
              requestExpiry: Option.getOrUndefined(expiryMillis),
              method: "PATCH",
              url: walletAuth.input.url,
              body: walletUpdate,
            })
          );
          // oxlint-disable-next-line eslint/no-underscore-dangle -- The generated SDK PATCH edge accepts headers from prepareRequest; its convenience method omits idempotency.
          return yield* Effect.promise(() => sdk.wallets()._update(id, walletUpdate, prepared));
        }),
      publicKeys,
    );
    const policyUpdate = { name: `Revised ${token}`, owner_id: owner, rules: solanaPolicy.rules };
    const policyAuth = authorize("PATCH", `policies/${id}`, policyUpdate);
    yield* check(
      solanaPolicyReply,
      client => client.updatePolicy(policyId, policyUpdate, policyAuth.native),
      sdk =>
        Effect.gen(function*() {
          const prepared = yield* Effect.promise(() =>
            prepareRequest(sdk, appId, {
              authorizationContext: policyAuth.sdk.authorization_context,
              idempotencyKey,
              requestExpiry: Option.getOrUndefined(expiryMillis),
              method: "PATCH",
              url: policyAuth.input.url,
              body: policyUpdate,
            })
          );
          // oxlint-disable-next-line eslint/no-underscore-dangle -- Exercise the generated PATCH transport with the SDK helper's signed idempotency header.
          return yield* Effect.promise(() => sdk.policies()._update(id, policyUpdate, prepared));
        }),
      publicKeys,
    );
  }
});

test(
  "156 seeded native operations match the pinned SDK wire and cross-verify three signers",
  generatedCases.pipe(
    Random.withSeed(0x50726976),
    Effect.provide(P256.layer),
  ),
  { timeout: 30000 },
);

test(
  "raw SDK insertion order differs from canonical native wire without changing signing payloads",
  Effect.gen(function*() {
    const body = {
      policy_ids: ["synthetic-policy"],
      owner_id: "synthetic-owner",
      chain_type: "ethereum",
    } satisfies Parameters<ReturnType<PrivyClient["wallets"]>["create"]>[0];
    const fixture = capture({ id: "synthetic-wallet" });
    yield* Effect.promise(() => oracleClient(fixture.fetch).wallets().create(body));
    expect(fixture.calls).toHaveLength(1);
    const call = fixture.calls[0];
    if (!call) return;
    const native = yield* canonicalize(body);
    expect(native).not.toBe(call.body);
    expect(yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Json))(call.body)).toEqual(body);
    const input = {
      version: 1,
      method: "POST",
      url: call.request.url,
      body,
      headers: { "privy-app-id": appId },
    } satisfies Parameters<typeof formatRequestForAuthorizationSignature>[0];
    expect(new TextDecoder().decode(formatRequestForAuthorizationSignature(input))).toBe(yield* canonicalize(input));
  }),
);
