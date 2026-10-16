import { Effect, Option, Redacted, Schema } from "effect";
import { HttpClientError, HttpClientResponse } from "effect/http";

// Only documented authorization and policy codes can leave the redacted HTTP
// cause. A malformed provider response can otherwise reflect a secret here.
const KnownCode = Schema.Literals([
  "missing_or_empty_authorization_header",
  "zero_correct_authorization_signatures",
  "insufficient_correct_authorization_signatures",
  "incorrect_quantity_of_authorization_signatures",
  "request_expired",
  "no_valid_user_session_keys",
  "user_session_keys_expired",
  "policy_violation",
]);

// A status means Privy answered; without one the request failed before or
// without a response, and the cause says how.
export class PrivyFailure extends Schema.TaggedError<PrivyFailure>()("PrivyFailure", {
  operation: Schema.String,
  status: Schema.optional(Schema.Int),
  code: Schema.optional(KnownCode),
  cause: Schema.optional(Schema.Defect()),
}) {}

export class PrivyPolicyRefusal extends Schema.TaggedError<PrivyPolicyRefusal>()("PrivyPolicyRefusal", {
  operation: Schema.String,
  status: Schema.Int,
  code: Schema.Literal("policy_violation"),
  cause: Schema.Defect(),
}) {}

const ErrorBody = Schema.Struct({ code: KnownCode });

// The client's one classification. Only a 4xx with Privy's explicit code is a
// policy refusal; a bare 403 is not evidence of one. Foreign HTTP failures keep
// the signed request, with its credentials and signatures, so the whole cause
// stays behind Redacted for explicit inspection, never generic logging.
export const classify = (operation: string) =>
  Effect.fnUntraced(function*(cause: unknown) {
    if (Schema.is(PrivyPolicyRefusal)(cause) || Schema.is(PrivyFailure)(cause)) return yield* cause;
    const redacted = Redacted.make(cause);
    if (!HttpClientError.isHttpClientError(cause) || cause.reason._tag !== "StatusCodeError") {
      return yield* new PrivyFailure({ operation, cause: redacted });
    }
    const { status } = cause.reason.response;
    const code = yield* HttpClientResponse.schemaBodyJson(ErrorBody)(cause.reason.response).pipe(
      Effect.map((body) => body.code),
      Effect.option,
    );
    if (status >= 400 && status < 500 && Option.contains(code, "policy_violation")) {
      return yield* new PrivyPolicyRefusal({ operation, status, code: "policy_violation", cause: redacted });
    }
    return yield* new PrivyFailure({
      operation,
      status,
      ...Option.match(code, { onNone: () => ({}), onSome: (value) => ({ code: value }) }),
      cause: redacted,
    });
  });
