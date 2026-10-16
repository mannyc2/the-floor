import { SqliteClient } from "@effect/sql-sqlite-do";
import { SignerHttpApi, SignerRequestError } from "@floor/api/signer";
import { Signer, SignerError } from "@floor/chains/signer";
import { readPoolLayer } from "@floor/chains/solana/read-pool";
import { SolanaRpc } from "@floor/chains/solana/rpc";
import { MeteoraSwap } from "@floor/chains/solana/swap";
import { ChainRef, IntentId, Receipt, SwapIntent } from "@floor/contract";
import type { Providers } from "alchemy/Cloudflare";
import { WorkerConfigProvider } from "alchemy/Cloudflare/Workers/ConfigProvider";
import { DurableObject } from "alchemy/Cloudflare/Workers/DurableObject";
import { DurableObjectState } from "alchemy/Cloudflare/Workers/DurableObjectState";
import { SqlMigrations } from "alchemy/Cloudflare/Workers/SqlMigrations";
import { Worker, type WorkerEnv } from "alchemy/Cloudflare/Workers/Worker";
import { Config, ConfigProvider, Context, Effect, Layer, Option, Redacted, Schema } from "effect";
import { Base64 } from "effect/encoding";
import { HttpRouter, HttpServer } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";
import { SqlSchema } from "effect/sql";
import { ForkKey } from "./fork-key";
import { SubmissionJournal } from "./journal";
import { ForkConfiguration, forkSignerLayer } from "./signer";

const IntentJson = Schema.fromJsonString(Schema.toCodecJson(SwapIntent));
const ReceiptJson = Schema.fromJsonString(Schema.toCodecJson(Receipt));
interface SignerRpc {
  readonly submit: (intent: string) => Effect.Effect<string, SignerError>;
  readonly settle: (id: string) => Effect.Effect<string, SignerError>;
}
class Signers extends DurableObject<Signers, SignerRpc>()("FORK_SIGNERS", { errors: [SignerError] }) {}
const SignersLive = Signers.make(
  Effect.map(SqlMigrations("./apps/signer/src/_migrations"), migrations =>
    Effect.gen(function*() {
      const state = yield* DurableObjectState;
      yield* migrations.apply().pipe(Effect.orDie);
      const sql = Context.get(
        yield* Layer.build(SqliteClient.layer({ db: state.raw.storage.sql })),
        SqliteClient.SqliteClient,
      );
      const find = SqlSchema.findOneOption({
        Request: IntentId,
        Result: Schema.Struct({ receipt: ReceiptJson }),
        execute: id => sql`SELECT receipt_json AS receipt FROM submissions WHERE intent_id = ${id}`,
      });
      const journal = SubmissionJournal.of({
        read: id =>
          find(id).pipe(
            Effect.map(Option.map(row => row.receipt)),
            Effect.mapError(cause => new SignerError({ operation: "journal.read", cause })),
          ),
        write: Effect.fn("SubmissionJournal.write")(function*(receipt) {
          const encoded = yield* Schema.encodeEffect(ReceiptJson)(receipt);
          yield* sql`INSERT INTO submissions (intent_id, receipt_json) VALUES (${receipt.action.id}, ${encoded}) ON CONFLICT(intent_id) DO UPDATE SET receipt_json = excluded.receipt_json`;
        }, Effect.mapError(cause => new SignerError({ operation: "journal.write", cause }))),
      });
      const configProvider = yield* WorkerConfigProvider();
      const configuration = yield* Config.schema(ForkConfiguration, "FLOOR_FORK_CONFIGURATION").pipe(
        Effect.provideService(ConfigProvider.ConfigProvider, configProvider),
        Effect.orDie,
      );
      const keyText = yield* Config.Redacted("FLOOR_FORK_SECRET_KEY").pipe(
        Effect.provideService(ConfigProvider.ConfigProvider, configProvider),
        Effect.orDie,
      );
      const secretKey = yield* Effect.fromResult(Base64.decode(Redacted.value(keyText))).pipe(Effect.orDie);
      const chain = ChainRef.make(`solana:${configuration.genesisHash.slice(0, 32)}`);
      const dependencies = Layer.mergeAll(
        ForkKey.layer({ endpoint: configuration.endpoint, genesisHash: configuration.genesisHash, secretKey }),
        readPoolLayer(chain),
        MeteoraSwap.layer,
        Layer.succeed(SubmissionJournal, journal),
      ).pipe(Layer.provideMerge(SolanaRpc.layer(configuration.endpoint)));
      const signer = Context.get(
        yield* Layer.build(forkSignerLayer(configuration).pipe(Layer.provide(dependencies))).pipe(Effect.orDie),
        Signer,
      );
      return {
        submit: intent =>
          Schema.decodeEffect(IntentJson)(intent).pipe(
            Effect.flatMap(signer.submit),
            Effect.flatMap(Schema.encodeEffect(ReceiptJson)),
            Effect.mapError(cause => new SignerError({ operation: "worker.submit", cause })),
          ),
        settle: id =>
          Schema.decodeEffect(IntentId)(id).pipe(
            Effect.flatMap(signer.settle),
            Effect.flatMap(Schema.encodeEffect(ReceiptJson)),
            Effect.mapError(cause => new SignerError({ operation: "worker.settle", cause })),
          ),
      };
    })),
);

const Handlers = HttpApiBuilder.group(
  SignerHttpApi,
  "signer",
  Effect.fn("Signer.handlers")(function*(handlers) {
    const objects = yield* Signers;
    return handlers.handleAll({
      submit: ({ payload }) =>
        Schema.encodeEffect(IntentJson)(payload).pipe(
          Effect.flatMap(intent => objects.getByName("local-fork").submit(intent)),
          Effect.flatMap(Schema.decodeEffect(ReceiptJson)),
          Effect.mapError(cause => new SignerRequestError({ operation: "submit", cause })),
        ),
      settle: ({ payload }) =>
        objects.getByName("local-fork").settle(payload.intentId).pipe(
          Effect.flatMap(Schema.decodeEffect(ReceiptJson)),
          Effect.mapError(cause => new SignerRequestError({ operation: "settle", cause })),
        ),
    });
  }),
);
const Routes = HttpApiBuilder.layer(SignerHttpApi).pipe(Layer.provide(Handlers));

export const makeSignerWorker = Effect.fn("makeSignerWorker")(
  function*(options: { readonly env?: WorkerEnv } = {}): Effect.fn.Return<Worker<{}>, never, Providers> {
    return yield* Worker(
      "SignerWorker",
      {
        main: import.meta.url,
        compatibility: { date: "2026-08-18", flags: [] },
        dev: { host: "127.0.0.1", port: 19744 },
        ...options,
      },
      Effect.gen(function*() {
        yield* Signers;
        const fetch = yield* HttpRouter.toHttpEffect(Routes.pipe(Layer.provide(HttpServer.layerServices)));
        return { fetch };
      }).pipe(
        // oxlint-disable-next-line effecttsgo/strict-effect-provide, effect/noInlineProvide -- Alchemy owns the native Worker scope and must capture SQL before HTTP's no-op filesystem Layer.
        Effect.provide(SignersLive),
      ),
    );
  },
);

export default makeSignerWorker();
