import { BunRuntime } from "@effect/platform-bun";
import { JoinWorld, MoveInWorld } from "@floor/api/world";
import { WorldRpcs } from "@floor/api/world-rpc";
import { AgentId, ChainRef, Checkpoint, Digest, Height, WorldId } from "@floor/contract/identifiers";
import { defaultWorldLayout } from "@floor/contract/settings";
import { AgentLocation, type Floor, FloorPlace, type OpenTradingPost } from "@floor/contract/world";
import { WorldEvent } from "@floor/contract/world-events";
import { createLayoutProposal, ProposalSeed } from "@floor/world/proposal";
import { localState, Stack } from "alchemy";
import { providers } from "alchemy/Cloudflare";
import * as Test from "alchemy/Test/Core";
import {
  Array,
  Clock,
  Config,
  DateTime,
  Effect,
  FileSystem,
  Layer,
  Option,
  Path,
  Schedule,
  Schema,
  Stream,
} from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import { RpcClient, RpcSerialization } from "effect/rpc";
import { DevWorldFloors, DevWorldMetadataJson } from "./_dev-world";
import { makeWorldTestWorker } from "./_world-worker";

// A labelled synthetic world for flying the production viewer under each
// layout. The world test Worker serves the development viewer build beside its
// test-only publication routes; the production Floor Worker is not involved.
const options = { providers: providers(), state: localState(), dev: true, sidecar: false, stage: "floor-dev-world" };
const encodeJoin = Schema.encodeEffect(Schema.toCodecJson(JoinWorld));
const encodeMove = Schema.encodeEffect(Schema.toCodecJson(MoveInWorld));

type OpenPost = typeof OpenTradingPost.Type;
const openPosts = (floor: typeof Floor.Type): ReadonlyArray<OpenPost> =>
  floor._tag === "OpenFloor" ? floor.posts.filter((post): post is OpenPost => post._tag === "OpenTradingPost") : [];

// One agent per occupied floor walks a fixed circuit: a named place, another
// post, a desk at that post, then home. Every place comes round in turn, so
// each layout shows where it puts them, or says it puts them nowhere.
const circuits = (floors: ReadonlyArray<typeof Floor.Type>) =>
  floors.flatMap(floor => {
    const posts = openPosts(floor);
    return Option.toArray(Option.map(
      Option.flatMap(Array.head(posts), first => Array.head(first.stations)),
      home => ({
        agent: home.desk.agentId,
        route: FloorPlace.literals.flatMap((place, round) =>
          Option.match(Array.get(posts, (round + 1) % posts.length), {
            onNone: () => [],
            onSome: post => [
              AgentLocation.cases.AtPlace.make({ floorId: floor.id, place }),
              AgentLocation.cases.AtPost.make({ postId: post.id }),
              AgentLocation.cases.AtDesk.make({ deskId: Array.lastNonEmpty(post.stations).desk.id }),
              AgentLocation.cases.AtDesk.make({ deskId: home.desk.id }),
            ],
          })
        ),
      }),
    ));
  });

