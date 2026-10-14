import { Effect, Option, Predicate, Redacted, Schema } from "effect";
import { HttpClientError, HttpClientResponse } from "effect/http";

// Only documented authorization and policy codes can leave the redacted HTTP
// cause. A malformed provider response can otherwise reflect a secret here.
const AuthorizationCode = Schema.Literals([
  "missing_or_empty_authorization_header",
  "zero_correct_authorization_signatures",
  "insufficient_correct_authorization_signatures",
  "incorrect_quantity_of_authorization_signatures",
  "request_expired",
  "no_valid_user_session_keys",
  "user_session_keys_expired",
]);
const KnownCode = Schema.Union([AuthorizationCode, Schema.Literal("policy_violation")]);

export class PrivyFailure extends Schema.TaggedError<PrivyFailure>()("PrivyFailure", {
  operation: Schema.String,
  detail: Schema.String,
  kind: Schema.optional(Schema.Literals(["transport", "authorization", "validation", "response"])),
  status: Schema.optional(Schema.Int),
  code: Schema.optional(KnownCode),
  cause: Schema.optional(Schema.Defect()),
}) {}

export class PrivyPolicyRefusal extends Schema.TaggedError<PrivyPolicyRefusal>()("PrivyPolicyRefusal", {
  operation: Schema.String,
  detail: Schema.String,
  status: Schema.Int,
  code: Schema.Literal("policy_violation"),
  cause: Schema.Defect(),
}) {}

const ErrorCode = Schema.Struct({ code: KnownCode });
const isResponseDecodeFailure = Predicate.or(Predicate.isTagged("DecodeError"), Predicate.isTagged("EmptyBodyError"));

export const classifyFailure = Effect.fn("Privy.classifyFailure")(function*(operation: string, cause: unknown) {
  if (Schema.is(PrivyPolicyRefusal)(cause) || Schema.is(PrivyFailure)(cause)) return cause;
  // Foreign HTTP failures retain credentials and signatures in their request.
  // Keep that cause intact for explicit inspection, never generic logging.
  const redacted = Redacted.make(cause);
  if (HttpClientError.isHttpClientError(cause) && cause.reason._tag === "StatusCodeError") {
    const status = cause.reason.response.status;
    const parsed = yield* HttpClientResponse.schemaBodyJson(ErrorCode)(cause.reason.response).pipe(Effect.option);
    const code = Option.map(parsed, body => body.code);
    if (status >= 400 && status < 500 && Option.contains(code, "policy_violation")) {
      return new PrivyPolicyRefusal({
        operation,
        detail: "Privy refused the request under its wallet policy",
        status,
        code: "policy_violation",
        cause: redacted,
      });
    }
    return new PrivyFailure({
      operation,
      detail: "Privy rejected the request",
      kind: status === 401 || status === 403 || Option.exists(code, Schema.is(AuthorizationCode))
        ? "authorization"
        : status === 400 || status === 422
        ? "validation"
        : "response",
      status,
      ...Option.match(code, { onNone: () => ({}), onSome: value => ({ code: value }) }),
      cause: redacted,
    });
  }
  if (HttpClientError.isHttpClientError(cause) && isResponseDecodeFailure(cause.reason)) {
    return new PrivyFailure({
      operation,
      detail: "Privy response could not be decoded",
      kind: "response",
      status: cause.reason.response.status,
      cause: redacted,
    });
  }
  return new PrivyFailure({
    operation,
    detail: "Privy request or response failed",
    kind: Schema.isSchemaError(cause) ? "validation" : "transport",
    cause: redacted,
  });
});
