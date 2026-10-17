import { BunRuntime } from "@effect/platform-bun";
import { ChangeWorldState, JoinWorld, MoveInWorld } from "@floor/api/world";
import { WorldRpcs } from "@floor/api/world-rpc";
import { AgentState } from "@floor/contract/agents";
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
  HashSet,
  Layer,
  Option,
  Path,
  Random,
  Ref,
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
const encodeState = Schema.encodeEffect(Schema.toCodecJson(ChangeWorldState));

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

// Synthetic bustle, so the viewer shows a working floor rather than hundreds
// of agents frozen at their desks: every agent reports a state, and a few at a
// time leave their desks for another post's crowd, a neighbour's desk or a
// named place before going home. Seeded, so a seed always bustles the same way.
const devStates = [
  ["researching", 30],
  ["trading", 20],
  ["working", 20],
  ["talking", 10],
  ["idle", 10],
  ["waitingForOwner", 5],
  ["asleep", 5],
] as const satisfies ReadonlyArray<readonly [AgentState, number]>;
const weightedState = Random.next.pipe(Effect.map(roll => {
  const total = devStates.reduce((sum, [, weight]) => sum + weight, 0);
  const pick = devStates.reduce<{ readonly left: number; readonly state: AgentState }>(
    (chosen, [state, weight]) => chosen.left <= 0 ? chosen : { left: chosen.left - weight, state },
    { left: roll * total, state: "working" },
  );
  return pick.state;
}));
interface Seat {
  readonly agent: AgentId;
  readonly floor: typeof Floor.Type;
  readonly posts: ReadonlyArray<OpenPost>;
  readonly home: OpenPost["stations"][number];
  readonly post: number;
}
const seatsOf = (floors: ReadonlyArray<typeof Floor.Type>, excluded: ReadonlySet<string>) =>
  floors.flatMap(floor => {
    const posts = openPosts(floor);
    return posts.flatMap((post, index) =>
      post.stations.filter(station => !excluded.has(station.desk.agentId)).map((home): Seat => ({
        agent: home.desk.agentId,
        floor,
        posts,
        home,
        post: index,
      }))
    );
  });
// Somewhere away from home on the seat's own floor.
const awayFrom = (seat: Seat): Effect.Effect<Option.Option<typeof AgentLocation.Type>> =>
  Effect.gen(function*() {
    const roll = yield* Random.next;
    const neighbour = Array.get(seat.posts, (seat.post + (yield* Random.nextIntBetween(1, 3))) % seat.posts.length);
    if (roll < .45) {
      return Option.map(neighbour, post => AgentLocation.cases.AtPost.make({ postId: post.id }));
    }
    if (roll < .8) {
      const station = yield* Random.nextIntBetween(0, 9);
      return Option.flatMap(neighbour, post =>
        Option.map(Array.get(post.stations, station % Math.max(1, post.stations.length)), visited =>
          AgentLocation.cases.AtDesk.make({ deskId: visited.desk.id })));
    }
    const place = Array.get(FloorPlace.literals, yield* Random.nextIntBetween(0, FloorPlace.literals.length - 1));
    return Option.map(place, value =>
      AgentLocation.cases.AtPlace.make({ floorId: seat.floor.id, place: value }));
  });

// A bustle publish that fails is logged; the world carries on.
const tolerant = <A, E>(publish: Effect.Effect<A, E>) =>
  publish.pipe(Effect.asVoid, Effect.catch(error => Effect.logWarning("Synthetic bustle publish failed", error)));

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
  const seats = seatsOf(frame.snapshot.model.floors, new Set(movers.map(mover => mover.agent)));
  const publishState = (agent: AgentId, state: AgentState) =>
    encodeState({ world, checkpoint, agent, state }).pipe(Effect.flatMap(body => post("/state", body)));
  const publishMove = (agent: AgentId, location: typeof AgentLocation.Type) =>
    encodeMove({ world, checkpoint, agent, location }).pipe(Effect.flatMap(body => post("/move", body)));
  // The world stores a full snapshot with every event, so the bustle stays
  // light: a sixth of the agents report a first state, one at a time, and a
  // publish that fails is logged rather than ending the world. Agents with no
  // reported state still work at their desks in the viewer.
  yield* Effect.forEach(
    seats.filter((_seat, index) => index % 6 === 0),
    seat => weightedState.pipe(Effect.flatMap(state => tolerant(publishState(seat.agent, state)))),
    { discard: true },
  ).pipe(Random.withSeed(seed), Effect.forkScoped);
  const away = yield* Ref.make(HashSet.empty<string>());
  const bustle = Effect.gen(function*() {
    const awayNow = yield* Ref.get(away);
    // Up to one agent in fifteen is away from its desk at a time.
    const limit = Math.ceil(seats.length / 15);
    for (let turn = 0; turn < 2; turn++) {
      const seat = Array.get(seats, yield* Random.nextIntBetween(0, Math.max(0, seats.length - 1)));
      if (Option.isNone(seat)) continue;
      const { agent, home } = seat.value;
      const roll = yield* Random.next;
      if (HashSet.has(awayNow, agent) && roll < .6) {
        yield* tolerant(publishMove(agent, AgentLocation.cases.AtDesk.make({ deskId: home.desk.id })));
        yield* Ref.update(away, set => HashSet.remove(set, agent));
      } else if (roll < .5 || HashSet.size(awayNow) >= limit) {
        yield* tolerant(publishState(agent, yield* weightedState));
      } else {
        const location = yield* awayFrom(seat.value);
        if (Option.isSome(location)) {
          yield* tolerant(publishMove(agent, location.value));
          yield* Ref.update(away, set => HashSet.add(set, agent));
        }
      }
    }
  });
  const circuit = (step: number) =>
    Effect.forEach(movers, mover =>
      Option.match(Array.get(mover.route, step % mover.route.length), {
        onNone: () => Effect.void,
        onSome: location => publishMove(mover.agent, location),
      }), { discard: true });
  yield* Stream.iterate(0, step => step + 1).pipe(
    Stream.schedule(Schedule.spaced("2500 millis")),
    Stream.runForEach(() => bustle),
    Random.withSeed(seed + 1),
    Effect.forkScoped,
  );
  return yield* Stream.iterate(0, step => step + 1).pipe(
    Stream.schedule(Schedule.spaced("3 seconds")),
    Stream.runForEach(circuit),
  );
});

// oxlint-disable-next-line effecttsgo/any-unknown-in-error-context -- Alchemy erases its harness error type; this executable contains it at the runtime boundary.
BunRuntime.runMain(Test.toEffect(serve.pipe(Effect.provide(FetchHttpClient.layer)), options).pipe(Effect.orDie));
