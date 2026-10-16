import { Effect, Layer, Redacted, Schema } from "effect";
import { FetchHttpClient } from "effect/http";
import { P256 } from "../src/privy/authorization";
import { PrivySettings, PrivyWallets } from "../src/privy/client";

export const appId = "synthetic-test-app";
export const appSecret = "synthetic-test-secret";
export interface Captured {
  readonly request: Request;
  readonly body: string;
}

// Merge rather than provide: the client reads Fetch when a request runs, so a
// fake that only reached the Layer would leave requests on the global transport.
export const walletLayer = (fetch: typeof globalThis.fetch) =>
  PrivyWallets.layer.pipe(Layer.provideMerge(Layer.mergeAll(
    P256.layer,
    Layer.succeed(PrivySettings, PrivySettings.of({ appId, appSecret: Redacted.make(appSecret) })),
    Layer.succeed(FetchHttpClient.Fetch, fetch),
  )));

const encode = Schema.encodeEffect(Schema.fromJsonString(Schema.Json));

// The one fake Privy transport: it captures every request and answers with
// synthetic bytes, never recordings or evidence of provider acceptance. A Blob
// reply is sent as it is, for bodies that are not JSON. A call the acceptance
// check refuses gets Privy's missing-signature response instead.
export const capture = <E = never>(
  reply: Schema.Json | Blob,
  status = 200,
  accept: (call: Captured) => Effect.Effect<boolean, E> = () => Effect.succeed(true),
) => {
  const calls: Captured[] = [];
  const fetch = FetchHttpClient.Fetch.of(Object.assign(
    (input: Parameters<typeof globalThis.fetch>[0], init?: Parameters<typeof globalThis.fetch>[1]) =>
      Effect.runPromise(Effect.gen(function*() {
        const request = input instanceof Request ? new Request(input, init) : new Request(String(input), init);
        const call = { request, body: yield* Effect.promise(() => request.text()) };
        calls.push(call);
        const accepted = yield* accept(call);
        const body = !accepted
          ? yield* encode({ code: "insufficient_correct_authorization_signatures" })
          : reply instanceof Blob
          ? reply
          : yield* encode(reply);
        return new Response(body, {
          status: accepted ? status : 401,
          headers: { "content-type": "application/json" },
        });
      })),
    { preconnect: () => {} },
  ));
  return { calls, fetch, layer: walletLayer(fetch) };
};
