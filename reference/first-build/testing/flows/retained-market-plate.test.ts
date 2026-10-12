import { BunHttpServer, BunServices } from "@effect/platform-bun";
import { expect, it } from "@effect/vitest";
import { Agent, defaultPolicy, publicAgent, Receipt } from "@floor/contract";
import { DesignRenderer, DesignRenderError, GateDecisions, GateReview, LaunchGate } from "@floor/gate";
import { MarketHistory } from "@floor/markets";
import { PlateRenderInput, PlateRenderJson } from "@floor/renderer/plate";
import { scopedAccountsLayer, Signing, TransactionExecutor } from "@floor/signing";
import { Action, ApiError } from "@floor/surfaces";
import { Array, ConfigProvider, Context, Effect, Exit, FileSystem, Layer, Option, Schema } from "effect";
import { Chromium } from "effect-browser";
import { Base64 } from "effect/encoding";
import { FetchHttpClient, HttpRouter, HttpServer, HttpStaticServer } from "effect/http";
import { RateLimiter } from "effect/persistence";
import { ChildProcess } from "effect/process";
import { AccountContext } from "../../packages/server/src/account-context";
import { ServerAgentRunner } from "../../packages/server/src/agent-runner";
import { Workspaces } from "../../packages/server/src/application";
import { Atlas } from "../../packages/server/src/atlas";
import { ServerConfig } from "../../packages/server/src/config";
import { LaunchReviewEvidence, LaunchReviews } from "../../packages/server/src/launch-reviews";
import { PlateRendererLive } from "../../packages/server/src/plate-renderer";
import { Proposals } from "../../packages/server/src/proposals";
import { SigningJournalLive } from "../../packages/server/src/signing-journal";
import { FloorDatabase } from "../../packages/server/src/store";
import { CapturedDay, recordedFloor } from "./_fixtures/recorded-floor";

class PlateAssets extends Context.Service<PlateAssets, string>()("flow/PlateAssets") {}
const assets = Layer.effect(
  PlateAssets,
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem;
    const root = yield* fs.makeTempDirectoryScoped({ prefix: "floor-plate-assets-" });
    const build = yield* ChildProcess.make("bun", ["run", "node_modules/vite/bin/vite.js", "build", "--outDir", root], {
      stdout: "ignore",
      stderr: "inherit",
      forceKillAfter: "5 seconds",
    });
    if ((yield* build.exitCode) !== 0) {
      return yield* new ApiError({ message: "The trusted plate renderer did not build." });
    }
    return root;
  }),
);
const host = HttpRouter.serve(Layer.unwrap(Effect.map(PlateAssets, root => HttpStaticServer.layer({ root })))).pipe(
  Layer.provideMerge(BunHttpServer.layer({ hostname: "127.0.0.1", port: 0 })),
);
const configuration = Layer.effect(
  ServerConfig,
  HttpServer.addressFormattedWith(origin =>
    Effect.succeed(ServerConfig.of({
      hostname: "127.0.0.1",
      port: Number(new URL(origin).port),
      origin,
      local: true,
      foundry: Option.none(),
    }))
  ),
);
const gate = GateReview.layer.pipe(
  Layer.provide(GateDecisions.unavailable),
  Layer.provide(Layer.succeed(
    DesignRenderer,
    DesignRenderer.of({
      render: () => Effect.fail(new DesignRenderError({ message: "Design rendering is outside this plate flow." })),
    }),
  )),
);
const research = Layer.succeed(
  ServerAgentRunner,
  ServerAgentRunner.of({
    run: () => Effect.succeed("Research is outside this capture flow."),
    pause: () => Effect.void,
    status: Effect.succeed([]),
  }),
);
// Only market transport is replayed and unrelated research/inference are unavailable. Capture, SQL, history and Chromium are real.
const application = Workspaces.layer.pipe(
  Layer.provide(PlateRendererLive),
  Layer.provideMerge(Proposals.layer.pipe(Layer.provideMerge(Signing.layer.pipe(
    Layer.provide(SigningJournalLive),
    Layer.provide(TransactionExecutor.unavailable),
  )))),
  Layer.provide(research),
  Layer.provideMerge(AccountContext.layer),
  Layer.provide(LaunchReviews.layer),
  Layer.provide(LaunchGate.layer),
  Layer.provide(gate),
  Layer.provide(LaunchReviewEvidence.layer),
  Layer.provide(scopedAccountsLayer.pipe(Layer.provide(FetchHttpClient.layer))),
  Layer.provideMerge(recordedFloor),
  Layer.provide(RateLimiter.layer.pipe(Layer.provide(RateLimiter.layerStoreMemory))),
  Layer.provideMerge(configuration),
  Layer.provide(host),
  Layer.provide(assets),
  Layer.provideMerge(BunServices.layer),
  Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({}))),
);
// oxlint-disable-next-line effect/noNullish -- Test agents and persisted receipt expiry use nullable contract fields.
const absent = null;

