import { BunHttpServer, BunRuntime, BunServices } from "@effect/platform-bun";
import { providersLayer, researchBrowserLayer, researchersLayer } from "@floor/agents";
import { GateReview, LaunchGate } from "@floor/gate";
import { MarketHistory, marketLayer, MarketRecording } from "@floor/markets";
import { scopedAccountsLayer, scopedTransactionExecutorLayer, Signing } from "@floor/signing";
import { Config, Effect, FileSystem, Layer, Option, Schema } from "effect";
import { FetchHttpClient, HttpRouter, HttpServerRequest, HttpServerResponse, HttpStaticServer } from "effect/http";
import { RateLimiter } from "effect/persistence";
import { AccountContext } from "./account-context";
import { ServerAgentRunner } from "./agent-runner";
import { ApiRoutes, AtlasRoutes, Workspaces } from "./application";
import { Atlas } from "./atlas";
import { Auth } from "./auth";
import { Community } from "./community";
import { ServerConfig } from "./config";
import { DesignRendererLive, GateDecisionsLive } from "./design-review";
import { DistrictTiers } from "./district-tiers";
import { TokenHolders } from "./holder-evidence";
import { LaunchReviewEvidence, LaunchReviews } from "./launch-reviews";
import { NotePositions, PositionChain } from "./note-positions";
import { ObservabilityLive } from "./observability";
import { PlateRendererLive } from "./plate-renderer";
import { Proposals } from "./proposals";
import { PublicPreviewRoutes, PublicPreviews } from "./public-preview";
import { PublicSurfacesRoutes } from "./public-surfaces";
import { SigningJournalLive } from "./signing-journal";
import { localDatabaseLayer } from "./sqlite-store";

const MarketsLive = Layer.unwrap(Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Config.String("FLOOR_RECORDING").pipe(Config.withDefault("data/base-day.json"));
  if (!(yield* fs.exists(path))) return marketLayer();
  const history = yield* MarketHistory;
  const recording = yield* Schema.decodeEffect(Schema.fromJsonString(MarketRecording))(yield* fs.readFileString(path));
  yield* history.importRecording(recording);
  return marketLayer();
}));
const ResearchersLive = researchersLayer.pipe(
  Layer.provide(researchBrowserLayer),
  Layer.provide(providersLayer),
  Layer.provide(FetchHttpClient.layer),
);
const RateLimiterLive = RateLimiter.layer.pipe(Layer.provide(RateLimiter.layerStoreMemory));
const ProposalsLive = Proposals.layer.pipe(
  Layer.provideMerge(
    Signing.layer.pipe(Layer.provide(SigningJournalLive), Layer.provide(scopedTransactionExecutorLayer)),
  ),
);
const Services = Layer.merge(Workspaces.layer, PublicPreviews.layer).pipe(
  Layer.provideMerge(PlateRendererLive),
  Layer.provideMerge(Layer.mergeAll(Auth.layer, Atlas.layer, ServerAgentRunner.layer)),
  Layer.provideMerge(ProposalsLive),
  Layer.provideMerge(AccountContext.layer),
  Layer.provide(NotePositions.layer),
  Layer.provide(PositionChain.layer),
  Layer.provide(LaunchReviews.layer),
  Layer.provide(LaunchGate.layer),
  Layer.provide(GateReview.layer.pipe(Layer.provide([DesignRendererLive, GateDecisionsLive]))),
  Layer.provide(LaunchReviewEvidence.layer),
  Layer.provide(scopedAccountsLayer.pipe(Layer.provide(FetchHttpClient.layer))),
  Layer.provideMerge(MarketsLive),
  Layer.provideMerge(Community.layer.pipe(Layer.provide(TokenHolders.layer))),
  Layer.provide(DistrictTiers.layer),
  Layer.provideMerge(localDatabaseLayer),
  Layer.provideMerge(ServerConfig.layer),
  Layer.provide(ResearchersLive),
  Layer.provide(RateLimiterLive),
);
const SameOrigin = HttpRouter.middleware(
  Effect.gen(function*() {
    const config = yield* ServerConfig;
    const allowed = new Set([
      config.origin,
      ...(config.local ? ["http://127.0.0.1:5173", "http://localhost:5173"] : []),
    ]);
    return Effect.fn("Http.sameOrigin")(function*(next) {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const origin = Option.fromUndefinedOr(request.headers["origin"]);
      if (
        Option.isSome(origin) && (!["GET", "HEAD", "OPTIONS"].includes(request.method) || request.url === "/stream")
        && !allowed.has(origin.value)
      ) return HttpServerResponse.text("Cross-origin request refused", { status: 403 });
      return yield* next;
    });
  }),
  { global: true },
);
const StaticRoutes = HttpStaticServer.layer({ root: "dist/client", spa: true });
const Routes = Layer.mergeAll(
  ApiRoutes,
  AtlasRoutes,
  PublicSurfacesRoutes,
  PublicPreviewRoutes,
  StaticRoutes,
  SameOrigin,
);
const Host = Layer.unwrap(Effect.gen(function*() {
  const config = yield* ServerConfig;
  return BunHttpServer.layer({
    hostname: config.hostname,
    port: config.port,
    maxRequestBodySize: 8_000_000,
    gracefulShutdownTimeout: "10 seconds",
  });
})).pipe(Layer.provide(ServerConfig.layer));

// The outer scope owns requests, stream clients, polling, research fibers, SQL and exporter flush on shutdown.
HttpRouter.serve(Routes).pipe(
  Layer.provide(Services),
  Layer.provide(Host),
  Layer.provide(BunServices.layer),
  Layer.provide(ObservabilityLive),
  Layer.launch,
  BunRuntime.runMain,
);
