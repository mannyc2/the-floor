import { WalletId } from "@floor/contract/identifiers";
import * as Test from "alchemy/Test/Bun";
import { inspect } from "bun";
import { expect } from "bun:test";
import { Effect, Layer, Option, Redacted, Schema } from "effect";
import { Base64 } from "effect/encoding";
import { HttpClientError } from "effect/http";
import type { P256 } from "../src/privy/authorization";
import { type Authorization, PrivyWallets } from "../src/privy/client";
import { classify, PrivyFailure, PrivyPolicyRefusal } from "../src/privy/error";
import { IdempotencyKey, PolicyId, SolanaPolicyInput } from "../src/privy/schema";
import { appId, appSecret, capture } from "./_fixture";
import { generate } from "./_p256";

const { test } = Test.make({ providers: Layer.empty, dev: true, sidecar: false });
const withFixture = <E>(
  name: string,
  fixture: Pick<ReturnType<typeof capture>, "layer">,
  effect: Effect.Effect<void, E, PrivyWallets | P256>,
) => test(name, effect.pipe(Effect.provide(fixture.layer)));

const logged = (error: PrivyFailure | PrivyPolicyRefusal) => {
  // oxlint-disable-next-line effect/noGlobals -- Verify ordinary JSON logging independently of the tagged error's schema encoder; provider fields must not leak credentials.
  const json = JSON.stringify(error); // @effect-diagnostics preferSchemaOverJson:off -- Native JSON logging is the boundary under test.
  return [json, inspect(error), String(error)];
};
const basicCredentials = Base64.encode(`${appId}:${appSecret}`);
const walletId = WalletId.make("synthetic-wallet");
// A failure with no status never reached Privy, and its cause says why.
const unanswered = (error: PrivyFailure | PrivyPolicyRefusal) => Option.isNone(Option.fromUndefinedOr(error.status));
const authorize = (key: CryptoKey, idempotencyKey: string): Authorization => ({
  keys: [key],
  coSignatures: [],
  idempotencyKey: IdempotencyKey.make(idempotencyKey),
});

const validPolicy = SolanaPolicyInput.make({
  version: "1.0",
  name: "Synthetic transfer instruction limits",
  chain_type: "solana",
  owner_id: "synthetic-owner",
  rules: [{
    name: "SOL transfer instruction",
    method: "signTransaction",
    action: "ALLOW",
    conditions: [{
      field_source: "solana_program_instruction",
      field: "programId",
      operator: "eq",
      value: "11111111111111111111111111111111",
    }, {
      field_source: "solana_system_program_instruction",
      field: "Transfer.lamports",
      operator: "lte",
      value: "1000000",
    }, {
      field_source: "solana_system_program_instruction",
      field: "Transfer.to",
      operator: "in",
      value: ["11111111111111111111111111111111"],
    }],
  }],
});

