import { SignerRpcs } from "@floor/api/signer";
import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/http";
import { RpcClient, RpcSerialization } from "effect/rpc";
import { Signer, SignerError } from "./signer";

export const signerClientLayer = (endpoint: string) =>
  Layer.effect(
    Signer,
    Effect.gen(function*() {
      const client = yield* RpcClient.make(SignerRpcs);
      return Signer.of({
        submit: intent =>
          client.submit(intent).pipe(
            Effect.mapError(cause => new SignerError({ operation: "submit", cause })),
          ),
        settle: intentId =>
          client.settle({ intentId }).pipe(
            Effect.mapError(cause => new SignerError({ operation: "settle", cause })),
          ),
      });
    }),
  ).pipe(Layer.provide(
    RpcClient.layerProtocolHttp({ url: `${endpoint.replace(/\/$/, "")}/signer/rpc` }).pipe(
      Layer.provide([FetchHttpClient.layer, RpcSerialization.layerJson]),
    ),
  ));
