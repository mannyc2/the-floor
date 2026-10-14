import { Context, DateTime, Effect, Layer, Option, Redacted, Schema, type Scope } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import { P256 } from "./authorization";
import { canonicalize } from "./canonical";
import { classifyFailure, PrivyFailure, PrivyPolicyRefusal } from "./error";
import {
  Created,
  CreatedWallet,
  Id,
  Policy,
  PolicyInput,
  PolicyUpdateInput,
  QuorumInput,
  Signature,
  SignedMessage,
  SignedTransaction,
  SignMessageInput,
  SignTransactionInput,
  Wallet,
  WalletInput,
  WalletUpdateInput,
} from "./schema";

export {
  PolicyInput,
  PolicyUpdateInput,
  QuorumInput,
  SolanaPolicyInput,
  SolanaPolicyRule,
  SolanaTokenTransferInstructionRule,
  SolanaTransferInstructionRule,
  WalletInput,
  WalletUpdateInput,
} from "./schema";

const strict = { onExcessProperty: "error" } satisfies Parameters<typeof Schema.decodeEffect>[1];
const wrap = (operation: string) => (cause: unknown) =>
  classifyFailure(operation, cause).pipe(Effect.flatMap(Effect.fail));
type RequestFailure = PrivyFailure | PrivyPolicyRefusal;
const decodeResponse =
  <S extends Schema.Constraint>(operation: string, schema: S) => (response: HttpClientResponse.HttpClientResponse) =>
    HttpClientResponse.schemaBodyJson(schema)(response).pipe(
      // Input Schema errors identify bad caller data. The same error from a
      // response belongs to the provider edge and must stay distinguishable.
      Effect.mapError(cause =>
        new PrivyFailure({
          operation,
          detail: "Privy response could not be decoded",
          kind: "response",
          status: response.status,
          cause: Redacted.make(cause),
        })
      ),
    );

// The deadline owns the entire response, including decoding and error-code
// inspection. Scoping the transport aborts its body when that deadline expires.
const complete = (operation: string) => <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
  effect.pipe(
    Effect.catch(wrap(operation)),
    Effect.scoped,
    Effect.timeout("10 seconds"),
    Effect.mapError(cause =>
      Schema.is(PrivyFailure)(cause) || Schema.is(PrivyPolicyRefusal)(cause)
        ? cause
        : new PrivyFailure({
          operation,
          detail: "Privy request deadline exceeded",
          kind: "transport",
          cause: Redacted.make(cause),
        })
    ),
  );

export interface Authorization {
  readonly keys: readonly CryptoKey[];
  readonly coSignatures: readonly string[];
  readonly idempotencyKey: string;
  readonly requestExpiry?: DateTime.Utc;
}
export class PrivySettings extends Context.Service<PrivySettings, {
  readonly appId: string;
  readonly appSecret: Redacted.Redacted;
}>()("Floor/Privy/Settings") {}

