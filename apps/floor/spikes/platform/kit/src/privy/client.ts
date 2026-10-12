import { Context, Effect, Layer, Redacted, Schema } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import { P256 } from "./authorization";
import { canonicalize } from "./canonical";
import { PrivyFailure } from "./error";

const Id = Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9_-]{1,128}$/));
const Label = Schema.NonEmptyString.check(Schema.isMaxLength(50));
const Message = Schema.NonEmptyString.check(Schema.isMaxLength(1024));
const Signature = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9+/]+={0,2}$/));

export const QuorumInput = Schema.Struct({
  display_name: Label,
  public_keys: Schema.NonEmptyArray(Signature),
  user_ids: Schema.Array(Schema.NonEmptyString),
  authorization_threshold: Schema.Int.check(Schema.isGreaterThan(0)),
}).check(
  Schema.makeFilter(input =>
    input.authorization_threshold <= new Set([...input.public_keys, ...input.user_ids]).size
    && new Set(input.public_keys).size === input.public_keys.length
    && new Set(input.user_ids).size === input.user_ids.length
  ),
);
export const WalletInput = Schema.Struct({
  chain_type: Schema.Literal("ethereum"),
  owner_id: Id,
  policy_ids: Schema.NonEmptyArray(Id),
});
export const PolicyInput = Schema.Struct({
  version: Schema.Literal("1.0"),
  name: Label,
  chain_type: Schema.Literal("ethereum"),
  owner_id: Id,
  rules: Schema.Tuple([Schema.Struct({
    name: Label,
    method: Schema.Literal("personal_sign"),
    action: Schema.Literals(["ALLOW", "DENY"]),
    conditions: Schema.Tuple([Schema.Struct({
      field_source: Schema.Literal("message"),
      field: Schema.Literal("content"),
      operator: Schema.Literal("eq"),
      value: Message,
    })]),
  })]),
});
const Created = Schema.Struct({ id: Id });
const Wallet = Schema.Struct({
  id: Id,
  address: Schema.String.check(Schema.isPattern(/^0x[0-9a-fA-F]{40}$/)),
  chain_type: Schema.Literal("ethereum"),
  owner_id: Id,
});
const Signed = Schema.Struct({
  method: Schema.Literal("personal_sign"),
  data: Schema.Struct({
    signature: Schema.String.check(Schema.isPattern(/^0x[0-9a-fA-F]{130}$/)),
    encoding: Schema.Literal("hex"),
  }),
});
const SignInput = Schema.Struct({ walletId: Id, message: Message });

const wrap = (operation: string) => (cause: unknown) =>
  new PrivyFailure({ operation, detail: "Privy request or response failed", cause });

export interface Authorization {
  readonly keys: readonly CryptoKey[];
  readonly coSignatures: readonly string[];
  readonly idempotencyKey: string;
}
export class PrivySettings extends Context.Service<PrivySettings, {
  readonly appId: string;
  readonly appSecret: Redacted.Redacted;
}>()("Floor/Privy/Settings") {}

