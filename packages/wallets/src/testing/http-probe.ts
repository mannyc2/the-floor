import { Effect, Layer, Redacted, Schema } from "effect";
import { FetchHttpClient } from "effect/http";
import { P256 } from "../privy/authorization";
import { PrivySettings, PrivyWallets } from "../privy/client";
import { PrivyFailure } from "../privy/error";

export const FixtureMessage = Schema.Struct({
  chain_type: Schema.Literal("ethereum"),
  method: Schema.Literal("personal_sign"),
  params: Schema.Struct({ message: Schema.Literal("Floor offline probe"), encoding: Schema.Literal("utf-8") }),
});
export const fixtureReply = { method: "personal_sign", data: { signature: `0x${"ab".repeat(65)}`, encoding: "hex" } };

export const probePrivyHttp = Effect.fn("Privy.probeHttp")(function*(origin: string) {
  const url = new URL(origin);
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    return yield* new PrivyFailure({ operation: "local-http-probe", detail: "Loopback origin required" });
  }
  // oxlint-disable-next-line effect/noGlobals -- This test-only transport redirects the fixed Privy destination to this local Worker's controlled fixture.
  const localFetch = globalThis.fetch;
  const context = yield* Effect.context();
  const fetch = FetchHttpClient.Fetch.of(Object.assign(
    (input: Parameters<typeof globalThis.fetch>[0], init?: Parameters<typeof globalThis.fetch>[1]) => {
      const request = input instanceof Request ? new Request(input, init) : new Request(String(input), init);
      if (request.url !== "https://api.privy.io/v1/wallets/offline-wallet/rpc") {
        return Effect.runPromiseWith(context)(
          Effect.fail(new PrivyFailure({ operation: "local-http-probe", detail: "Unexpected API destination" })),
        );
      }
      // oxlint-disable-next-line effecttsgo/global-fetch, effect/noGlobals -- The guarded Fetch adapter is the native network boundary; its only destination is the validated loopback fixture.
      return localFetch(new Request(`${url.origin}/privy-fixture`, request)); // @effect-diagnostics globalFetch:off -- Test-only loopback transport boundary.
    },
    { preconnect: () => {} },
  ));
  const layer = PrivyWallets.layer.pipe(Layer.provideMerge(Layer.mergeAll(
    P256.layer,
    Layer.succeed(
      PrivySettings,
      PrivySettings.of({ appId: "offline-app", appSecret: Redacted.make("offline-secret") }),
    ),
    Layer.succeed(FetchHttpClient.Fetch, fetch),
  )));
  return yield* Effect.gen(function*() {
    const first = yield* (yield* P256).generate;
    const second = yield* (yield* P256).generate;
    const reply = yield* (yield* PrivyWallets).signMessage({
      walletId: "offline-wallet",
      message: "Floor offline probe",
    }, {
      keys: [first.privateKey, second.privateKey],
      coSignatures: [],
      idempotencyKey: "offline-worker-request",
    });
    if (reply.data.signature !== fixtureReply.data.signature) {
      return yield* new PrivyFailure({ operation: "local-http-probe", detail: "Unexpected fixture response" });
    }
    return { decodedFixtureResponse: true, providerAccess: "loopback-fixture-only" };
  }).pipe(
    // oxlint-disable-next-line effect/noInlineProvide, effecttsgo/strict-effect-provide -- This local probe owns the client configuration and guarded loopback transport.
    Effect.provide(layer),
  );
});
