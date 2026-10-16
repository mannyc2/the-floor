import { Context, Effect, Layer, Schema } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import { ConstructionError } from "../error";

const RpcFailure = Schema.Struct({
  error: Schema.Struct({ code: Schema.Int, message: Schema.String, data: Schema.optional(Schema.Unknown) }),
});

export class SolanaRpc extends Context.Service<SolanaRpc, {
  readonly request: (method: string, params: ReadonlyArray<unknown>) => Effect.Effect<unknown, ConstructionError>;
}>()("@floor/chains/SolanaRpc") {
  static layer(endpoint: string) {
    return Layer.effect(
      SolanaRpc,
      Effect.gen(function*() {
        const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);
        return SolanaRpc.of({
          request: Effect.fn("SolanaRpc.request")(function*(method, params) {
            const request = yield* HttpClientRequest.post(endpoint).pipe(
              HttpClientRequest.bodyJson({ jsonrpc: "2.0", id: 1, method, params }),
              Effect.mapError(cause => new ConstructionError({ operation: method, cause })),
            );
            const reply = yield* client.execute(request).pipe(
              Effect.flatMap(HttpClientResponse.schemaBodyJson(Schema.Unknown)),
              Effect.mapError(cause => new ConstructionError({ operation: method, cause })),
            );
            if (Schema.is(RpcFailure)(reply)) {
              return yield* new ConstructionError({ operation: method, cause: reply.error });
            }
            const result = yield* Schema.decodeUnknownEffect(Schema.Struct({ result: Schema.Unknown }))(reply).pipe(
              Effect.mapError(cause => new ConstructionError({ operation: method, cause })),
            );
            return result.result;
          }),
        });
      }),
    ).pipe(
      Layer.provide(
        FetchHttpClient.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.RequestInit, { redirect: "manual" }))),
      ),
    );
  }
}

export const rpcResult = <S extends Schema.Constraint>(
  rpc: SolanaRpc["Service"],
  schema: S,
  method: string,
  params: ReadonlyArray<unknown>,
) =>
  rpc.request(method, params).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(schema)),
    Effect.mapError(cause => new ConstructionError({ operation: method, cause })),
  );