// The status and documented code are the whole classification: a 4xx with
// Privy's policy code is a refusal, and anything else stays a failure.
for (
  const [name, status, code, policy, exposeCode] of [
    ["policy violation", 403, "policy_violation", true, true],
    ["missing signature", 400, "insufficient_correct_authorization_signatures", false, true],
    ["expired request", 400, "request_expired", false, true],
    ["app authentication", 401, "invalid_app_secret", false, false],
    ["forbidden without policy evidence", 403, "forbidden", false, false],
    ["invalid request", 422, "invalid_request", false, false],
    ["provider failure", 500, "server_error", false, false],
    ["policy-looking provider failure", 500, "policy_violation", false, true],
  ] as const
) {
  const fixture = capture({ code, message: "Synthetic refusal", reflectedSecret: "never-log-this" }, status);
  withFixture(
    `classifies ${name} without retrying or losing the redacted HTTP cause`,
    fixture,
    Effect.gen(function*() {
      const pair = yield* generate;
      const result = yield* (yield* PrivyWallets).signTransaction(
        { walletId, transaction: "AQID" },
        authorize(pair.privateKey, "synthetic-operation"),
      ).pipe(Effect.flip);
      expect(fixture.calls).toHaveLength(1);
      expect(result.status).toBe(status);
      if (exposeCode) expect(result.code).toBe(code);
      else expect(Option.isNone(Option.fromUndefinedOr(result.code))).toBe(true);
      expect(Redacted.isRedacted(result.cause)).toBe(true);
      expect(Schema.is(PrivyPolicyRefusal)(result)).toBe(policy);
      expect(Schema.is(PrivyFailure)(result)).toBe(!policy);
      const signatures = fixture.calls.flatMap(call =>
        Option.toArray(Option.fromNullOr(call.request.headers.get("privy-authorization-signature")))
      );
      expect(signatures).toHaveLength(1);
      if (Redacted.isRedacted(result.cause)) {
        const cause = Redacted.value(result.cause);
        expect(HttpClientError.isHttpClientError(cause)).toBe(true);
        // The redacted cause keeps the signed request for explicit inspection.
        if (HttpClientError.isHttpClientError(cause)) {
          expect(cause.request.headers["privy-authorization-signature"]).toBe(signatures[0]);
        }
      }
      for (const output of logged(result)) {
        for (const secret of ["never-log-this", appSecret, basicCredentials, ...signatures]) {
          expect(output).not.toContain(secret);
        }
      }
    }),
  );
}

for (const reflectedCode of [appSecret, basicCredentials]) {
  const reflected = capture({ code: reflectedCode, message: appSecret }, 400);
  withFixture(
    "unknown provider codes stay inside the redacted cause at ordinary logging boundaries",
    reflected,
    Effect.gen(function*() {
      const result = yield* (yield* PrivyWallets).getWallet("synthetic-wallet").pipe(Effect.flip);
      expect(Schema.is(PrivyFailure)(result)).toBe(true);
      expect(result.status).toBe(400);
      expect(Option.isNone(Option.fromUndefinedOr(result.code))).toBe(true);
      for (const output of logged(result)) {
        expect(output).not.toContain(appSecret);
        expect(output).not.toContain(basicCredentials);
      }
      expect(Redacted.isRedacted(result.cause)).toBe(true);
      if (Redacted.isRedacted(result.cause)) {
        const cause = Redacted.value(result.cause);
        expect(HttpClientError.isHttpClientError(cause)).toBe(true);
        if (HttpClientError.isHttpClientError(cause) && cause.reason._tag === "StatusCodeError") {
          const originalBody = yield* cause.reason.response.json;
          expect(originalBody).toEqual({ code: reflectedCode, message: appSecret });
          expect(cause.request.headers["authorization"]).toBe(`Basic ${basicCredentials}`);
        }
      }
      expect(reflected.calls).toHaveLength(1);
    }),
  );
}

for (const malformed of ["{", "{}"]) {
  const invalidResponse = capture(new Blob([malformed]));
  withFixture(
    "malformed provider JSON and response schemas are response failures, not caller validation",
    invalidResponse,
    Effect.gen(function*() {
      const pair = yield* generate;
      const error = yield* (yield* PrivyWallets).signMessage(
        { walletId, message: "Synthetic message" },
        authorize(pair.privateKey, "synthetic-message"),
      ).pipe(Effect.flip);
      expect(Schema.is(PrivyFailure)(error)).toBe(true);
      expect(error.status).toBe(200);
      expect(error.operation).toBe("sign-message");
      expect(invalidResponse.calls).toHaveLength(1);
      expect(Redacted.isRedacted(error.cause)).toBe(true);
      if (Redacted.isRedacted(error.cause)) {
        const cause = Redacted.value(error.cause);
        if (malformed === "{") {
          expect(HttpClientError.isHttpClientError(cause)).toBe(true);
          if (HttpClientError.isHttpClientError(cause)) expect(cause.reason._tag).toBe("DecodeError");
        } else expect(Schema.isSchemaError(cause)).toBe(true);
      }
      const signatures = invalidResponse.calls.flatMap(call =>
        Option.toArray(Option.fromNullOr(call.request.headers.get("privy-authorization-signature")))
      );
      expect(signatures).toHaveLength(1);
      for (const output of logged(error)) {
        for (const secret of [appSecret, basicCredentials, ...signatures]) expect(output).not.toContain(secret);
      }
    }),
  );
}

