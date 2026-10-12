import { BunServices } from "@effect/platform-bun";
import { assert, it } from "@effect/vitest";
import { ApiError } from "@floor/surfaces";
import { Effect, Exit, Layer, Option, Schema } from "effect";
import { TestClock } from "effect/testing";
import { privateKeyToAccount } from "viem/accounts";
import { Auth } from "../src/auth";
import { ServerConfig } from "../src/config";
import { databaseLayer } from "../src/sqlite-store";
import { FloorDatabase } from "../src/store";

const dependencies = Auth.layer.pipe(
  Layer.provideMerge(databaseLayer(":memory:")),
  Layer.provide(ServerConfig.layer),
  Layer.provide(BunServices.layer),
);
class RollbackProbe extends Schema.TaggedError<RollbackProbe>()("RollbackProbe", {}) {}
// This is a public test key; no deployed account or real funds use it.
const account = privateKeyToAccount("0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");

it.effect("SQLite rolls back prior statements when a later step fails", () =>
  Effect.gen(function*() {
    const db = yield* FloorDatabase;
    const failure = new RollbackProbe();
    const result = yield* Effect.exit(db.sql.withTransaction(Effect.gen(function*() {
      yield* db.owners.insert({ id: "rolled-back", walletAddress: account.address, mode: "wallet" });
      return yield* failure;
    })));
    assert.deepStrictEqual(result, Exit.fail(failure));
    assert.isTrue(Exit.isFailure(yield* Effect.exit(db.owners.findById("rolled-back"))));
    // oxlint-disable-next-line effecttsgo/strict-effect-provide -- A fresh test boundary owns this real in-memory SQLite database and its finalizer.
  }).pipe(Effect.provide(dependencies)));

it.effect("owner sessions expire at the native Clock boundary", () =>
  Effect.gen(function*() {
    const db = yield* FloorDatabase;
    const auth = yield* Auth;
    const owner = yield* db.owners.insert({ id: "session-owner", walletAddress: account.address, mode: "wallet" });
    const token = yield* auth.issue(owner);
    assert.isTrue(Option.isSome(yield* auth.resolve(Option.some(token))));
    yield* TestClock.adjust("7 days");
    assert.isTrue(Option.isNone(yield* auth.resolve(Option.some(token))));
    // oxlint-disable-next-line effecttsgo/strict-effect-provide -- Session expiry needs its own SQLite database and native TestClock boundary.
  }).pipe(Effect.provide(dependencies)));

it.effect("wallet proofs are single use, expire, and stay bound to their owner", () =>
  Effect.gen(function*() {
    const db = yield* FloorDatabase;
    const auth = yield* Auth;
    const challenge = yield* auth.challenge(Option.none());
    const signature = yield* Effect.tryPromise({
      try: () => account.signMessage({ message: challenge.message }),
      catch: () => new ApiError({ message: "Test signature failed." }),
    });
    const proof = { nonce: challenge.nonce, address: account.address, signature };
    const owner = yield* auth.verify(proof, Option.none());
    assert.strictEqual(owner.walletAddress, account.address.toLowerCase());
    assert.deepStrictEqual(
      Exit.findErrorOption(yield* Effect.exit(auth.verify(proof, Option.none()))),
      Option.some(new ApiError({ message: "The wallet challenge expired." })),
    );

    const expired = yield* auth.challenge(Option.some(owner));
    yield* TestClock.adjust("5 minutes");
    assert.deepStrictEqual(
      Exit.findErrorOption(yield* Effect.exit(auth.verify({ ...proof, nonce: expired.nonce }, Option.some(owner)))),
      Option.some(new ApiError({ message: "The wallet challenge expired." })),
    );

    const bound = yield* auth.challenge(Option.some(owner));
    const other = yield* db.owners.insert({
      id: "other-owner",
      walletAddress: "0x0000000000000000000000000000000000000001",
      mode: "wallet",
    });
    assert.deepStrictEqual(
      Exit.findErrorOption(yield* Effect.exit(auth.verify({ ...proof, nonce: bound.nonce }, Option.some(other)))),
      Option.some(new ApiError({ message: "Challenge belongs to a different workspace." })),
    );
    assert.deepStrictEqual(
      Exit.findErrorOption(yield* Effect.exit(auth.verify({ ...proof, nonce: bound.nonce }, Option.some(owner)))),
      Option.some(new ApiError({ message: "The wallet challenge expired." })),
    );
    // oxlint-disable-next-line effecttsgo/strict-effect-provide -- Proof state and nonces are isolated in a fresh database for this test.
  }).pipe(Effect.provide(dependencies)));
