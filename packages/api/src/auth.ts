import type { AuthenticatedOwner } from "@floor/contract/auth";
import { AuthenticationError } from "@floor/contract/auth";
import { Context, Effect, Layer, Option, Redacted, Schema } from "effect";
import { Headers } from "effect/http";
import { RpcMiddleware } from "effect/rpc";

export class CurrentOwner extends Context.Service<CurrentOwner, AuthenticatedOwner>()("floor/api/CurrentOwner") {}

const Bearer = Schema.String.check(Schema.isPattern(/^Bearer +[^\s,]+$/i));

/** @stability unstable */
export class AuthenticateOwner extends RpcMiddleware.Service<AuthenticateOwner, { provides: CurrentOwner }>()(
  "floor/api/AuthenticateOwner",
  { error: AuthenticationError },
) {
  static layer<E>(verify: (token: Redacted.Redacted) => Effect.Effect<AuthenticatedOwner, E>) {
    return Layer.succeed(
      AuthenticateOwner,
      AuthenticateOwner.of(Effect.fnUntraced(function*(effect, { headers }) {
        const authorization = Headers.get(headers, "authorization");
        if (Option.isNone(authorization)) return yield* new AuthenticationError({ reason: "missing_token" });
        const bearer = yield* Schema.decodeEffect(Bearer)(authorization.value).pipe(
          Effect.mapError(() => new AuthenticationError({ reason: "invalid_token" })),
        );
        const owner = yield* verify(Redacted.make(bearer.slice(bearer.indexOf(" ") + 1).trimStart())).pipe(
          Effect.mapError(() => new AuthenticationError({ reason: "invalid_token" })),
        );
        return yield* Effect.provideService(effect, CurrentOwner, owner);
      })),
    );
  }
}
