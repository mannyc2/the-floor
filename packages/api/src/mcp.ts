import { Data, Deferred, Effect, Exit, Layer, Queue, Schema } from "effect";
import { McpServer, Tool, Toolkit } from "effect/ai";
import { Rpc, RpcGroup, RpcMessage, RpcSchema, RpcSerialization, RpcServer } from "effect/rpc";

/**
 * Registers every unary RPC from an explicitly read-only group. Middleware is
 * excluded until authentication is designed; codecs must be service-free and
 * payloads must encode to the object root required by MCP.
 * @stability unstable
 */
export const rpcTools = <
  R extends Rpc.Any & {
    readonly payloadSchema: Schema.Codec<unknown, unknown>;
    readonly successSchema: Schema.Codec<unknown, unknown>;
    readonly errorSchema: Schema.Codec<unknown, unknown>;
    readonly middlewares: ReadonlySet<never>;
  },
>(group: RpcGroup.RpcGroup<R>) =>
  Layer.effectDiscard(Effect.gen(function*() {
    const services = yield* Effect.context<Rpc.ToHandler<R> | Rpc.Middleware<R> | Rpc.ServicesServer<R>>();
    yield* Effect.forEach(
      group.requests.values(),
      Effect.fnUntraced(function*(rpc) {
        if (RpcSchema.isStreamSchema(rpc.successSchema)) return;
        const payloadSchema: Schema.Codec<R["payloadSchema"]["Type"], unknown> = rpc.payloadSchema;
        const successSchema: Schema.Codec<R["successSchema"]["Type"], unknown> = rpc.successSchema;
        const errorSchema: Schema.Codec<R["errorSchema"]["Type"], unknown> = rpc.errorSchema;
        const name: string = rpc._tag;
        const tool = Tool.make(name, {
          parameters: payloadSchema,
          success: successSchema,
          failure: errorSchema,
          failureMode: "return",
        }).annotate(Tool.Readonly, true).annotate(Tool.Destructive, false);
        const toolkit = Toolkit.make(tool);
        const invoke = Effect.fnUntraced(function*(payload: R["payloadSchema"]["Type"]) {
          const encoded = yield* Schema.encodeEffect(payloadSchema)(payload).pipe(Effect.orDie);
          const response = yield* Deferred.make<RpcMessage.ExitEncoded<unknown, unknown>>();
          const disconnects = yield* Queue.make<number>();
          // A fresh RPC server gives each MCP invocation the same handler scope,
          // Deferred semantics and failure handling as a remote RPC request. Calling
          // accessHandler directly would retain the handler layer's lifetime.
          const protocol = RpcServer.Protocol.of({
            run: (receive) =>
              receive(
                0,
                Data.taggedEnum<RpcMessage.RequestEncoded>().Request({
                  id: 0,
                  tag: name,
                  payload: encoded,
                  headers: [],
                }),
              ).pipe(Effect.andThen(Effect.never)),
            disconnects,
            send: (_clientId, message) =>
              message._tag === "Exit"
                ? Deferred.succeed(response, message.exit).pipe(Effect.asVoid)
                : message._tag === "Defect"
                ? Deferred.die(response, message.defect).pipe(Effect.asVoid)
                : Effect.void,
            end: () => Effect.void,
            clientIds: Effect.succeed(new Set([0])),
            initialMessage: Effect.succeedNone,
            supportsAck: false,
            supportsTransferables: false,
            supportsSpanPropagation: false,
            supportsNotifications: false,
            codecFor: RpcSerialization.json.codecFor,
          });
          yield* RpcServer.make(group, { disableFatalDefects: true }).pipe(
            Effect.provideContext(services),
            Effect.provideService(RpcServer.Protocol, protocol),
            Effect.forkChild,
          );
          const encodedExit = yield* Deferred.await(response);
          const exit = yield* Schema.decodeEffect(
            RpcSerialization.json.codecFor(Schema.Exit(successSchema, errorSchema, Schema.Defect())),
          )(encodedExit).pipe(Effect.orDie);
          return yield* Exit.isSuccess(exit) ? Effect.succeed(exit.value) : Effect.failCause(exit.cause);
        });
        const handlers = yield* toolkit.toHandlers({ [name]: invoke });
        yield* McpServer.registerToolkit(toolkit).pipe(Effect.provideContext(handlers));
      }),
      { discard: true },
    );
  }));