it.layer(application)("retained market plate", test => {
  test.effect("ignores forged client pixels and renders retained source metadata with public evidence", () =>
    Effect.gen(function*() {
      const db = yield* FloorDatabase;
      const workspace = yield* Workspaces;
      const atlas = yield* Atlas;
      const day = yield* CapturedDay;
      const last = yield* Effect.fromOption(Array.last(day.snapshots));
      const first = yield* Effect.fromOption(Array.head(day.snapshots));
      const middle = yield* Effect.fromOption(Array.get(day.snapshots, 12));
      const market = yield* Effect.fromOption(Array.head(last.markets));
      const owner = yield* db.owners.insert({ id: "plate-owner", mode: "local", walletAddress: absent });
      const publicDesk = Agent.make({
        id: "plate-public-desk",
        owner: owner.id,
        name: "Public source desk",
        emblem: { shape: "triangle", modifier: "dot" },
        walletAddress: absent,
        mandate: "Public source research",
        policy: defaultPolicy,
        visibility: "public",
        publishMandate: false,
        paused: false,
        state: "asleep",
        budget: { dailyUsd: 100, spentUsd: 0, day: "2026-10-11" },
        districtId: "base",
        createdAt: first.blockTimestamp,
      });
      const privateDesk = Agent.make({
        ...publicDesk,
        id: "plate-private-desk",
        name: "SECRET PRIVATE DESK",
        visibility: "private",
        emblem: { shape: "circle", modifier: "ring" },
      });
      yield* db.agents.insert(publicDesk);
      yield* db.agents.insert(privateDesk);
      const confirmed = Receipt.make({
        id: "plate-confirmed-receipt",
        proposalId: "plate-proposal",
        proposalFingerprint: "public-projection-probe",
        agentId: publicDesk.id,
        owner: owner.id,
        marketId: market.id,
        chainId: 84532,
        action: "trade",
        amount: "1",
        symbol: market.symbol,
        valueUsd: 1,
        thesisId: "plate-thesis",
        sourceIds: ["plate-source"],
        policyVersion: 1,
        checks: [],
        reason: "Confirmed source fixture",
        createdAt: first.blockTimestamp,
        updatedAt: middle.blockTimestamp,
        expiresAt: absent,
        status: "confirmed",
        transactionHash: `0x${"2".repeat(64)}`,
        blockNumber: 9_999_999_999,
      });
      yield* db.receipts.insert({ data: confirmed });
      yield* db.receipts.insert({
        data: { ...confirmed, id: "plate-private-receipt", proposalId: "private-proposal", agentId: privateDesk.id },
      });
      yield* db.receipts.insert({
        data: {
          ...confirmed,
          id: "plate-future-receipt",
          proposalId: "future-proposal",
          updatedAt: "2100-01-01T00:00:00.000Z",
        },
      });
      const forgedImage = "data:image/png;base64,Zm9yZ2VkLXBpeGVscw==";
      const title = "Retained source <img src=x onerror=alert(1)>";
      const action = yield* Schema.decodeUnknownEffect(Action)({
        tag: "plate",
        title,
        marketId: market.id,
        blockNumber: last.blockNumber,
        view: "works",
        image: forgedImage,
      });
      expect(Object.hasOwn(action, "image")).toBe(false);
      const result = yield* workspace.act(owner, action);
      const number = Number(result.id);
      const plate = yield* db.plates.findById(number);
      expect(plate.title).toBe(title);
      expect(plate.blockNumber).toBe(last.blockNumber);
      expect(plate.receiptIds).toEqual([confirmed.id]);
      expect(plate.image).not.toBe(forgedImage);
      const bytes = yield* Effect.fromResult(Base64.decode(plate.image.slice("data:image/png;base64,".length)));
      expect(bytes.subarray(0, 8)).toEqual(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));
      expect(bytes.length).toBeGreaterThan(50_000);
      const dimensions = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      expect([dimensions.getUint32(16), dimensions.getUint32(20)]).toEqual([1440, 1000]);
      const fs = yield* FileSystem.FileSystem;
      yield* fs.makeDirectory("test-results/plate-flow", { recursive: true });
      yield* fs.writeFile("test-results/plate-flow/trusted-recorded-plate.png", bytes);

      // Inspect the exact inert page contract independently: text remains text, and source/block metadata is visible in the image.
      const input = PlateRenderInput.make({
        snapshot: yield* atlas.snapshot(Option.some(last.blockNumber)),
        evidence: {
          agents: [publicAgent(publicDesk)],
          receipts: [],
          notes: [],
          chainId: last.chainId,
          blockNumber: last.blockNumber,
          observedAt: last.blockTimestamp,
        },
        title,
        marketId: market.id,
        view: "works",
      });
      const encoded = yield* Schema.encodeEffect(PlateRenderJson)(input);
      expect(yield* Schema.decodeEffect(PlateRenderJson)(encoded)).toEqual(input);
      const server = yield* ServerConfig;
      const browser = yield* Chromium.open({ sandbox: true, viewport: { width: 1440, height: 1000 }, maxPages: 1 });
      const page = yield* browser.firstPage;
      yield* page.goto(`${server.origin}/plate-render.html#${encodeURIComponent(encoded)}`);
      yield* page.waitFor({ selector: "html[data-plate-rendered=\"true\"]" }, "15 seconds");
      const visible = (yield* page.text()).text;
      expect(visible).toContain(title);
      expect(visible).toContain(last.blockNumber.toLocaleString("en-US"));
      expect(visible).toContain(last.blockHash);
      expect(visible).toContain(last.blockTimestamp);
      expect(visible).toContain("Provenance: retained Base recording");
      expect(visible).not.toContain(privateDesk.name);
      const rejected = yield* Effect.exit(workspace.act(owner, {
        tag: "plate",
        title: "Unknown source must not be captured",
        marketId: market.id,
        blockNumber: last.blockNumber + 1,
        view: "works",
      }));
      expect(Exit.isFailure(rejected)).toBe(true);
      expect(yield* db.plates.list()).toHaveLength(1);
      expect((yield* (yield* MarketHistory).snapshots).some(snapshot => snapshot.blockNumber === last.blockNumber))
        .toBe(true);
    }));
});
