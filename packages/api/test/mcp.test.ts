import { rpcTools } from "@floor/api/mcp";
import * as Test from "alchemy/Test/Bun";
import { expect } from "bun:test";
import { Deferred, Effect, Fiber, Layer, Option, Schema, Stream } from "effect";
import { McpProtocol, McpSchema, McpServer } from "effect/ai";
import { HttpRouter } from "effect/http";
import { Rpc, RpcGroup } from "effect/rpc";

const { test } = Test.make({ providers: Layer.empty, dev: true, sidecar: false });
class Missing extends Schema.TaggedError<Missing>()("Missing", { key: Schema.String }) {}
const Read = Rpc.make("read", {
  payload: Schema.Struct({ count: Schema.FiniteFromString }),
  success: Schema.Struct({ doubled: Schema.Finite }),
});
const Lookup = Rpc.make("lookup", {
  payload: Schema.Struct({ key: Schema.String }),
  success: Schema.Struct({ label: Schema.String }),
  error: Missing,
});
const Watch = Rpc.make("watch", {
  payload: Schema.Record(Schema.String, Schema.Never),
  success: Schema.String,
  stream: true,
});
const DeferredRead = Rpc.make("deferred", {
  payload: Schema.Record(Schema.String, Schema.Never),
  success: Schema.Struct({ ready: Schema.Boolean }),
});
const Resource = Rpc.make("resource", {
  payload: Schema.Record(Schema.String, Schema.Never),
  success: Schema.Struct({ ready: Schema.Boolean }),
});
const Hold = Rpc.make("hold", {
  payload: Schema.Record(Schema.String, Schema.Never),
  success: Schema.Struct({ ready: Schema.Boolean }),
});
const Group = RpcGroup.make(Read, Lookup, Watch, DeferredRead, Resource, Hold);
const holding = Deferred.makeUnsafe<boolean>();
const releasedHold = Deferred.makeUnsafe<boolean>();
let activeResources = 0;
const received: Array<number> = [];
const Handlers = Group.toLayer({
  resource: () =>
    Effect.acquireRelease(
      Effect.sync(() => {
        activeResources += 1;
        return { ready: true };
      }),
      () =>
        Effect.sync(() => {
          activeResources -= 1;
        }),
    ),
  hold: () =>
    Effect.acquireRelease(
      Deferred.succeed(holding, true),
      () => Deferred.succeed(releasedHold, true),
    ).pipe(Effect.andThen(Effect.never)),
  read: ({ count }) => {
    received.push(count);
    return Effect.succeed({ doubled: count * 2 });
  },
  lookup: ({ key }) => key === "present" ? Effect.succeed({ label: "Found" }) : new Missing({ key }),
  watch: () => Stream.make("ignored"),
  deferred: () =>
    Deferred.make<{ readonly ready: boolean }>().pipe(
      Effect.tap((value) => Deferred.succeed(value, { ready: true })),
    ),
});
const Routes = rpcTools(Group).pipe(
  Layer.provide(Handlers),
  Layer.provide(McpServer.layerHttp({
    name: "adapter-test",
    version: "1",
    path: "/mcp",
    protocols: [McpProtocol.v2026_07_28],
  })),
);
const Envelope = Schema.Struct({
  jsonrpc: Schema.Literal("2.0"),
  id: Schema.Finite,
  result: Schema.optionalKey(Schema.Json),
  error: Schema.optionalKey(Schema.Json),
});
const Message = Schema.Struct({
  jsonrpc: Schema.Literal("2.0"),
  id: Schema.Finite,
  method: Schema.String,
  params: Schema.Struct({ name: Schema.optionalKey(Schema.String), arguments: Schema.optionalKey(Schema.JsonObject) }),
});
const withMcp = <E>(
  check: (
    send: (message: typeof Message.Type) => Effect.Effect<typeof Envelope.Type, Schema.SchemaError>,
  ) => Effect.Effect<void, E>,
) =>
  Effect.acquireUseRelease(
    Effect.sync(() => HttpRouter.toWebHandler(Routes, { disableLogger: true })),
    ({ handler }) =>
      check(Effect.fnUntraced(function*(message: typeof Message.Type) {
        const body = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Json))({
          ...message,
          params: {
            ...message.params,
            _meta: {
              "io.modelcontextprotocol/protocolVersion": "2026-07-28",
              "io.modelcontextprotocol/clientCapabilities": {},
            },
          },
        });
        const headers = new Headers({
          "content-type": "application/json",
          "mcp-protocol-version": "2026-07-28",
          "Mcp-Method": message.method,
          accept: "application/json, text/event-stream",
        });
        Option.match(Option.fromNullishOr(message.params.name), {
          onNone: () => {},
          onSome: (name) => headers.set("Mcp-Name", name),
        });
        const response = yield* Effect.promise((signal) =>
          handler(
            new Request("http://adapter.test/mcp", {
              method: "POST",
              signal,
              headers,
              body,
            }),
          )
        );
        expect(response.status).toBe(200);
        const text = yield* Effect.promise(() => response.text());
        return yield* Schema.decodeEffect(Schema.fromJsonString(Envelope))(text);
      })),
    ({ dispose }) => Effect.promise(dispose),
  );

