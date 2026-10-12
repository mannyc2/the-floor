import { makeTestWorker } from "@floor/app-floor/testing";
import { localState, Stack } from "alchemy";
import { providers } from "alchemy/Cloudflare";
import * as Test from "alchemy/Test/Bun";
import { expect } from "bun:test";
import { Effect, Redacted, Schema } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";

const stack = Stack(
  "floor-probe-gate-local",
  { providers: providers(), state: localState() },
  makeTestWorker({
    env: { FLOOR_PROBE_TOKEN: Redacted.make("public-local-test-token") },
  }),
);
const { test, deploy, destroy, beforeAll, afterAll } = Test.make({
  providers: providers(),
  dev: true,
  sidecar: false,
  stage: "floor-probe-gate-local",
});
// oxlint-disable-next-line effect/noTestLifecycleHooks -- Alchemy's supported harness owns the Worker scope across authenticated requests.
const deployed = beforeAll(deploy(stack));
// oxlint-disable-next-line effect/noTestLifecycleHooks -- The harness must remove its resources before the runtime scope closes.
afterAll(destroy(stack));
test(
  "native probe honors the deployed secret before mutation",
  Effect.gen(function*() {
    const output = yield* deployed;
    const url = yield* Schema.decodeUnknownEffect(Schema.NonEmptyString)(output.url);
    const client = yield* HttpClient.HttpClient;
    const unauthenticated = yield* client.get(`${url}/ready`);
    expect(unauthenticated.status).toBe(403);
    const authenticated = yield* HttpClientRequest.get(`${url}/ready`).pipe(
      HttpClientRequest.setHeader("x-floor-probe-token", "public-local-test-token"),
      client.execute,
    );
    expect(authenticated.status).toBe(200);
    expect(yield* authenticated.text).toBe("ready");
  }),
  { timeout: 120000 },
);
