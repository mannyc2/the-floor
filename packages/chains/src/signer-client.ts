import { SignerHttpApi } from "@floor/api/signer";
import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/http";
import { HttpApiClient } from "effect/http-api";
import { Signer, SignerError } from "./signer";

export const signerClientLayer = (endpoint: string) =>
  Layer.effect(
    Signer,
    Effect.gen(function*() {
      const client = yield* HttpApiClient.make(SignerHttpApi, { baseUrl: endpoint });
      return Signer.of({
        submit: intent =>
          client.signer.submit({ payload: intent }).pipe(
            Effect.mapError(cause => new SignerError({ operation: "submit", cause })),
          ),
        settle: intentId =>
          client.signer.settle({ payload: { intentId } }).pipe(
            Effect.mapError(cause => new SignerError({ operation: "settle", cause })),
          ),
      });
    }),
  ).pipe(Layer.provide(FetchHttpClient.layer));