const fixture = capture({ id: "synthetic-policy" });
withFixture(
  "closed policy inputs reject unknown fields at the root, rule and condition before transport",
  fixture,
  Effect.gen(function*() {
    const client = yield* PrivyWallets;
    const unknownRoot = { ...validPolicy, ignored: "must not disappear" };
    // Keep the tuple intact: the excess field must fail at the nested boundary,
    // not merely fail because this test lost the valid rule's static shape.
    const first = validPolicy.rules[0];

    if (first.conditions.length !== 3) {
      return yield* new PrivyFailure({ operation: "test" });
    }
    const unknownRule: typeof SolanaPolicyInput.Type = {
      ...validPolicy,
      rules: [Object.assign({}, first, { ignored: "must not disappear" })],
    };
    const unknownCondition: typeof SolanaPolicyInput.Type = {
      ...validPolicy,
      rules: [{
        ...first,
        conditions: [
          Object.assign({}, first.conditions[0], { ignored: "must not disappear" }),
          first.conditions[1],
          first.conditions[2],
        ],
      }],
    };
    for (const input of [unknownRoot, unknownRule, unknownCondition]) {
      const error = yield* client.createPolicy(input, IdempotencyKey.make("synthetic-create")).pipe(Effect.flip);
      expect(Schema.is(PrivyFailure)(error)).toBe(true);
      expect(unanswered(error)).toBe(true);
      expect(Redacted.isRedacted(error.cause) && Schema.isSchemaError(Redacted.value(error.cause))).toBe(true);
    }
    expect(fixture.calls).toHaveLength(0);
    return yield* Effect.void;
  }),
);

withFixture(
  "unsafe broad transfer-program rules and empty patches fail before transport",
  fixture,
  Effect.gen(function*() {
    const client = yield* PrivyWallets;
    const authorization = authorize((yield* generate).privateKey, "synthetic-update");
    for (
      const program of [
        "11111111111111111111111111111111",
        "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
        "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
      ]
    ) {
      const input: typeof SolanaPolicyInput.Type = {
        ...validPolicy,
        rules: [{
          name: "Unsafe broad transfer allowance",
          action: "ALLOW",
          method: "signTransaction",
          conditions: [{
            field_source: "solana_program_instruction",
            field: "programId",
            operator: "in",
            value: [program],
          }],
        }],
      };
      const error = yield* client.createPolicy(input, IdempotencyKey.make("synthetic-create")).pipe(Effect.flip);
      expect(Schema.is(PrivyFailure)(error)).toBe(true);
    }
    for (
      const effect of [
        client.updatePolicy(PolicyId.make("synthetic-policy"), {}, authorization).pipe(Effect.asVoid),
        client.updateWallet(walletId, {}, authorization).pipe(Effect.asVoid),
      ]
    ) {
      const error = yield* effect.pipe(Effect.flip);
      expect(Schema.is(PrivyFailure)(error)).toBe(true);
    }
    const badTransaction = yield* client.signTransaction(
      { walletId, transaction: "not base64!" },
      authorization,
    ).pipe(Effect.flip);
    expect(Schema.is(PrivyFailure)(badTransaction)).toBe(true);
    expect(fixture.calls).toHaveLength(0);
  }),
);

test(
  "transport classification preserves foreign failures without inventing a policy refusal",
  Effect.gen(function*() {
    const original = { message: "synthetic disconnected transport" };
    const error = yield* classify("get-wallet")(original).pipe(Effect.flip);
    expect(Schema.is(PrivyFailure)(error)).toBe(true);
    expect(unanswered(error)).toBe(true);
    expect(Redacted.isRedacted(error.cause)).toBe(true);
    if (Redacted.isRedacted(error.cause)) expect(Redacted.value(error.cause)).toBe(original);
  }),
);
