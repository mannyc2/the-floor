import { AtlasRpc, FloorApi } from "@floor/surfaces";
import { Context, Effect, Layer } from "effect";
import { HttpApiClient } from "effect/http-api";
import { RpcClient, type RpcClientError } from "effect/rpc";

/** Owns the scoped RPC connection and the two generated clients; contracts stay in surfaces.
 * @stability unstable
 */
export class ApiClient extends Context.Service<ApiClient, {
  readonly http: HttpApiClient.ForApi<typeof FloorApi>;
  readonly rpc: RpcClient.FromGroup<typeof AtlasRpc, RpcClientError.RpcClientError>;
}>()("@floor/frontend/ApiClient") {
  static readonly layer = Layer.effect(
    ApiClient,
    Effect.gen(function*() {
      return ApiClient.of({ http: yield* HttpApiClient.make(FloorApi), rpc: yield* RpcClient.make(AtlasRpc) });
    }),
  );
}