export class PrivyWallets extends Context.Service<PrivyWallets, {
  readonly createQuorum: (
    input: typeof QuorumInput.Type,
  ) => Effect.Effect<typeof Created.Type, PrivyFailure>;
  readonly createPolicy: (
    input: typeof PolicyInput.Type,
    idempotencyKey: string,
  ) => Effect.Effect<typeof Created.Type, PrivyFailure>;
  readonly createWallet: (
    input: typeof WalletInput.Type,
    idempotencyKey: string,
  ) => Effect.Effect<typeof Wallet.Type, PrivyFailure>;
  readonly signMessage: (
    input: typeof SignInput.Type,
    authorization: Authorization,
  ) => Effect.Effect<typeof Signed.Type, PrivyFailure>;
}>()("Floor/Privy/Wallets") {
  static readonly layer = Layer.effect(
    PrivyWallets,
    Effect.gen(function*() {
      const settings = yield* PrivySettings;
      const p256 = yield* P256;
      const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);
      // Creation uses application authentication. Only wallet actions require
      // owner signatures; a new quorum has no existing owner to authorize it.
      const post = Effect.fn("Privy.post")(
        function*(path: string, body: Schema.Json, headers: Readonly<Record<string, string>>) {
          const json = yield* canonicalize(body);
          return yield* HttpClientRequest.post(`https://api.privy.io/v1/${path}`).pipe(
            HttpClientRequest.basicAuth(settings.appId, Redacted.value(settings.appSecret)),
            HttpClientRequest.setHeaders({ "privy-app-id": settings.appId, ...headers }),
            HttpClientRequest.bodyText(json, "application/json"),
            client.execute,
            Effect.timeout("10 seconds"),
          );
        },
      );
      // Mutations are never automatically retried. Every authorizer signs the
      // caller's stable idempotency identity and the same request body.
      const request = Effect.fn("Privy.request")(
        function*(path: string, body: Schema.Json, authorization: Authorization) {
          const idempotencyKey = yield* Schema.decodeEffect(Id)(authorization.idempotencyKey);
          const supplied = yield* Schema.decodeEffect(Schema.Array(Signature))(authorization.coSignatures);
          const url = `https://api.privy.io/v1/${path}`;
          const headers = { "privy-app-id": settings.appId, "privy-idempotency-key": idempotencyKey };
          const payload = { version: 1, method: "POST", url, body, headers };
          const signatures = yield* Effect.forEach(authorization.keys, key => p256.sign(key, payload));
          const signed = [...supplied, ...signatures];
          if (signed.length === 0) {
            return yield* new PrivyFailure({ operation: path, detail: "At least one request signature is required" });
          }
          return yield* post(path, body, { ...headers, "privy-authorization-signature": signed.join(",") });
        },
      );
      return PrivyWallets.of({
        createQuorum: Effect.fn("Privy.createQuorum")(function*(input) {
          const parsed = yield* Schema.decodeEffect(QuorumInput)(input);
          // The documented optional array must be nonempty when present.
          const body = parsed.user_ids.length === 0
            ? {
              display_name: parsed.display_name,
              public_keys: parsed.public_keys,
              authorization_threshold: parsed.authorization_threshold,
            }
            : parsed;
          return yield* post("key_quorums", body, {}).pipe(
            Effect.flatMap(HttpClientResponse.schemaBodyJson(Created)),
          );
        }, Effect.mapError(wrap("create-quorum"))),
        createPolicy: Effect.fn("Privy.createPolicy")(function*(input, idempotencyKey) {
          const body = yield* Schema.decodeEffect(PolicyInput)(input);
          const key = yield* Schema.decodeEffect(Id)(idempotencyKey);
          return yield* post("policies", body, { "privy-idempotency-key": key }).pipe(
            Effect.flatMap(HttpClientResponse.schemaBodyJson(Created)),
          );
        }, Effect.mapError(wrap("create-policy"))),
        createWallet: Effect.fn("Privy.createWallet")(function*(input, idempotencyKey) {
          const body = yield* Schema.decodeEffect(WalletInput)(input);
          const key = yield* Schema.decodeEffect(Id)(idempotencyKey);
          return yield* post("wallets", body, { "privy-idempotency-key": key }).pipe(
            Effect.flatMap(HttpClientResponse.schemaBodyJson(Wallet)),
          );
        }, Effect.mapError(wrap("create-wallet"))),
        signMessage: Effect.fn("Privy.signMessage")(function*(input, authorization) {
          const parsed = yield* Schema.decodeEffect(SignInput)(input);
          const body = {
            chain_type: "ethereum",
            method: "personal_sign",
            params: { message: parsed.message, encoding: "utf-8" },
          };
          return yield* request(`wallets/${parsed.walletId}/rpc`, body, authorization).pipe(
            Effect.flatMap(HttpClientResponse.schemaBodyJson(Signed)),
          );
        }, Effect.mapError(wrap("sign-message"))),
      });
    }),
  ).pipe(Layer.provide(FetchHttpClient.layer));
}
