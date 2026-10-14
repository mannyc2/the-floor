import { FloorRpcs } from "@floor/api/rpc";
import { makeFloorWorker } from "@floor/app-floor/worker";
import { localState, Stack } from "alchemy";
import { providers } from "alchemy/Cloudflare";
import * as Test from "alchemy/Test/Bun";
import { expect } from "bun:test";
import { Effect, FileSystem, Option } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";
import { RpcClient, RpcSerialization } from "effect/rpc";
const worker = makeFloorWorker({
  assets: {
    directory: "apps/web/dist",
    runWorkerFirst: ["/api/*", "/mcp"],
    notFoundHandling: "single-page-application",
  },
});

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
    const protocol = yield* RpcClient.makeProtocolHttp(
      HttpClient.mapRequest(client, HttpClientRequest.prependUrl(`${url}/api/rpc`)),
    ).pipe(Effect.provideService(RpcSerialization.RpcSerialization, RpcSerialization.json));
    const response = yield* RpcClient.make(FloorRpcs).pipe(
      Effect.flatMap(rpc => rpc.health({})),
      Effect.scoped,
      Effect.provideService(RpcClient.Protocol, protocol),
    );
    expect(response).toEqual({ status: "ready", service: "floor" });
    for (const path of ["/api/health", "/api/enqueue", "/api/snapshot", "/api/storage-run", "/api/storage-snapshot"]) {
      const absent = yield* client.get(`${url}${path}`);
      expect(absent.status).toBe(404);
    }
  }),
  { timeout: 120000 },
);

test(
  "private browser build metadata is not served as public assets",
  Effect.gen(function*() {
    const output = yield* deployed;
    const url = yield* Effect.fromOption(Option.fromNullishOr(output.url));
    const client = yield* HttpClient.HttpClient;
    const fs = yield* FileSystem.FileSystem;
    const files = yield* fs.readDirectory("apps/web/dist/assets");
    const sourceMap = yield* Effect.fromOption(Option.fromNullishOr(files.find((file) => file.endsWith(".js.map"))));
    for (const path of ["/.vite/manifest.json", `/assets/${sourceMap}`]) {
      const response = yield* client.get(`${url}${path}`);
      const body = yield* response.text;
      // Alchemy's SPA fallback can return the shell for a missing asset. The source map or manifest must never be served.
      if (response.status === 200) expect(body).toContain("<!doctype html>");
      else expect(response.status).toBe(404);
      expect(body).not.toContain("\"sourcesContent\"");
    }
  }),
);
