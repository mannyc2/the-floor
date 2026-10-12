import type { Providers } from "alchemy/Cloudflare";
import { Request } from "alchemy/Cloudflare/Workers/Request";
import { Worker } from "alchemy/Cloudflare/Workers/Worker";
import { Effect, Ref, Schema } from "effect";
import { HttpServerResponse } from "effect/http";
import { construct } from "./construction";
import { probeCrypto } from "./crypto";
import { probeEvm } from "./evm";
import { probeMath } from "./math-probe";
import { FixtureMessage, fixtureReply, probePrivyHttp } from "./src/privy/testing/http-probe";
import { probePrivy } from "./src/privy/testing/probe";
const RpcRequest = Schema.fromJsonString(Schema.Struct({
  jsonrpc: Schema.Literal("2.0"),
  id: Schema.Literal(1),
  method: Schema.Literal("getAccountInfo"),
  params: Schema.Tuple([
    Schema.Literal("So11111111111111111111111111111111111111112"),
    Schema.Struct({ encoding: Schema.Literal("base64"), commitment: Schema.Literal("confirmed") }),
  ]),
}));
const worker: Effect.Effect<Worker<{}>, never, Providers> = Worker(
  "FloorKitProbe",
  {
    // oxlint-disable-next-line effect/noModulePathFacts -- Alchemy bundles this exact module; its plan-time entrypoint must resolve before Worker services exist.
    main: import.meta.filename,
    compatibility: { date: "2026-08-18", flags: [] },
    dev: { host: "127.0.0.1", port: 19735 },
  },
  Effect.gen(function*() {
    // Each Worker instance owns its test instrumentation; no state is shared at module scope.
    const acceptedFixtureRequests = yield* Ref.make(0);
    const acceptedPrivyFixtureRequests = yield* Ref.make(0);
    return {
      fetch: Effect.gen(function*() {
        const request = yield* Request;
        const url = new URL(request.url);
        if (url.pathname === "/rpc") {
          const parsed = yield* Effect.tryPromise(() => request.text()).pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(RpcRequest)),
          );
          yield* Ref.update(acceptedFixtureRequests, (count) => count + 1);
          return HttpServerResponse.jsonUnsafe({
            jsonrpc: parsed.jsonrpc,
            id: parsed.id,
            result: { context: { slot: 0 }, value: { owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" } },
          });
        }
        if (url.pathname === "/rpc-count") {
          return HttpServerResponse.jsonUnsafe({ acceptedFixtureRequests: yield* Ref.get(acceptedFixtureRequests) });
        }
        if (url.pathname === "/crypto") return HttpServerResponse.jsonUnsafe(yield* probeCrypto);
        if (url.pathname === "/privy-fixture") {
          yield* Effect.tryPromise(() => request.text()).pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(FixtureMessage))),
          );
          yield* Ref.update(acceptedPrivyFixtureRequests, count => count + 1);
          return HttpServerResponse.jsonUnsafe(fixtureReply);
        }
        if (url.pathname === "/privy") {
          const before = yield* Ref.get(acceptedPrivyFixtureRequests);
          const http = yield* probePrivyHttp(url.origin);
          const after = yield* Ref.get(acceptedPrivyFixtureRequests);
          return HttpServerResponse.jsonUnsafe({ ...yield* probePrivy, http, fixtureRequests: after - before });
        }
        if (url.pathname === "/math") return HttpServerResponse.jsonUnsafe(yield* probeMath());
        if (url.pathname === "/evm") return HttpServerResponse.jsonUnsafe(yield* probeEvm);
        if (url.pathname === "/launch") {
          return HttpServerResponse.jsonUnsafe({
            first: yield* construct(`${url.origin}/rpc`),
            second: yield* construct(`${url.origin}/rpc`),
            bunPresent: "Bun" in globalThis,
            processPresent: "process" in globalThis,
          });
        }
        return HttpServerResponse.text("ready");
      }).pipe(Effect.orDie),
    };
  }),
);

export default worker;
