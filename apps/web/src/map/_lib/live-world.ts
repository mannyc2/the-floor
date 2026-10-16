import { WorldRpcs } from "@floor/api/world-rpc";
import { ChainRef, WorldId } from "@floor/contract/identifiers";
import { WorldSnapshot } from "@floor/contract/world-stream";
import { foldWorldEvent } from "@floor/world/stream";
import { Effect, Layer, Option, Queue, Ref, Schema, Stream } from "effect";
import { RpcClient, RpcSerialization } from "effect/rpc";
import { Http } from "foldkit";
import { Message } from "../message";

export const WorldSelection = Schema.Struct({ world: WorldId, chain: ChainRef });
export type WorldSelection = typeof WorldSelection.Type;
export const selectionFromQuery = (query: URLSearchParams) =>
  Schema.decodeUnknownOption(WorldSelection)({ world: query.get("world"), chain: query.get("chain") });

// Entity identity follows canonical topology slots, independent of arrival order.
// The last floor is a blueprint, so it needs no renderer allocation yet.
export const deskCapacity = (snapshot: typeof WorldSnapshot.Type) =>
  Math.max(1, snapshot.model.floors.length - 1) * snapshot.model.layout.postsPerFloor
  * snapshot.model.layout.stationsPerPost;

export const worldDesks = (snapshot: typeof WorldSnapshot.Type) => {
  const world = snapshot.model;
  const origin = world.floors[0].origin;
  return world.floors.flatMap(floor =>
    floor.posts.flatMap(post =>
      post._tag === "BlueprintTradingPost" ? [] : post.stations.map(station => ({
        id: floor.index * world.layout.postsPerFloor * world.layout.stationsPerPost
          + post.index * world.layout.stationsPerPost + station.index + 2,
        agent: station.desk.agentId,
        // One translation centres the first floor without rewriting world layout.
        x: floor.origin.x + station.position.x - origin.x,
        y: .05,
        z: floor.origin.z + station.position.z - origin.z,
      }))
    )
  );
};

export const rendererSnapshot = (snapshot: typeof WorldSnapshot.Type, revision: number) => ({
  revision,
  instances: worldDesks(snapshot).map(desk => {
    const state = Option.flatMap(
      Option.fromUndefinedOr(snapshot.agents.find(agent => agent.agent === desk.agent)),
      agent => agent.state,
    );
    return {
      id: desk.id,
      x: desk.x,
      y: desk.y,
      z: desk.z,
      active: Option.exists(state, value => value === "researching" || value === "trading"),
    };
  }),
});

class WorldStreamFailure extends Schema.TaggedError<WorldStreamFailure>()("WorldStreamFailure", {
  reason: Schema.String,
}) {}

const protocol = RpcClient.layerProtocolHttp({ url: "/api/world" }).pipe(
  Layer.provide([Http.layer, RpcSerialization.layerNdjson]),
);

export const watchWorld = (selection: WorldSelection) =>
  Stream.callback<typeof Message.ReceivedWorldSnapshot.Type | typeof Message.ChangedWorldConnection.Type>(
    queue =>
      Effect.gen(function*() {
        const latest = yield* Ref.make(Option.none<typeof WorldSnapshot.Type>());
        const connect = Effect.gen(function*() {
          const previous = yield* Ref.get(latest);
          const client = yield* RpcClient.make(WorldRpcs);
          yield* client.watchWorld({ ...selection, after: Option.map(previous, value => value.sequence) }).pipe(
            Stream.runForEach(frame =>
              Effect.gen(function*() {
                const current = yield* Ref.get(latest);
                if (frame._tag === "Delivery" && frame.delivery._tag !== "Live") {
                  return yield* new WorldStreamFailure({ reason: "Replay evidence cannot enter the live viewer" });
                }
                const next = frame._tag === "Snapshot"
                  ? frame.snapshot
                  : Option.isSome(current) && frame.sequence === current.value.sequence + 1
                  ? yield* foldWorldEvent(current.value, frame.delivery.event, frame.receipt)
                  : yield* new WorldStreamFailure({ reason: "World delivery is not contiguous" });
                if (next.model.id !== selection.world || next.chain !== selection.chain) {
                  return yield* new WorldStreamFailure({ reason: "World snapshot does not match the requested world" });
                }
                yield* Ref.set(latest, Option.some(next));
                Queue.offerUnsafe(queue, Message.ReceivedWorldSnapshot({ snapshot: next }));
                Queue.offerUnsafe(queue, Message.ChangedWorldConnection({ connection: "live" }));
                return void 0;
              })
            ),
          );
        }).pipe(
          Effect.scoped,
          Effect.catch(error => Effect.logWarning("World stream disconnected", error)),
          // Each reconnect owns its HTTP client and request fibers.
          // oxlint-disable-next-line effect/noInlineProvide, effecttsgo/strict-effect-provide -- The subscription connection is the browser fetch composition boundary.
          Effect.provide(protocol),
        );
        return yield* connect.pipe(
          // A quiet HTTP stream may not fail immediately when the browser loses
          // its network. Release it on offline so stale evidence is labelled and
          // the next connection resumes from the last accepted sequence.
          Effect.raceFirst(Stream.fromEventListener(window, "offline").pipe(Stream.runHead)),
          Effect.andThen(Effect.sync(() => {
            Queue.offerUnsafe(queue, Message.ChangedWorldConnection({ connection: "reconnecting" }));
          })),
          Effect.andThen(Effect.sleep("1 second")),
          Effect.forever,
        );
      }),
    { bufferSize: 32, strategy: "sliding" },
  );