test(
  "heterogeneous RPCs expose their schemas and omit streams",
  withMcp(Effect.fnUntraced(function*(send) {
    const response = yield* send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
    const list = yield* Schema.decodeUnknownEffect(McpSchema.ListToolsResult)(response.result);
    expect(list.tools.map((tool) => tool.name).toSorted()).toEqual(["deferred", "hold", "lookup", "read", "resource"]);
    const read = list.tools.find((tool) => tool.name === "read");
    expect(read?.inputSchema).toMatchObject({ type: "object", properties: { count: { type: "string" } } });
    expect(read?.outputSchema).toMatchObject({ type: "object", properties: { doubled: { type: "number" } } });
    for (const tool of list.tools) {
      expect(tool.annotations?.readOnlyHint).toBe(true);
      expect(tool.annotations?.destructiveHint).toBe(false);
    }
  })),
);

test(
  "payload codecs decode before the shared RPC handler",
  withMcp(Effect.fnUntraced(function*(send) {
    const before = received.length;
    const response = yield* send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "read", arguments: { count: "21" } },
    });
    expect(response.result).toMatchObject({
      content: [{ type: "text", text: "{\"doubled\":42}" }],
      structuredContent: { doubled: 42 },
      isError: false,
    });
    expect(received.slice(before)).toEqual([21]);
    const invalid = yield* send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "read", arguments: { count: "invalid" } },
    });
    expect(invalid.result).toMatchObject({ isError: true });
    expect(received.length).toBe(before + 1);
  })),
);

test(
  "declared RPC errors keep structured fields instead of becoming successful data",
  withMcp(Effect.fnUntraced(function*(send) {
    const response = yield* send({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "lookup", arguments: { key: "missing" } },
    });
    expect(response.result).toMatchObject({
      content: [{ type: "text", text: "{\"_tag\":\"Missing\",\"key\":\"missing\"}" }],
      isError: true,
    });
    const success = yield* send({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "lookup", arguments: { key: "present" } },
    });
    expect(success.result).toMatchObject({ structuredContent: { label: "Found" }, isError: false });
  })),
);

test(
  "deferred RPC completion resolves before encoding the tool result",
  withMcp(Effect.fnUntraced(function*(send) {
    const response = yield* send({
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: { name: "deferred", arguments: {} },
    });
    expect(response.result).toMatchObject({ structuredContent: { ready: true }, isError: false });
  })),
);

test(
  "RPC request resources release before the MCP response completes",
  withMcp(Effect.fnUntraced(function*(send) {
    expect(activeResources).toBe(0);
    const response = yield* send({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: { name: "resource", arguments: {} },
    });
    expect(response.result).toMatchObject({ structuredContent: { ready: true }, isError: false });
    expect(activeResources).toBe(0);
  })),
);

test(
  "cancelled MCP requests interrupt RPC work and release its scope",
  withMcp(Effect.fnUntraced(function*(send) {
    const call = yield* send({ jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "hold", arguments: {} } })
      .pipe(Effect.forkChild);
    yield* Deferred.await(holding);
    yield* Fiber.interrupt(call);
    expect(yield* Deferred.await(releasedHold)).toBe(true);
  })),
);
