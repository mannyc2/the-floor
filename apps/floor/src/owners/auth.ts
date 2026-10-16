import { AuthenticatedOwner, PrivySubject } from "@floor/contract/auth";
import { Config, Context, DateTime, Effect, Layer, Redacted, Schema } from "effect";
import { FetchHttpClient } from "effect/http";
import { createRemoteJWKSet, customFetch, jwtVerify } from "jose";

export class PrivyTokenFailure extends Schema.TaggedError<PrivyTokenFailure>()("PrivyTokenFailure", {
  stage: Schema.Literals(["verification", "claims"]),
  cause: Schema.Defect(),
}) {}

const CliSubject = Schema.NonEmptyString.check(
  Schema.isPattern(/^\S+$/),
  Schema.makeFilter((subject) => !subject.startsWith("did:privy:")),
);

export class PrivyTokens extends Context.Service<PrivyTokens, {
  readonly verify: (token: Redacted.Redacted) => Effect.Effect<AuthenticatedOwner, PrivyTokenFailure>;
}>()("floor/owners/PrivyTokens") {
  static readonly layer = Layer.effect(
    PrivyTokens,
    Effect.gen(function*() {
      const appId = yield* Config.NonEmptyString("PRIVY_APP_ID");
      const fetch = yield* FetchHttpClient.Fetch;
      // A resolver shares key retrieval across callers. Request cancellation must
      // not cancel another caller; the service scope still owns pending fetches.
      const lifetime = yield* Effect.acquireRelease(
        Effect.sync(() => new AbortController()),
        (controller) => Effect.sync(() => controller.abort()),
      );
      const keys = createRemoteJWKSet(new URL(`https://api.privy.io/v1/apps/${encodeURIComponent(appId)}/jwks.json`), {
        [customFetch]: (url, options) =>
          fetch(url, { ...options, signal: AbortSignal.any([options.signal, lifetime.signal]) }),
      });
      const common = {
        aud: Schema.Literal(appId),
        exp: Schema.Finite,
        iat: Schema.optionalKey(Schema.Finite),
        nbf: Schema.optionalKey(Schema.Finite),
      };
      // The two observed token families must not be combined into a third one.
      const claims = Schema.Union([
        Schema.Struct({
          ...common,
          iss: Schema.Literal("privy.io"),
          sub: PrivySubject,
          sid: Schema.NonEmptyString,
          grant: Schema.optionalKey(Schema.Never),
        }),
        Schema.Struct({
          ...common,
          iss: Schema.Literal(`privy:${appId}`),
          sub: CliSubject,
          grant: Schema.Literal("device_code"),
          sid: Schema.optionalKey(Schema.Never),
        }),
      ]);
      const verify = Effect.fn("PrivyTokens.verify")(function*(token: Redacted.Redacted) {
        const currentDate = yield* DateTime.nowAsDate;
        const verified = yield* Effect.tryPromise({
          try: () =>
            jwtVerify(Redacted.value(token), keys, {
              algorithms: ["ES256"],
              audience: appId,
              issuer: ["privy.io", `privy:${appId}`],
              requiredClaims: ["exp"],
              currentDate,
            }),
          // JOSE and Schema failures can retain payloads. Preserve the foreign
          // cause for inspection without printing claims or sending them to clients.
          catch: (cause) => new PrivyTokenFailure({ stage: "verification", cause: Redacted.make(cause) }),
        });
        const now = yield* DateTime.now;
        // Key retrieval may finish after the token expires. Recheck against the
        // clock at completion before making an owner available to a handler.
        return yield* Schema.decodeUnknownEffect(claims.check(
          Schema.makeFilter((claim) => claim.exp > DateTime.toEpochSeconds(now)),
        ))(verified.payload).pipe(
          Effect.flatMap((claim) =>
            AuthenticatedOwner.makeEffect({
              subject: claim.iss === "privy.io" ? claim.sub : `did:privy:${claim.sub}`,
              origin: claim.iss === "privy.io" ? "web" : "cli",
            })
          ),
          Effect.mapError((cause) => new PrivyTokenFailure({ stage: "claims", cause: Redacted.make(cause) })),
        );
      });
      return PrivyTokens.of({ verify });
    }),
  );
}
