import { BunRuntime, BunServices } from "@effect/platform-bun";
import { address, getAddressDecoder } from "@solana/kit";
import { Effect, FileSystem, Layer, Option, Schema } from "effect";
import { Base64 } from "effect/encoding";
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";

const Account = Schema.Struct({
  lamports: Schema.Natural,
  owner: Schema.String,
  executable: Schema.Boolean,
  data: Schema.Tuple([Schema.String, Schema.Literal("base64")]),
});
const Reply = Schema.Struct({
  result: Schema.Struct({ context: Schema.Struct({ slot: Schema.Natural }), value: Schema.Array(Account) }),
});
const Snapshot = Schema.Record(
  Schema.String,
  Schema.Struct({
    lamports: Schema.Natural,
    owner: Schema.String,
    executable: Schema.Boolean,
    data: Schema.String,
    rentEpoch: Schema.Natural,
  }),
);
const program = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);
  const read = Effect.fn("fork.clonePrograms")(function*(keys: ReadonlyArray<string>) {
    const request = yield* HttpClientRequest.post("https://api.mainnet-beta.solana.com").pipe(
      HttpClientRequest.bodyJson({
        jsonrpc: "2.0",
        id: 1,
        method: "getMultipleAccounts",
        params: [keys, { encoding: "base64", commitment: "finalized" }],
      }),
    );
    return yield* client.execute(request).pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(Reply)));
  });
  const keys = [
    "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN",
    "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
    "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
  ];
  const programs = yield* read(keys);
  const dataKeys = yield* Effect.forEach(
    programs.result.value.filter(account => account.owner === "BPFLoaderUpgradeab1e11111111111111111111111"),
    Effect.fn("fork.programDataAddress")(function*(account) {
      const bytes = yield* Effect.fromResult(Base64.decode(account.data[0]));
      return getAddressDecoder().decode(bytes.slice(4, 36));
    }),
  );
  const data = yield* read(dataKeys);
  const allKeys = [...keys.map(address), ...dataKeys];
  const allAccounts = [...programs.result.value, ...data.result.value];
  const snapshot: Record<string, typeof Snapshot.Type[string]> = {};
  for (const [index, key] of allKeys.entries()) {
    const account = yield* Effect.fromOption(Option.fromUndefinedOr(allAccounts[index]));
    // Rent epochs are deprecated on Solana. Surfpool's snapshot requires an
    // integer but JSON cannot preserve the mainnet u64 sentinel; the sandbox
    // uses rentEpoch 0 while program code, owners, balances and bytes are cloned.
    snapshot[key] = { ...account, data: account.data[0], rentEpoch: 0 };
  }
  yield* fs.makeDirectory("work/fork", { recursive: true });
  yield* fs.writeFileString(
    "work/fork/snapshot.json",
    yield* Schema.encodeEffect(Schema.fromJsonString(Snapshot))(snapshot),
  );
  yield* fs.writeFileString(
    "work/fork/clone-slots.json",
    yield* Schema.encodeEffect(
      Schema.fromJsonString(Schema.Struct({ programSlot: Schema.Natural, dataSlot: Schema.Natural })),
    )({ programSlot: programs.result.context.slot, dataSlot: data.result.context.slot }),
  );
});
program.pipe(Effect.provide(Layer.merge(FetchHttpClient.layer, BunServices.layer)), BunRuntime.runMain);