export class PrivyWallets extends Context.Service<PrivyWallets, {
  readonly createQuorum: (input: typeof QuorumInput.Type) => Effect.Effect<typeof Created.Type, RequestFailure>;
  readonly createPolicy: (
    input: typeof PolicyInput.Type,
    idempotencyKey: string,
  ) => Effect.Effect<typeof Created.Type, RequestFailure>;
  readonly createWallet: (
    input: typeof WalletInput.Type,
    idempotencyKey: string,
  ) => Effect.Effect<typeof CreatedWallet.Type, RequestFailure>;
  readonly signMessage: (
    input: typeof SignMessageInput.Type,
    authorization: Authorization,
  ) => Effect.Effect<typeof SignedMessage.Type, RequestFailure>;
  readonly signTransaction: (
    input: typeof SignTransactionInput.Type,
    authorization: Authorization,
  ) => Effect.Effect<typeof SignedTransaction.Type, RequestFailure>;
  readonly getWallet: (walletId: string) => Effect.Effect<typeof Wallet.Type, RequestFailure>;
  readonly getPolicy: (policyId: string) => Effect.Effect<typeof Policy.Type, RequestFailure>;
  readonly updateWallet: (
    walletId: string,
    input: typeof WalletUpdateInput.Type,
    authorization: Authorization,
  ) => Effect.Effect<typeof Wallet.Type, RequestFailure>;
  readonly updatePolicy: (
    policyId: string,
    input: typeof PolicyUpdateInput.Type,
    authorization: Authorization,
  ) => Effect.Effect<typeof Policy.Type, RequestFailure>;
}>()("Floor/Privy/Wallets") {
  static readonly layer = Layer.effect(
    PrivyWallets,
    Effect.gen(function*() {
      const settings = yield* PrivySettings;
      const p256 = yield* P256;
      const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk, HttpClient.withScope);
      const send = Effect.fn("Privy.send")(
        function*(
          method: "POST" | "PATCH",
          path: string,
          body: Schema.Json,
          headers: Readonly<Record<string, string>>,
        ) {
          const json = yield* canonicalize(body);
          return yield* HttpClientRequest.make(method)(`https://api.privy.io/v1/${path}`).pipe(
            HttpClientRequest.basicAuth(settings.appId, Redacted.value(settings.appSecret)),
            HttpClientRequest.setHeaders({ "privy-app-id": settings.appId, ...headers }),
            HttpClientRequest.bodyText(json, "application/json"),
            client.execute,
          );
        },
      );
      const get = Effect.fn("Privy.get")(function*(path: string) {
        return yield* HttpClientRequest.get(`https://api.privy.io/v1/${path}`).pipe(
          HttpClientRequest.basicAuth(settings.appId, Redacted.value(settings.appSecret)),
          HttpClientRequest.setHeader("privy-app-id", settings.appId),
          client.execute,
        );
      });
      // Mutations are never retried. Every authorizer signs the actual HTTP
      // method, stable idempotency identity and optional expiry with the body.
      const request = Effect.fn("Privy.request")(
        function*(method: "POST" | "PATCH", path: string, body: Schema.Json, authorization: Authorization) {
          const idempotencyKey = yield* Schema.decodeEffect(Id)(authorization.idempotencyKey);
          const supplied = yield* Schema.decodeEffect(Schema.Array(Signature))(authorization.coSignatures);
          if (
            new Set(authorization.keys).size !== authorization.keys.length || new Set(supplied).size !== supplied.length
          ) {
            return yield* new PrivyFailure({
              operation: path,
              detail: "Duplicate request authorizers are not allowed",
              kind: "authorization",
            });
          }
          const expiry = Option.fromUndefinedOr(authorization.requestExpiry);
          const expiryHeaders = yield* Option.match(expiry, {
            onNone: () => Effect.succeed({}),
            onSome: value =>
              Schema.decodeEffect(Schema.DateTimeUtc)(value).pipe(
                Effect.map(DateTime.toEpochMillis),
                Effect.flatMap(Schema.decodeEffect(Schema.Int.check(Schema.isGreaterThan(0)))),
                Effect.map(millis => ({ "privy-request-expiry": String(millis) })),
              ),
          });
          const url = `https://api.privy.io/v1/${path}`;
          const headers = { "privy-app-id": settings.appId, "privy-idempotency-key": idempotencyKey, ...expiryHeaders };
          const payload = { version: 1, method, url, body, headers };
          const signatures = yield* Effect.forEach(authorization.keys, key => p256.sign(key, payload));
          const signed = [...supplied, ...signatures];
          if (signed.length === 0) {
            return yield* new PrivyFailure({
              operation: path,
              detail: "At least one request signature is required",
              kind: "authorization",
            });
          }
          // Privy checks cryptographic signer identities and the configured
          // quorum. Distinct CryptoKey objects need not be distinct signers.
          return yield* send(method, path, body, { ...headers, "privy-authorization-signature": signed.join(",") });
        },
      );
      return PrivyWallets.of({
        createQuorum: Effect.fn("Privy.createQuorum")(function*(input) {
          const parsed = yield* Schema.decodeEffect(QuorumInput, strict)(input);
          // Optional user_ids must be nonempty when present in Privy's API.
          const body = parsed.user_ids.length === 0
            ? {
              display_name: parsed.display_name,
              public_keys: parsed.public_keys,
              authorization_threshold: parsed.authorization_threshold,
            }
            : parsed;
          return yield* send("POST", "key_quorums", body, {}).pipe(
            Effect.flatMap(decodeResponse("create-quorum", Created)),
          );
        }, complete("create-quorum")),
        createPolicy: Effect.fn("Privy.createPolicy")(function*(input, idempotencyKey) {
          const body = yield* Schema.decodeEffect(PolicyInput, strict)(input);
          const key = yield* Schema.decodeEffect(Id)(idempotencyKey);
          return yield* send("POST", "policies", body, { "privy-idempotency-key": key }).pipe(
            Effect.flatMap(decodeResponse("create-policy", Created)),
          );
        }, complete("create-policy")),
        createWallet: Effect.fn("Privy.createWallet")(function*(input, idempotencyKey) {
          const body = yield* Schema.decodeEffect(WalletInput, strict)(input);
          const key = yield* Schema.decodeEffect(Id)(idempotencyKey);
          return yield* send("POST", "wallets", body, { "privy-idempotency-key": key }).pipe(
            Effect.flatMap(decodeResponse("create-wallet", CreatedWallet)),
          );
        }, complete("create-wallet")),
        signMessage: Effect.fn("Privy.signMessage")(function*(input, authorization) {
          const parsed = yield* Schema.decodeEffect(SignMessageInput, strict)(input);
          const body = {
            chain_type: "ethereum",
            method: "personal_sign",
            params: { message: parsed.message, encoding: "utf-8" },
          };
          return yield* request("POST", `wallets/${parsed.walletId}/rpc`, body, authorization).pipe(
            Effect.flatMap(decodeResponse("sign-message", SignedMessage)),
          );
        }, complete("sign-message")),
        signTransaction: Effect.fn("Privy.signTransaction")(function*(input, authorization) {
          const parsed = yield* Schema.decodeEffect(SignTransactionInput, strict)(input);
          // The chain adapter owns construction and serialization. This edge
          // only signs; broadcasting would bypass the fork used before launch.
          const body = {
            chain_type: "solana",
            method: "signTransaction",
            params: { transaction: parsed.transaction, encoding: "base64" },
          };
          return yield* request("POST", `wallets/${parsed.walletId}/rpc`, body, authorization).pipe(
            Effect.flatMap(decodeResponse("sign-transaction", SignedTransaction)),
          );
        }, complete("sign-transaction")),
        getWallet: Effect.fn("Privy.getWallet")(function*(walletId) {
          const id = yield* Schema.decodeEffect(Id)(walletId);
          return yield* get(`wallets/${id}`).pipe(Effect.flatMap(decodeResponse("get-wallet", Wallet)));
        }, complete("get-wallet")),
        getPolicy: Effect.fn("Privy.getPolicy")(function*(policyId) {
          const id = yield* Schema.decodeEffect(Id)(policyId);
          return yield* get(`policies/${id}`).pipe(Effect.flatMap(decodeResponse("get-policy", Policy)));
        }, complete("get-policy")),
        updateWallet: Effect.fn("Privy.updateWallet")(function*(walletId, input, authorization) {
          const id = yield* Schema.decodeEffect(Id)(walletId);
          const body = yield* Schema.decodeEffect(WalletUpdateInput, strict)(input);
          return yield* request("PATCH", `wallets/${id}`, body, authorization).pipe(
            Effect.flatMap(decodeResponse("update-wallet", Wallet)),
          );
        }, complete("update-wallet")),
        updatePolicy: Effect.fn("Privy.updatePolicy")(function*(policyId, input, authorization) {
          const id = yield* Schema.decodeEffect(Id)(policyId);
          const body = yield* Schema.decodeEffect(PolicyUpdateInput, strict)(input);
          return yield* request("PATCH", `policies/${id}`, body, authorization).pipe(
            Effect.flatMap(decodeResponse("update-policy", Policy)),
          );
        }, complete("update-policy")),
      });
    }),
  ).pipe(Layer.provide(FetchHttpClient.layer));
}
