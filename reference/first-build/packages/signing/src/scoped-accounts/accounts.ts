import { Policy } from "@floor/contract";
import { Config, Context, Crypto, DateTime, Effect, Layer, Option, Schema } from "effect";
import { Hex } from "effect/encoding";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import { SigningUnavailable, TransactionOutcomeUnknown } from "../execution";
import { fingerprintProposal } from "../policy";
import {
  AccountBinding,
  AccountQuote,
  AccountReadResponse,
  DispatchRequest,
  DispatchResponse,
  PreparedExecution,
  PrepareRequest,
  QuoteRequest,
  type ScopedAccount,
} from "./protocol";

export const sameAccountBinding = (left: AccountBinding, right: AccountBinding): boolean =>
  left.ownerId === right.ownerId && left.agentId === right.agentId && left.policyHash === right.policyHash
  && left.ownerAddress.toLowerCase() === right.ownerAddress.toLowerCase();

export const accountIsCurrent = (binding: AccountBinding, account: ScopedAccount, now: DateTime.Utc): boolean =>
  sameAccountBinding(binding, account.binding)
  && DateTime.toEpochMillis(account.expiresAt) > DateTime.toEpochMillis(now)
  && DateTime.toEpochMillis(account.observedAt) <= DateTime.toEpochMillis(now)
  && DateTime.toEpochMillis(now) - DateTime.toEpochMillis(account.observedAt) <= 60_000;

export class ScopedAccounts extends Context.Service<ScopedAccounts, {
  readonly status: { readonly configured: boolean; readonly detail: string };
  binding(
    ownerId: string,
    ownerAddress: `0x${string}`,
    agentId: string,
    policy: Policy,
  ): Effect.Effect<AccountBinding, SigningUnavailable>;
  read(binding: AccountBinding): Effect.Effect<Option.Option<ScopedAccount>, SigningUnavailable>;
  quote(request: typeof QuoteRequest.Type): Effect.Effect<AccountQuote, SigningUnavailable>;
  prepare(request: PrepareRequest): Effect.Effect<PreparedExecution, SigningUnavailable>;
  dispatch(request: DispatchRequest): Effect.Effect<DispatchResponse, TransactionOutcomeUnknown>;
}>()("@floor/signing/ScopedAccounts") {}