const serve = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const http = yield* HttpClient.HttpClient;
  const port = yield* Config.Port("FLOOR_WORKER_PORT");
  const floors = yield* Config.schema(DevWorldFloors, "FLOOR_DEV_WORLD_FLOORS");
  const seed = yield* Config.schema(ProposalSeed, "FLOOR_DEV_WORLD_SEED");
  const directory = yield* Config.schema(Schema.NonEmptyString, "FLOOR_DEV_WORLD_ASSETS");
  const metadataPath = yield* Config.schema(Schema.NonEmptyString, "FLOOR_DEV_WORLD_METADATA");
  const layout = defaultWorldLayout;
  // Refuse a seed the proposal cannot place before anything starts, instead
  // of letting the viewer meet the defect.
  yield* Effect.fromResult(createLayoutProposal({
    seed,
    rooms: floors + 1,
    postsPerFloor: layout.postsPerFloor,
    stationsPerPost: layout.stationsPerPost,
    lobbyPlots: layout.lobbyPlots,
  }));
  const stack = Stack(
    "FloorDevWorld",
    { providers: providers(), state: localState() },
    makeWorldTestWorker({
      devPort: port,
      assets: {
        directory,
        runWorkerFirst: ["/api/*", "/join", "/state", "/receipt", "/move"],
        notFoundHandling: "single-page-application",
      },
    }),
  );
  yield* Test.deploy(options, stack, { scope: yield* Effect.scope });
  yield* Effect.addFinalizer(() => Test.destroy(options, stack).pipe(Effect.orDie));
  const base = `http://127.0.0.1:${port}`;
  const world = WorldId.make(`synthetic-dev-world-${seed}-${yield* Clock.currentTimeMillis}`);
  const chain = ChainRef.make("solana:synthetic-dev-world");
  const checkpoint = Checkpoint.make({
    chain,
    height: Height.make("1"),
    hash: Digest.make("synthetic-dev-world-block"),
    time: DateTime.makeUnsafe("2026-10-16T12:00:00.000Z"),
  });
  const post = Effect.fnUntraced(function*(route: string, body: Schema.Json) {
    return yield* HttpClientRequest.post(`${base}${route}`).pipe(
      HttpClientRequest.bodyJson(body),
      Effect.flatMap(http.execute),
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap(HttpClientResponse.schemaBodyJson(WorldEvent)),
    );
  });
  // Full floors open the next one: every occupied floor but the last is full,
  // and the last holds three posts and a few stations of a fourth.
  const capacity = layout.postsPerFloor * layout.stationsPerPost;
  const agents = Array.makeBy(
    (floors - 1) * capacity + 3 * layout.stationsPerPost + 4,
    index => AgentId.make(`synthetic-dev-agent-${index}`),
  );
  yield* Effect.log(`Publishing ${agents.length} synthetic arrivals to ${world}`);
  yield* Effect.forEach(agents, (agent, index) =>
    encodeJoin({ world, checkpoint, agent }).pipe(
      Effect.flatMap(body => post("/join", body)),
      Effect.tap(() =>
        (index + 1) % 200 === 0 ? Effect.log(`${index + 1} of ${agents.length} arrivals published`) : Effect.void
      ),
    ), { discard: true });
  // Movers come from the world's own snapshot, so every desk, post and floor
  // they visit is one the world allocated.
  const frame = yield* RpcClient.make(WorldRpcs).pipe(
    Effect.flatMap(client => client.watchWorld({ world, chain, after: Option.none() }).pipe(Stream.runHead)),
    Effect.scoped,
    Effect.provide(
      RpcClient.layerProtocolHttp({ url: `${base}/api/world` }).pipe(Layer.provide(RpcSerialization.layerNdjson)),
    ),
    Effect.flatMap(Effect.fromOption),
  );
  if (frame._tag !== "Snapshot") return yield* Effect.die("The world stream must open with a snapshot");
  const movers = circuits(frame.snapshot.model.floors);
  const viewer = (layoutName: "proposal" | "grid") => {
    const url = new URL(base);
    url.searchParams.set("world", world);
    url.searchParams.set("chain", chain);
    url.searchParams.set("layout", layoutName);
    url.searchParams.set("seed", String(seed));
    return url.href;
  };
  yield* fs.makeDirectory(path.dirname(metadataPath), { recursive: true });
  yield* fs.writeFileString(
    metadataPath,
    yield* Schema.encodeEffect(DevWorldMetadataJson)({
      world,
      chain,
      seed,
      floors,
      urls: { proposal: viewer("proposal"), grid: viewer("grid") },
    }),
  );
  yield* Effect.addFinalizer(() => fs.remove(metadataPath, { force: true }).pipe(Effect.orDie));
  yield* Effect.log(`Development world ready with ${floors} occupied floors; ${movers.length} agents walk every 3 s`);
  return yield* Stream.iterate(0, step => step + 1).pipe(
    Stream.schedule(Schedule.spaced("3 seconds")),
    Stream.runForEach(step =>
      Effect.forEach(movers, mover =>
        Option.match(Array.get(mover.route, step % mover.route.length), {
          onNone: () => Effect.void,
          onSome: location =>
            encodeMove({ world, checkpoint, agent: mover.agent, location }).pipe(
              Effect.flatMap(body => post("/move", body)),
            ),
        }), { discard: true })
    ),
  );
});

// oxlint-disable-next-line effecttsgo/any-unknown-in-error-context -- Alchemy erases its harness error type; this executable contains it at the runtime boundary.
BunRuntime.runMain(Test.toEffect(serve.pipe(Effect.provide(FetchHttpClient.layer)), options).pipe(Effect.orDie));
