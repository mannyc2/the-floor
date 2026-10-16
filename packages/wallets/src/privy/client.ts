import { WalletId } from "@floor/contract/identifiers";
import { Context, type DateTime, Effect, flow, Layer, Option, Redacted, Schema } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import { P256 } from "./authorization";
import { canonicalize } from "./canonical";
import { classify, PrivyFailure, type PrivyPolicyRefusal } from "./error";
import {
  Base64Value,
  Created,
  CreatedWallet,
  type IdempotencyKey,
  Message,
  Policy,
  type PolicyId,
  PolicyInput,
  PolicyUpdateInput,
  QuorumInput,
  RequestExpiry,
  Signature,
  SignedMessage,
  SignedTransaction,
  Wallet,
  WalletInput,
  WalletUpdateInput,
} from "./schema";

const origin = "https://api.privy.io/v1/";
const strict = { onExcessProperty: "error" } satisfies Parameters<typeof Schema.decodeEffect>[1];
type RequestFailure = PrivyFailure | PrivyPolicyRefusal;

export interface Authorization {
  readonly keys: readonly CryptoKey[];
  readonly coSignatures: readonly string[];
  readonly idempotencyKey: IdempotencyKey;
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
    idempotencyKey: IdempotencyKey,
  ) => Effect.Effect<typeof Created.Type, RequestFailure>;
  readonly createWallet: (
    input: typeof WalletInput.Type,
    idempotencyKey: IdempotencyKey,
  ) => Effect.Effect<typeof CreatedWallet.Type, RequestFailure>;
  readonly signMessage: (
    input: { readonly walletId: WalletId; readonly message: string },
    authorization: Authorization,
  ) => Effect.Effect<typeof SignedMessage.Type, RequestFailure>;
  readonly signTransaction: (
    input: { readonly walletId: WalletId; readonly transaction: string },
    authorization: Authorization,
  ) => Effect.Effect<typeof SignedTransaction.Type, RequestFailure>;
  // The offline transport regression calls this with a plain string, so it
  // still decodes its own id; every other id arrives decoded and branded.
  readonly getWallet: (walletId: string) => Effect.Effect<typeof Wallet.Type, RequestFailure>;
  readonly getPolicy: (policyId: PolicyId) => Effect.Effect<typeof Policy.Type, RequestFailure>;
  readonly updateWallet: (
    walletId: WalletId,
    input: typeof WalletUpdateInput.Type,
    authorization: Authorization,
  ) => Effect.Effect<typeof Wallet.Type, RequestFailure>;
  readonly updatePolicy: (
    policyId: PolicyId,
    input: typeof PolicyUpdateInput.Type,
    authorization: Authorization,
  ) => Effect.Effect<typeof Policy.Type, RequestFailure>;
}>()("Floor/Privy/Wallets") {
  static readonly layer = Layer.effect(
    PrivyWallets,
    Effect.gen(function*() {
      const settings = yield* PrivySettings;
      const p256 = yield* P256;
      const client = (yield* HttpClient.HttpClient).pipe(
        HttpClient.mapRequest(flow(
          HttpClientRequest.prependUrl(origin),
          HttpClientRequest.basicAuth(settings.appId, settings.appSecret),
          HttpClientRequest.setHeader("privy-app-id", settings.appId),
        )),
        HttpClient.filterStatusOk,
        HttpClient.withScope,
      );
      // Every operation runs through this one pipeline, and nothing is retried.
      // The deadline owns the whole exchange, including decoding and error-code
      // inspection; the scope aborts the transport body when it expires.
      const exchange =
        <S extends Schema.Constraint>(operation: string, success: S) =>
        <E, R>(request: Effect.Effect<HttpClientRequest.HttpClientRequest, E, R>) =>
          request.pipe(
            Effect.flatMap(client.execute),
            Effect.flatMap((response) =>
              HttpClientResponse.schemaBodyJson(success)(response).pipe(
                // A decoding failure here is the provider's, and its status keeps
                // it apart from invalid caller input.
                Effect.mapError(cause =>
                  new PrivyFailure({ operation, status: response.status, cause: Redacted.make(cause) })
                ),
              )
            ),
            Effect.catch(classify(operation)),
            Effect.scoped,
            Effect.timeout("10 seconds"),
            // Only the deadline's own failure is still unclassified here.
            Effect.catch(classify(operation)),
          );
      const withBody = Effect.fnUntraced(function*(
        method: "POST" | "PATCH",
        path: string,
        body: Schema.Json,
        headers: Readonly<Record<string, string>>,
      ) {
        return HttpClientRequest.make(method)(path).pipe(
          HttpClientRequest.setHeaders(headers),
          HttpClientRequest.bodyText(yield* canonicalize(body), "application/json"),
        );
      });
      // Every authorizer signs the actual method, URL and body with the app id,
      // the stable idempotency key and any expiry. Privy, not this edge, checks
      // signer identities and the quorum: distinct CryptoKey objects need not be
      // distinct signers.
      const signed = Effect.fnUntraced(function*(
        method: "POST" | "PATCH",
        path: string,
        body: Schema.Json,
        authorization: Authorization,
      ) {
        const { keys } = authorization;
        const coSignatures = yield* Schema.decodeEffect(Schema.Array(Signature))(authorization.coSignatures);
        if (
          keys.length + coSignatures.length === 0 || new Set(keys).size !== keys.length
          || new Set(coSignatures).size !== coSignatures.length
        ) {
          return yield* new PrivyFailure({ operation: "authorize" });
        }
        const expiry = yield* Option.match(Option.fromUndefinedOr(authorization.requestExpiry), {
          onNone: () => Effect.succeed({}),
          onSome: value =>
            Schema.encodeEffect(RequestExpiry)(value).pipe(Effect.map(header => ({ "privy-request-expiry": header }))),
        });
        const headers = {
          "privy-app-id": settings.appId,
          "privy-idempotency-key": authorization.idempotencyKey,
          ...expiry,
        };
        const payload = { version: 1, method, url: `${origin}${path}`, body, headers };
        const signatures = yield* Effect.forEach(keys, key => p256.sign(key, payload));
        return yield* withBody(method, path, body, {
          ...headers,
          "privy-authorization-signature": [...coSignatures, ...signatures].join(","),
        });
      });
      return PrivyWallets.of({
        createQuorum: Effect.fn("Privy.createQuorum")(function*(input) {
          const quorum = yield* Schema.decodeEffect(QuorumInput, strict)(input);
          // Optional user_ids must be nonempty when present in Privy's API.
          const body = quorum.user_ids.length === 0
            ? {
              display_name: quorum.display_name,
              public_keys: quorum.public_keys,
              authorization_threshold: quorum.authorization_threshold,
            }
            : quorum;
          return yield* withBody("POST", "key_quorums", body, {});
        }, exchange("create-quorum", Created)),
        createPolicy: Effect.fn("Privy.createPolicy")(function*(input, idempotencyKey) {
          const body = yield* Schema.decodeEffect(PolicyInput, strict)(input);
          return yield* withBody("POST", "policies", body, { "privy-idempotency-key": idempotencyKey });
        }, exchange("create-policy", Created)),
        createWallet: Effect.fn("Privy.createWallet")(function*(input, idempotencyKey) {
          const body = yield* Schema.decodeEffect(WalletInput, strict)(input);
          return yield* withBody("POST", "wallets", body, { "privy-idempotency-key": idempotencyKey });
        }, exchange("create-wallet", CreatedWallet)),
        signMessage: Effect.fn("Privy.signMessage")(function*({ walletId, message }, authorization) {
          const params = { message: yield* Schema.decodeEffect(Message)(message), encoding: "utf-8" };
          const body = { chain_type: "ethereum", method: "personal_sign", params };
          return yield* signed("POST", `wallets/${walletId}/rpc`, body, authorization);
        }, exchange("sign-message", SignedMessage)),
        signTransaction: Effect.fn("Privy.signTransaction")(function*({ walletId, transaction }, authorization) {
          // The chain adapter owns construction and serialization. This edge
          // only signs; broadcasting would bypass the fork used before launch.
          const params = { transaction: yield* Schema.decodeEffect(Base64Value)(transaction), encoding: "base64" };
          const body = { chain_type: "solana", method: "signTransaction", params };
          return yield* signed("POST", `wallets/${walletId}/rpc`, body, authorization);
        }, exchange("sign-transaction", SignedTransaction)),
        getWallet: Effect.fn("Privy.getWallet")(
          (walletId) =>
            Schema.decodeEffect(WalletId)(walletId).pipe(Effect.map(id => HttpClientRequest.get(`wallets/${id}`))),
          exchange("get-wallet", Wallet),
        ),
        getPolicy: Effect.fn("Privy.getPolicy")(
          (policyId) => Effect.succeed(HttpClientRequest.get(`policies/${policyId}`)),
          exchange("get-policy", Policy),
        ),
        updateWallet: Effect.fn("Privy.updateWallet")(function*(walletId, input, authorization) {
          const body = yield* Schema.decodeEffect(WalletUpdateInput, strict)(input);
          return yield* signed("PATCH", `wallets/${walletId}`, body, authorization);
        }, exchange("update-wallet", Wallet)),
        updatePolicy: Effect.fn("Privy.updatePolicy")(function*(policyId, input, authorization) {
          const body = yield* Schema.decodeEffect(PolicyUpdateInput, strict)(input);
          return yield* signed("PATCH", `policies/${policyId}`, body, authorization);
        }, exchange("update-policy", Policy)),
      });
    }),
  ).pipe(Layer.provide(FetchHttpClient.layer));
}
