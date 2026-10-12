import { ApiError, CurrentOwner, type Owner, OwnerAuthorization, Unauthorized, WalletProof } from "@floor/surfaces";
import { Clock, Context, Crypto, DateTime, Effect, Layer, Option, Redacted, Schema } from "effect";
import { Hex } from "effect/encoding";
import { HttpEffect, HttpServerRequest, HttpServerResponse } from "effect/http";
import { SqlSchema } from "effect/sql";
import { verifyMessage } from "viem";
import { ServerConfig } from "./config";
import { ChallengeRow, FloorDatabase, OwnerRow } from "./store";

const cookieName = "floor_session";
const makeAuth = Effect.gen(function*() {
  const db = yield* FloorDatabase;
  const crypto = yield* Crypto.Crypto;
  const config = yield* ServerConfig;
  const hash = (token: Redacted.Redacted) =>
    crypto.digest("SHA-256", new TextEncoder().encode(Redacted.value(token))).pipe(Effect.map(Hex.encode));
  const findSessionOwner = SqlSchema.findOneOption({
    Request: Schema.Struct({ token: Schema.String, now: Schema.Int }),
    Result: OwnerRow,
    execute: ({ token, now }) =>
      db.sql`SELECT o.* FROM owners o JOIN owner_sessions s ON s.owner = o.id WHERE s.id = ${token} AND s.expiresAt > ${now}`,
  });
  const resolve = Effect.fn("Auth.resolve")(function*(token: Option.Option<Redacted.Redacted>) {
    if (Option.isNone(token)) return Option.none<Owner>();
    return yield* findSessionOwner({ token: yield* hash(token.value), now: yield* Clock.currentTimeMillis });
  });
  const resolveRequest = Effect.gen(function*() {
    const request = yield* HttpServerRequest.HttpServerRequest;
    return yield* resolve(Option.map(Option.fromUndefinedOr(request.cookies[cookieName]), Redacted.make));
  });
  const issue = Effect.fn("Auth.issue")(function*(owner: Owner) {
    const token = Redacted.make(`${yield* crypto.randomUUIDv4}${yield* crypto.randomUUIDv4}`);
    const now = yield* Clock.currentTimeMillis;
    yield* db.sessions.insert({ id: yield* hash(token), owner: owner.id, expiresAt: now + 604_800_000 });
    yield* db.sql`DELETE FROM owner_sessions WHERE expiresAt <= ${now}`;
    return token;
  });
  const cookie = Effect.fn("Auth.cookie")(function*(owner: Owner) {
    const token = yield* issue(owner);
    yield* HttpEffect.appendPreResponseHandler((_request, response) =>
      HttpServerResponse.setCookie(response, cookieName, Redacted.value(token), {
        httpOnly: true,
        secure: !config.local,
        sameSite: "strict",
        path: "/",
        maxAge: "7 days",
      }).pipe(Effect.orDie)
    );
    return owner;
  });
  const start = Effect.gen(function*() {
    const current = yield* resolveRequest;
    if (Option.isSome(current)) return current.value;
    if (!config.local) return yield* new ApiError({ message: "Connect your wallet to open an owner workspace." });
    // oxlint-disable-next-line effect/noNullish -- The Owner transport contract uses null for a local workspace without a wallet.
    const owner = yield* db.owners.insert({ id: yield* crypto.randomUUIDv4, mode: "local", walletAddress: null });
    return yield* cookie(owner);
  });
  const challenge = Effect.fn("Auth.challenge")(function*(principal: Option.Option<Owner>) {
    const nonce = yield* crypto.randomUUIDv4;
    const owner = Option.isSome(principal) ? principal.value.id : yield* crypto.randomUUIDv4;
    const now = yield* DateTime.now;
    const message = `The Floor owner verification\nOrigin: ${config.origin}\nNonce: ${nonce}\nIssued: ${
      DateTime.formatIso(now)
    }\nThis signs into your workspace. It authorizes no transaction.`;
    yield* db.challenges.insert({ id: nonce, owner, message, expiresAt: DateTime.toEpochMillis(now) + 300_000 });
    yield* db.sql`DELETE FROM challenges WHERE expiresAt <= ${DateTime.toEpochMillis(now)}`;
    return { nonce, message };
  });
  const consumeChallenge = SqlSchema.findOneOption({
    Request: Schema.String,
    Result: ChallengeRow,
    execute: id => db.sql`DELETE FROM challenges WHERE id = ${id} RETURNING *`,
  });
  const verify = Effect.fn("Auth.verify")(function*(proof: typeof WalletProof.Type, principal: Option.Option<Owner>) {
    // DELETE RETURNING consumes the nonce before verification, including failed proofs and concurrent requests.
    const consumed = yield* consumeChallenge(proof.nonce);
    const now = yield* Clock.currentTimeMillis;
    if (Option.isNone(consumed) || consumed.value.expiresAt <= now) {
      return yield* new ApiError({ message: "The wallet challenge expired." });
    }
    if (Option.isSome(principal) && principal.value.id !== consumed.value.owner) {
      return yield* new ApiError({ message: "Challenge belongs to a different workspace." });
    }
    const valid = yield* Effect.tryPromise({
      try: () => verifyMessage({ address: proof.address, signature: proof.signature, message: consumed.value.message }),
      catch: () => new ApiError({ message: "The wallet signature could not be verified." }),
    });
    if (!valid) return yield* new ApiError({ message: "The wallet signature did not match." });
    const address = proof.address.toLowerCase();
    return yield* db.sql.withTransaction(Effect.gen(function*() {
      const existing = yield* db.owners.findByWallet(address);
      if (Option.isSome(existing)) {
        if (Option.isSome(principal) && existing.value.id !== principal.value.id) {
          return yield* new ApiError({ message: "This wallet already belongs to another workspace." });
        }
        return existing.value;
      }
      const owner: Owner = { id: consumed.value.owner, walletAddress: address, mode: "wallet" };
      if (Option.isSome(principal)) return yield* db.owners.update(owner);
      return yield* db.owners.insert(owner);
    }));
  });
  return { resolve, resolveRequest, issue, cookie, start, challenge, verify };
});

/** @stability unstable */
export class Auth extends Context.Service<Auth, Effect.Success<typeof makeAuth>>()("floor/Auth") {
  static readonly layer = Layer.effect(Auth, makeAuth);
}

/** @stability unstable */
export const AuthorizationLive = Layer.effect(
  OwnerAuthorization,
  Effect.gen(function*() {
    const auth = yield* Auth;
    return OwnerAuthorization.of(
      Effect.fn("Auth.authorize")(function*(request) {
        const owner = yield* auth.resolveRequest.pipe(Effect.orDie);
        return yield* Option.match(owner, {
          onNone: () => Effect.fail(new Unauthorized({ message: "Sign in to your workspace." })),
          onSome: current => Effect.provideService(request, CurrentOwner, current),
        });
      }),
    );
  }),
);
