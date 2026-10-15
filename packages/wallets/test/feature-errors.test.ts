import * as Test from "alchemy/Test/Bun";
import { inspect } from "bun";
import { expect } from "bun:test";
import { Effect, Layer, Option, Redacted, Schema } from "effect";
import { Base64 } from "effect/encoding";
import { FetchHttpClient, HttpClientError } from "effect/http";
import { P256 } from "../src/privy/authorization";
import { PrivySettings, PrivyWallets, SolanaPolicyInput } from "../src/privy/client";
import { classifyFailure, PrivyFailure, PrivyPolicyRefusal } from "../src/privy/error";
import { appId, appSecret, capture } from "./_oracle";

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

for (
  const [name, status, code, expectedKind, exposeCode] of [
    ["policy violation", 403, "policy_violation", "policy", true],
    ["missing signature", 400, "insufficient_correct_authorization_signatures", "authorization", true],
    ["expired request", 400, "request_expired", "authorization", true],
    ["app authentication", 401, "invalid_app_secret", "authorization", false],
    ["forbidden without policy evidence", 403, "forbidden", "authorization", false],
    ["invalid request", 422, "invalid_request", "validation", false],
    ["provider failure", 500, "server_error", "response", false],
    ["policy-looking provider failure", 500, "policy_violation", "response", true],
  ] as const
) {
  const fixture = capture({ code, message: "Synthetic refusal", reflectedSecret: "never-log-this" }, status);
  withFixture(
    `classifies ${name} without retrying or losing the redacted HTTP cause`,
    fixture,
    Effect.gen(function*() {
      const pair = yield* (yield* P256).generate;
      const result = yield* (yield* PrivyWallets).signTransaction(
        { walletId: "synthetic-wallet", transaction: "AQID" },
        {
          keys: [pair.privateKey],
          coSignatures: [],
          idempotencyKey: "synthetic-operation",
        },
      ).pipe(Effect.flip);
      expect(fixture.calls).toHaveLength(1);
      expect(result.status).toBe(status);
      if (exposeCode) expect(result.code).toBe(code);
      else expect(Option.isNone(Option.fromUndefinedOr(result.code))).toBe(true);
      expect(Redacted.isRedacted(result.cause)).toBe(true);
      if (expectedKind === "policy") {
        expect(Schema.is(PrivyPolicyRefusal)(result)).toBe(true);
      } else {
        expect(Schema.is(PrivyFailure)(result)).toBe(true);
        if (Schema.is(PrivyFailure)(result)) expect(result.kind).toBe(expectedKind);
      }
      if (Redacted.isRedacted(result.cause)) {
        const cause = Redacted.value(result.cause);
        expect(HttpClientError.isHttpClientError(cause)).toBe(true);
      }
      const signatures = fixture.calls.flatMap(call =>
        Option.toArray(Option.fromNullOr(call.request.headers.get("privy-authorization-signature")))
      );
      expect(signatures).toHaveLength(1);
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
      if (Schema.is(PrivyFailure)(result)) expect(result.kind).toBe("validation");
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

const rawResponse = (body: string) => {
  const calls: Request[] = [];
  const fetch = FetchHttpClient.Fetch.of(Object.assign(
    (input: Parameters<typeof globalThis.fetch>[0], init?: Parameters<typeof globalThis.fetch>[1]) =>
      Effect.runPromise(Effect.sync(() => {
        calls.push(input instanceof Request ? new Request(input, init) : new Request(String(input), init));
        return new Response(body, { headers: { "content-type": "application/json" } });
      })),
    { preconnect: () => {} },
  ));
  return {
    calls,
    layer: PrivyWallets.layer.pipe(Layer.provideMerge(Layer.mergeAll(
      P256.layer,
      Layer.succeed(PrivySettings, PrivySettings.of({ appId, appSecret: Redacted.make(appSecret) })),
      Layer.succeed(FetchHttpClient.Fetch, fetch),
    ))),
  };
};

for (const malformed of ["{", "{}"]) {
  const invalidResponse = rawResponse(malformed);
  withFixture(
    "malformed provider JSON and response schemas are response failures, not caller validation",
    invalidResponse,
    Effect.gen(function*() {
      const error = yield* (yield* PrivyWallets).getWallet("synthetic-wallet").pipe(Effect.flip);
      expect(Schema.is(PrivyFailure)(error)).toBe(true);
      if (Schema.is(PrivyFailure)(error)) expect(error.kind).toBe("response");
      expect(error.status).toBe(200);
      expect(error.operation).toBe("get-wallet");
      expect(invalidResponse.calls).toHaveLength(1);
      expect(Redacted.isRedacted(error.cause)).toBe(true);
      if (Redacted.isRedacted(error.cause)) {
        const cause = Redacted.value(error.cause);
        if (malformed === "{") {
          expect(HttpClientError.isHttpClientError(cause)).toBe(true);
          if (HttpClientError.isHttpClientError(cause)) expect(cause.reason._tag).toBe("DecodeError");
        } else expect(Schema.isSchemaError(cause)).toBe(true);
      }
      for (const output of logged(error)) {
        expect(output).not.toContain(appSecret);
        expect(output).not.toContain(basicCredentials);
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
      return yield* new PrivyFailure({ operation: "test", detail: "Wrong synthetic rule" });
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
      const error = yield* client.createPolicy(input, "synthetic-create").pipe(Effect.flip);
      expect(Schema.is(PrivyFailure)(error)).toBe(true);
      if (Schema.is(PrivyFailure)(error)) {
        expect(error.kind).toBe("validation");
      }
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
    const pair = yield* (yield* P256).generate;
    const authorization = { keys: [pair.privateKey], coSignatures: [], idempotencyKey: "synthetic-update" };
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
      const error = yield* client.createPolicy(input, "synthetic-create").pipe(Effect.flip);
      expect(Schema.is(PrivyFailure)(error)).toBe(true);
    }
    for (
      const effect of [
        client.updatePolicy("synthetic-policy", {}, authorization).pipe(Effect.asVoid),
        client.updateWallet("synthetic-wallet", {}, authorization).pipe(Effect.asVoid),
      ]
    ) {
      const error = yield* effect.pipe(Effect.flip);
      expect(Schema.is(PrivyFailure)(error)).toBe(true);
    }
    const badTransaction = yield* client.signTransaction(
      { walletId: "synthetic-wallet", transaction: "not base64!" },
      authorization,
    ).pipe(Effect.flip);
    expect(Schema.is(PrivyFailure)(badTransaction)).toBe(true);
    expect(fixture.calls).toHaveLength(0);
  }),
);

const { test: leaf } = Test.make({ providers: Layer.empty, dev: true, sidecar: false });
leaf(
  "transport classification preserves foreign failures without inventing a policy refusal",
  Effect.gen(function*() {
    const original = { message: "synthetic disconnected transport" };
    const error = yield* classifyFailure("get-wallet", original);
    expect(Schema.is(PrivyFailure)(error)).toBe(true);
    if (Schema.is(PrivyFailure)(error)) expect(error.kind).toBe("transport");
    expect(Redacted.isRedacted(error.cause)).toBe(true);
    if (Redacted.isRedacted(error.cause)) expect(Redacted.value(error.cause)).toBe(original);
  }),
);
