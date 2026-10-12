import { localState, Stack } from "alchemy";
import { providers } from "alchemy/Cloudflare";
import * as Test from "alchemy/Test/Bun";
import { expect } from "bun:test";
import { Effect, Option } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import worker from "./fixtures/entry.ts";

const stack = Stack("floor-local-agent", { providers: providers(), state: localState() }, worker);
const { test, deploy, destroy, beforeAll, afterAll } = Test.make({
  providers: providers(),
  dev: true,
  sidecar: false,
  stage: "floor-local-agent-build",
});
// oxlint-disable-next-line effect/noTestLifecycleHooks -- Alchemy's supported harness owns the local runtime across requests.
const deployed = beforeAll(deploy(stack));
// oxlint-disable-next-line effect/noTestLifecycleHooks -- Alchemy must remove its local resources before its shared runtime scope closes.
afterAll(destroy(stack));

test(
  "Alchemy bundles and starts the bounded native Worker",
  Effect.gen(function*() {
    const output = yield* deployed;
    const url = yield* Effect.fromOption(Option.fromNullishOr(output.url));
    const client = yield* HttpClient.HttpClient;
    const response = yield* client.get(url).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap((received) => received.text),
    );
    expect(response).toBe("ready");
  }),
  { timeout: 120000 },
);
