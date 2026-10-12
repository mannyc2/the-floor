import { assert, it } from "@effect/vitest";
import { Array, Effect, Layer, Option, Schema, Stream } from "effect";
import { HttpRouter, HttpServerRequest } from "effect/http";
import { recordedFloor } from "../../../testing/flows/_fixtures/recorded-floor";
import { researcher } from "../../agents/test/_fixtures/research-input";
import { Atlas } from "../src/atlas";
import { ServerConfig } from "../src/config";
import { PublicToolHandlers, PublicTools, TideTableRoute } from "../src/public-surfaces";
import { FloorDatabase } from "../src/store";
import { seedPublicResearch } from "./_fixtures/public-research";

const application = PublicToolHandlers.pipe(
  Layer.provideMerge(recordedFloor),
  Layer.provideMerge(ServerConfig.layer),
);
it.layer(application)("public research surfaces", test => {
  test.effect("uses one publication boundary across native MCP tools and the tide-table route", () =>
    Effect.gen(function*() {
      const db = yield* FloorDatabase;
      const config = yield* ServerConfig;
      const tools = yield* PublicTools;
      const atlas = yield* Atlas;
      const market = yield* Effect.fromOption(Array.head((yield* atlas.snapshot(Option.none())).market.markets));
      yield* db.owners.insert({ id: researcher.owner, walletAddress: researcher.walletAddress, mode: "wallet" });
      yield* db.agents.insert(researcher);
      const research = yield* seedPublicResearch(researcher, "sepolia:publication-fixture");
      const notesCalls = yield* (yield* tools.handle("get_notes", {})).pipe(Stream.runCollect);
      const notes = yield* Schema.decodeUnknownEffect(PublicTools.tools.get_notes.successSchema)(
        (yield* Effect.fromOption(Array.last(notesCalls))).encodedResult,
      );
      assert.deepStrictEqual(notes.notes.map(note => note.id), [research.published.id]);
      assert.strictEqual(notes.url, `${config.origin}/`);
      assert.strictEqual(notes.notes[0]?.url, `${config.origin}/agents/${researcher.id}`);
      const thesisCalls = yield* (yield* tools.handle("get_theses", {})).pipe(Stream.runCollect);
      const theses = yield* Schema.decodeUnknownEffect(PublicTools.tools.get_theses.successSchema)(
        (yield* Effect.fromOption(Array.last(thesisCalls))).encodedResult,
      );
      assert.deepStrictEqual(theses.theses.map(thesis => thesis.id), [research.supported.id]);
      const names = [
        "list_markets",
        "get_market",
        "get_notes",
        "get_receipts",
        "get_theses",
        "get_tide_records",
        "get_plates",
      ] as const;
      for (const name of names) {
        const outputs = yield* (yield* tools.handle(name, { marketId: market.id })).pipe(Stream.runCollect);
        const output = yield* Effect.fromOption(Array.last(outputs));
        assert.isFalse(output.isFailure);
        const link = yield* Schema.decodeUnknownEffect(Schema.Struct({ url: Schema.String }))(output.encodedResult);
        assert.isTrue(link.url.startsWith(`${config.origin}/`));
      }
      const missing = yield* (yield* tools.handle("get_market", { marketId: "does-not-exist" })).pipe(
        Stream.runCollect,
      );
      const missingResult = yield* Effect.fromOption(Array.last(missing));
      assert.isTrue(missingResult.isFailure);
      const missingLink = yield* Schema.decodeUnknownEffect(Schema.Struct({ url: Schema.String }))(
        missingResult.encodedResult,
      );
      assert.strictEqual(missingLink.url, `${config.origin}/`);
      const route = yield* HttpRouter.toHttpEffect(TideTableRoute);
      const response = yield* route.pipe(Effect.provideService(
        HttpServerRequest.HttpServerRequest,
        HttpServerRequest.fromWeb(new Request(`${config.origin}/api/tide-table`)),
      ));
      assert.strictEqual(response.status, 200);
      const body = response.body;
      assert.strictEqual(body._tag, "Uint8Array");
      if (body._tag !== "Uint8Array") return;
      const html = new TextDecoder().decode(body.body);
      assert.include(html, "Base Sepolia 84532");
      assert.include(html, "source block 7");
      assert.include(html, "https://sepolia.basescan.org/block/7");
      assert.include(html, researcher.walletAddress ?? "missing-account");
      assert.notInclude(html, "PRIVATE PENDING RESEARCH");
      assert.notInclude(html, "UNVERIFIED PUBLIC FLAG");
      yield* db.agents.update({ ...researcher, visibility: "private" });
      const withdrawn = yield* (yield* tools.handle("get_theses", {})).pipe(Stream.runCollect);
      const after = yield* Schema.decodeUnknownEffect(PublicTools.tools.get_theses.successSchema)(
        (yield* Effect.fromOption(Array.last(withdrawn))).encodedResult,
      );
      assert.isEmpty(after.theses);
      assert.strictEqual(after.url, `${config.origin}/`);
      assert.isEmpty(yield* db.notes.listPublic());
      assert.lengthOf(yield* db.notes.list(), 3);
    }));
});
