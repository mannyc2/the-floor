import { BunServices } from "@effect/platform-bun";
import { assert, it } from "@effect/vitest";
import { defaultPolicy } from "@floor/contract";
import { ConfigProvider, Context, DateTime, Effect, Layer, Option, Ref, Result, Schema } from "effect";
import { HttpClient, HttpClientError, HttpClientResponse } from "effect/http";
import { ScopedAccount, ScopedAccounts, scopedAccountsLayer } from "../src";

class Replies extends Context.Service<Replies, {
  readonly body: Ref.Ref<Option.Option<string>>;
  readonly calls: Ref.Ref<number>;
}>()("signing-test/Replies") {}
const edges = Layer.effectContext(Effect.gen(function*() {
  const body = yield* Ref.make(Option.none<string>());
  const calls = yield* Ref.make(0);
  const client = HttpClient.make(
    Effect.fn("SignerTest.request")(function*(request) {
      yield* Ref.update(calls, count => count + 1);
      const content = yield* Ref.get(body);
      if (Option.isNone(content)) {
        return yield* new HttpClientError.HttpClientError({
          reason: new HttpClientError.TransportError({
            request,
            description: "Response was lost after the provider might have accepted the call.",
          }),
        });
      }
      return HttpClientResponse.fromWeb(
        request,
        new Response(content.value, { headers: { "content-type": "application/json" } }),
      );
    }),
  );
  return Context.make(Replies, { body, calls }).pipe(Context.add(HttpClient.HttpClient, client));
}));
const layer = scopedAccountsLayer.pipe(
  Layer.provideMerge(edges),
  Layer.provide(
    ConfigProvider.layer(
      ConfigProvider.fromUnknown({ FLOOR_SIGNER_URL: "https://signing.example", FLOOR_SIGNER_TOKEN: "test-edge" }),
    ),
  ),
  Layer.provide(BunServices.layer),
);
const home = "0x1111111111111111111111111111111111111111";
const wallet = "0x2222222222222222222222222222222222222222";
const permissionId = `0x${"3".repeat(64)}` as const;

it.layer(layer)("scoped signing transport", test => {
  test.effect("rejects another chain, stale observations and a changed owner binding at the wire boundary", () =>
    Effect.gen(function*() {
      const accounts = yield* ScopedAccounts;
      const replies = yield* Replies;
      const binding = yield* accounts.binding("owner", home, "agent", {
        ...defaultPolicy,
        confirmedAt: "1970-01-01T00:00:00.000Z",
      });
      const now = yield* DateTime.now;
      const account = ScopedAccount.make({
        binding,
        account: wallet,
        chainId: 84532,
        permissionId,
        observedAt: now,
        expiresAt: DateTime.add(now, { hours: 1 }),
        blockNumber: 1,
        ownerVerified: true,
        moduleEnforced: true,
        permissions: [{
          contract: wallet,
          method: "withdrawToOwner",
          selector: "0x12345678",
          asset: wallet,
          recipient: home,
          maximumAmount: "1",
          maximumNativeValue: "0",
        }],
      });
      const encoded = yield* Schema.encodeEffect(ScopedAccount)(account);
      for (
        const changed of [
          { ...encoded, chainId: 8453 },
          { ...encoded, observedAt: DateTime.formatIso(DateTime.subtract(now, { minutes: 2 })) },
          { ...encoded, binding: { ...binding, ownerId: "another-owner" } },
          { ...encoded, moduleEnforced: false },
        ]
      ) {
        yield* Ref.set(
          replies.body,
          Option.some(
            yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))({ status: "verified", account: changed }),
          ),
        );
        const observed = yield* accounts.read(binding).pipe(Effect.result);
        assert.isTrue(Result.isFailure(observed));
      }
    }));
  test.effect("does not retry a dispatch whose response is lost or malformed", () =>
    Effect.gen(function*() {
      const accounts = yield* ScopedAccounts;
      const replies = yield* Replies;
      const request = { planId: "plan", receiptId: "receipt", proposalFingerprint: "approved-proposal", permissionId };
      for (const response of [Option.none<string>(), Option.some("{\"status\":\"confirmed\"}")]) {
        yield* Ref.set(replies.body, response);
        const before = yield* Ref.get(replies.calls);
        const outcome = yield* accounts.dispatch(request).pipe(Effect.result);
        assert.isTrue(Result.isFailure(outcome));
        if (Result.isFailure(outcome)) assert.strictEqual(outcome.failure._tag, "TransactionOutcomeUnknown");
        assert.strictEqual((yield* Ref.get(replies.calls)) - before, 1);
      }
    }));
});