const configuredAccounts = Effect.gen(function*() {
  const endpoint = yield* Config.URL("FLOOR_SIGNER_URL").pipe(Config.option);
  const token = yield* Config.Redacted("FLOOR_SIGNER_TOKEN").pipe(Config.option);
  const crypto = yield* Crypto.Crypto;
  const baseClient = yield* HttpClient.HttpClient;
  const binding = Effect.fn("ScopedAccounts.binding")(
    function*(ownerId: string, ownerAddress: `0x${string}`, agentId: string, policy: Policy) {
      if (Option.isNone(Option.fromNullishOr(policy.confirmedAt))) {
        return yield* new SigningUnavailable({
          message: "An owner-confirmed policy is required before linking a scoped account.",
        });
      }
      const encoded = yield* Schema.encodeEffect(Schema.fromJsonString(Policy))(policy);
      const digest = yield* crypto.digest("SHA-256", new TextEncoder().encode(encoded));
      return yield* Schema.decodeEffect(AccountBinding)({
        ownerId,
        ownerAddress,
        agentId,
        policyHash: `0x${Hex.encode(digest)}`,
      });
    },
    Effect.mapError(() =>
      new SigningUnavailable({ message: "The confirmed policy could not be bound to this owner account." })
    ),
  );

  if (Option.isNone(endpoint) || Option.isNone(token)) {
    const unavailable = new SigningUnavailable({
      message: "Connect an owner-authorized Base Sepolia scoped signing service before moving funds.",
    });
    return ScopedAccounts.of({
      status: {
        configured: false,
        detail:
          "Set FLOOR_SIGNER_URL and FLOOR_SIGNER_TOKEN, then authorize each account at that service. No signing service is connected.",
      },
      binding,
      read: () => Effect.succeedNone,
      quote: () => Effect.fail(unavailable),
      prepare: () => Effect.fail(unavailable),
      dispatch: () =>
        Effect.fail(new TransactionOutcomeUnknown({ message: "No scoped signing service is connected." })),
    });
  }
  const url = endpoint.value;
  if (
    url.protocol !== "https:" || url.username.length > 0 || url.password.length > 0 || url.search.length > 0
    || url.hash.length > 0
  ) {
    return yield* new SigningUnavailable({
      message: "FLOOR_SIGNER_URL must be an HTTPS endpoint without credentials, query parameters or a fragment.",
    });
  }
  const client = baseClient.pipe(
    HttpClient.mapRequest(HttpClientRequest.prependUrl(url.toString().replace(/\/$/, ""))),
    HttpClient.mapRequest(HttpClientRequest.bearerToken(token.value)),
    HttpClient.filterStatusOk,
  );
  return ScopedAccounts.of({
    status: {
      configured: true,
      detail:
        "Scoped signing endpoint configured. Account ownership, current on-chain permissions and simulation are verified for each proposal; configuration alone grants no authority.",
    },
    binding,
    read: Effect.fn("ScopedAccounts.read")(
      function*(request: AccountBinding) {
        const body = yield* HttpClientRequest.schemaBodyJson(AccountBinding)(
          HttpClientRequest.post("/v1/accounts/read"),
          request,
        );
        const response = yield* client.execute(body).pipe(
          Effect.flatMap(HttpClientResponse.schemaBodyJson(AccountReadResponse)),
        );
        if (response.status === "unlinked") return Option.none();
        if (!accountIsCurrent(request, response.account, yield* DateTime.now)) {
          return yield* new SigningUnavailable({
            message: "The scoped account response is stale or does not match this owner and confirmed policy.",
          });
        }
        return Option.some(response.account);
      },
      Effect.timeout("10 seconds"),
      Effect.mapError(() =>
        new SigningUnavailable({ message: "The owner-authorized scoped account could not be verified." })
      ),
    ),
    quote: Effect.fn("ScopedAccounts.quote")(
      function*(request: typeof QuoteRequest.Type) {
        const body = yield* HttpClientRequest.schemaBodyJson(QuoteRequest)(
          HttpClientRequest.post("/v1/accounts/quote"),
          request,
        );
        const response = yield* client.execute(body).pipe(
          Effect.flatMap(HttpClientResponse.schemaBodyJson(AccountQuote)),
        );
        const now = DateTime.toEpochMillis(yield* DateTime.now);
        if (
          !sameAccountBinding(request.binding, response.binding)
          || response.proposalFingerprint !== fingerprintProposal(request.proposal)
          || DateTime.toEpochMillis(response.observedAt) > now
          || now - DateTime.toEpochMillis(response.observedAt) > 60_000
          || DateTime.toEpochMillis(response.expiresAt) <= now
        ) {
          return yield* new SigningUnavailable({
            message: "The independent account quote is stale or belongs to another proposal.",
          });
        }
        return response;
      },
      Effect.timeout("10 seconds"),
      Effect.mapError(() =>
        new SigningUnavailable({ message: "A fresh independent account valuation is unavailable." })
      ),
    ),
    prepare: Effect.fn("ScopedAccounts.prepare")(
      function*(request: PrepareRequest) {
        const body = yield* HttpClientRequest.schemaBodyJson(PrepareRequest)(
          HttpClientRequest.post("/v1/transactions/prepare"),
          request,
        );
        return yield* client.execute(body).pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(PreparedExecution)));
      },
      Effect.timeout("10 seconds"),
      Effect.mapError(() =>
        new SigningUnavailable({
          message: "The transaction could not be prepared and simulated. Nothing was submitted.",
        })
      ),
    ),
    dispatch: Effect.fn("ScopedAccounts.dispatch")(
      function*(request: DispatchRequest) {
        const body = yield* HttpClientRequest.schemaBodyJson(DispatchRequest)(
          HttpClientRequest.post("/v1/transactions/dispatch").pipe(
            HttpClientRequest.setHeader("Idempotency-Key", request.receiptId),
          ),
          request,
        );
        // This is the only sending request. No automatic retries: a lost response may already have accepted a transaction.
        return yield* client.execute(body).pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(DispatchResponse)));
      },
      Effect.timeout("20 seconds"),
      Effect.mapError(() =>
        new TransactionOutcomeUnknown({
          message:
            "The scoped signer may have accepted this transaction. Reconcile its original receipt; do not resend.",
        })
      ),
    ),
  });
});

/** @stability unstable */
export const scopedAccountsLayer = Layer.effect(ScopedAccounts, configuredAccounts);
