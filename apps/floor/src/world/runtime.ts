import { SqliteClient } from "@effect/sql-sqlite-do";
import {
  ChangeWorldState,
  JoinWorld,
  LandWorldReceipt,
  WorldFrame,
  WorldPublisher,
  WorldPublishError,
  WorldQuery,
  WorldReader,
  WorldSnapshot,
} from "@floor/api/world";
import { WorldRpcs } from "@floor/api/world-rpc";
import { Receipt } from "@floor/contract/economics";
import { WorldEventId } from "@floor/contract/identifiers";
import { WorldChangeError } from "@floor/contract/world";
import { WorldEvent, WorldEventDelivery } from "@floor/contract/world-events";
import { allStations, assignAgent, createWorld } from "@floor/world";
import { assertReceiptEvolution, foldWorldEvent } from "@floor/world/stream";
import { DurableObject } from "alchemy/Cloudflare/Workers/DurableObject";
import { DurableObjectState } from "alchemy/Cloudflare/Workers/DurableObjectState";
import { SqlMigrations } from "alchemy/Cloudflare/Workers/SqlMigrations";
import type { Worker } from "alchemy/Cloudflare/Workers/Worker";
import { Context, Effect, Layer, Option, PubSub, Ref, Schema, Semaphore, Stream } from "effect";
import {
  HttpClient,
  HttpClientError,
  HttpClientResponse,
  HttpRouter,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/http";
import { RpcClient, RpcSerialization, RpcServer } from "effect/rpc";
import { SqlSchema } from "effect/sql";

const Publication = Schema.TaggedUnion({
  Join: JoinWorld.fields,
  State: ChangeWorldState.fields,
  Receipt: LandWorldReceipt.fields,
});
const PublicationJson = Schema.toCodecJson(Publication);
const EventJson = Schema.toCodecJson(WorldEvent);
const EventText = Schema.fromJsonString(EventJson);
const SnapshotText = Schema.fromJsonString(Schema.toCodecJson(WorldSnapshot));
const JournalRow = Schema.Struct({ sequence: Schema.Natural, event: EventText, snapshot: SnapshotText });
interface FloorWorldRpc {
  readonly publish: (input: Schema.Json) => Effect.Effect<Schema.Json, WorldPublishError>;
}
class FloorWorlds
  extends DurableObject<FloorWorlds, FloorWorldRpc>()("FLOOR_WORLDS", { errors: [WorldPublishError] })
{}

const WorldsLive = FloorWorlds.make(Effect.map(
  SqlMigrations("./apps/floor/src/world/_migrations"),
  migrations =>
    Effect.gen(function*() {
      const storage = yield* DurableObjectState;
      yield* migrations.apply().pipe(Effect.orDie);
      const sql = Context.get(
        yield* Layer.build(SqliteClient.layer({ storage: storage.raw.storage })),
        SqliteClient.SqliteClient,
      );
      const updates = yield* PubSub.sliding<boolean>({ capacity: 1 });
      const writes = yield* Semaphore.make(1);
      const findLatest = SqlSchema.findOneOption({
        Request: Schema.Struct({}),
        Result: JournalRow,
        execute: () => sql`SELECT sequence, event, snapshot FROM world_events ORDER BY sequence DESC LIMIT 1`,
      });
      const findPublication = SqlSchema.findOneOption({
        Request: Schema.Struct({ kind: Schema.String, agent: Schema.String }),
        Result: JournalRow,
        execute: ({ kind, agent }) =>
          sql`SELECT sequence, event, snapshot FROM world_events
        WHERE json_extract(event, '$._tag') = ${kind} AND json_extract(event, '$.agent') = ${agent}
        ORDER BY sequence DESC LIMIT 1`,
      });
      const findReceipt = SqlSchema.findOneOption({
        Request: Schema.String,
        Result: JournalRow,
        execute: receipt =>
          sql`SELECT sequence, event, snapshot FROM world_events
          WHERE json_extract(event, '$._tag') = 'ReceiptLanded' AND json_extract(event, '$.receipt') = ${receipt}
          ORDER BY sequence DESC LIMIT 1`,
      });
      const findSequence = SqlSchema.findOneOption({
        Request: Schema.Natural,
        Result: JournalRow,
        execute: sequence => sql`SELECT sequence, event, snapshot FROM world_events WHERE sequence = ${sequence}`,
      });
      const findAfter = SqlSchema.findAll({
        Request: Schema.Natural,
        Result: JournalRow,
        execute: sequence =>
          sql`SELECT sequence, event, snapshot FROM world_events WHERE sequence > ${sequence} ORDER BY sequence`,
      });
      const initial = Effect.fnUntraced(
        function*(input: typeof WorldQuery.Type, layout?: typeof WorldSnapshot.Type["model"]["layout"]) {
          const model = yield* Effect.fromResult(createWorld(input.world, input.chain, layout));
          return WorldSnapshot.make({ model, chain: input.chain, sequence: 0, checkpoint: Option.none(), agents: [] });
        },
      );
      const latest = Effect.fnUntraced(function*(input: typeof WorldQuery.Type) {
        const row = yield* findLatest({});
        const snapshot = Option.isSome(row) ? row.value.snapshot : yield* initial(input);
        if (snapshot.model.id !== input.world || snapshot.chain !== input.chain) {
          return yield* new WorldChangeError({ reason: "wrongChain", reference: input.world });
        }
        return snapshot;
      });
      const handlers = {
        publish: Effect.fn("FloorWorlds.publish")(function*(encoded: Schema.Json) {
          const input = yield* Schema.decodeEffect(PublicationJson)(encoded).pipe(Effect.orDie);
          const operation = input._tag === "Join" ? "join" : input._tag === "State" ? "state" : "receipt";
          return yield* writes.withPermit(
            sql.withTransaction(Effect.gen(function*() {
              const snapshot = yield* latest({
                world: input.world,
                chain: input.checkpoint.chain,
                after: Option.none(),
              });
              const existing = snapshot.agents.find(agent => agent.agent === input.agent);
              if (input._tag === "Join" && existing) {
                return (yield* Effect.fromOption(yield* findPublication({ kind: "AgentJoined", agent: input.agent })))
                  .event;
              }
              if (input._tag === "Receipt") {
                const prior = yield* findReceipt(input.receipt.id);
                if (Option.isSome(prior)) {
                  const previous = yield* Effect.fromOption(Option.flatMap(
                    Option.fromNullishOr(prior.value.snapshot.agents.find(agent => agent.agent === input.agent)),
                    agent => agent.receipt,
                  ));
                  if (Schema.toEquivalence(Receipt)(previous, input.receipt)) return prior.value.event;
                  yield* assertReceiptEvolution(previous, input.receipt);
                }
              }
              const id = WorldEventId.make(`event_${snapshot.sequence + 1}`);
              const checkpoint = input._tag === "Receipt" && input.receipt._tag === "SettledReceipt"
                ? input.receipt.checkpoint
                : input.checkpoint;
              const fields = { id, world: input.world, checkpoint, agent: input.agent };
              let event: WorldEvent;
              if (input._tag === "Join") {
                const joined = yield* Effect.fromResult(
                  assignAgent(snapshot.model, input.agent, input.checkpoint.chain),
                );
                const station = yield* Effect.fromOption(
                  Option.fromNullishOr(allStations(joined).find(item => item.desk.agentId === input.agent)),
                );
                event = WorldEvent.cases.AgentJoined.make({ ...fields, desk: station.desk.id });
              } else if (input._tag === "State") {
                event = WorldEvent.cases.AgentStateChanged.make({ ...fields, state: input.state });
              } else {
                event = WorldEvent.cases.ReceiptLanded.make({ ...fields, receipt: input.receipt.id });
              }
              const next = yield* foldWorldEvent(
                snapshot,
                event,
                input._tag === "Receipt" ? Option.some(input.receipt) : Option.none(),
              );
              const eventText = yield* Schema.encodeEffect(EventText)(event);
              const snapshotText = yield* Schema.encodeEffect(SnapshotText)(next);
              yield* sql`INSERT INTO world_events (sequence, event, snapshot) VALUES (${next.sequence}, ${eventText}, ${snapshotText})`;
              return event;
            })).pipe(
              // Notifications carry no data. A slow subscriber drains the durable log,
              // so sliding wakeups cannot drop committed world events.
              Effect.tap(() => PubSub.publish(updates, true)),
              // Once a transaction starts, its commit and wakeup form one operation.
              Effect.uninterruptible,
              Effect.flatMap(Schema.encodeEffect(EventJson)),
              Effect.mapError(cause => new WorldPublishError({ operation, world: input.world, cause })),
            ),
          );
        }),
        watch: (input: typeof WorldQuery.Type) =>
          Stream.unwrap(Effect.gen(function*() {
            // Subscribe before reading the checkpoint so a concurrent commit is
            // either in the initial drain or leaves a pending wakeup.
            const subscription = yield* PubSub.subscribe(updates);
            const head = yield* latest(input);
            const sequence = Option.getOrElse(input.after, () => head.sequence);
            if (sequence > head.sequence) {
              return yield* new WorldChangeError({ reason: "invalidTopology", reference: String(sequence) });
            }
            const snapshot = sequence === head.sequence ? head : sequence === 0
              ? yield* initial(input, head.model.layout)
              : (yield* Effect.fromOption(yield* findSequence(sequence))).snapshot;
            const cursor = yield* Ref.make(sequence);
            const drain = Effect.gen(function*() {
              const rows = yield* findAfter(yield* Ref.get(cursor));
              // An empty world has no chain evidence yet. A subscriber that
              // guessed another chain must fail when the first event arrives.
              if (rows.some(row => row.event.world !== input.world || row.snapshot.chain !== input.chain)) {
                return yield* new WorldChangeError({ reason: "wrongChain", reference: input.world });
              }
              if (rows.length > 0) {
                yield* Ref.set(cursor, rows.at(-1)?.sequence ?? sequence);
              }
              return rows.map(row => {
                const event = row.event;
                return WorldFrame.cases.Delivery.make({
                  sequence: row.sequence,
                  delivery: WorldEventDelivery.cases.Live.make({ event: row.event }),
                  receipt: event._tag === "ReceiptLanded"
                    ? row.snapshot.agents.find(agent => agent.agent === event.agent)?.receipt ?? Option.none()
                    : Option.none(),
                });
              });
            });
            return Stream.concat(
              Stream.succeed(WorldFrame.cases.Snapshot.make({ snapshot })),
              Stream.concat(Stream.succeed(true), Stream.fromSubscription(subscription)).pipe(
                Stream.mapEffect(() => drain),
                Stream.flatMap(Stream.fromIterable),
              ),
            );
          })).pipe(
            Stream.mapError(cause => new WorldPublishError({ operation: "read", world: input.world, cause })),
          ),
      };
      const routes = RpcServer.layerHttp({ group: WorldRpcs, path: "/", protocol: "http" }).pipe(
        Layer.provide(RpcSerialization.layerNdjson),
        Layer.provide(WorldRpcs.toLayer({ watchWorld: handlers.watch })),
        Layer.provide(HttpServer.layerServices),
      );
      return {
        publish: handlers.publish,
        // The DO initializer's scope closes before requests. Build the RPC
        // server in the request scope so its stream handlers remain alive.
        fetch: HttpRouter.toHttpEffect(routes).pipe(Effect.flatten),
      };
    }),
));

type Worlds = Effect.Success<typeof FloorWorlds>;
const publisherFor = (worlds: Worlds) => {
  const publish = Effect.fn("WorldPublisher.publish")(function*(input: typeof Publication.Type) {
    const encoded = yield* Schema.encodeEffect(PublicationJson)(input);
    return yield* worlds.getByName(input.world).publish(encoded).pipe(Effect.flatMap(Schema.decodeEffect(EventJson)));
  });
  return WorldPublisher.of({
    join: input =>
      publish(Publication.cases.Join.make(input)).pipe(
        Effect.mapError(cause => new WorldPublishError({ operation: "join", world: input.world, cause })),
      ),
    state: input =>
      publish(Publication.cases.State.make(input)).pipe(
        Effect.mapError(cause => new WorldPublishError({ operation: "state", world: input.world, cause })),
      ),
    receipt: input =>
      publish(Publication.cases.Receipt.make(input)).pipe(
        Effect.mapError(cause => new WorldPublishError({ operation: "receipt", world: input.world, cause })),
      ),
  });
};

// Another script reaches a host's world namespace through a cross-script binding,
// with the same publication wire format and journal as the host's own publisher.
export const remoteWorldPublisher = (hostScript: string) =>
  Layer.effect(WorldPublisher, Effect.map(FloorWorlds.from(hostScript), publisherFor));

export const WorldRuntimeLive: Layer.Layer<WorldPublisher | WorldReader, never, Worker> = Layer.unwrap(
  Effect.gen(function*() {
    const worlds = yield* FloorWorlds;
    return Layer.mergeAll(
      Layer.succeed(WorldPublisher, publisherFor(worlds)),
      Layer.succeed(
        WorldReader,
        WorldReader.of({
          watch: input => {
            // Native RPC's eager stream encoder closes a peeled source scope after
            // its first value. Native fetch keeps the RPC response body scoped.
            const protocol = RpcClient.layerProtocolHttp({ url: "http://floor-world/" }).pipe(
              Layer.provide(RpcSerialization.layerNdjson),
              Layer.provide(HttpClient.layerMergedContext(Effect.succeed(
                HttpClient.make(request =>
                  worlds.getByName(input.world).fetch(HttpServerRequest.fromClientRequest(request)).pipe(
                    Effect.map(response => HttpClientResponse.fromWeb(request, HttpServerResponse.toWeb(response))),
                    Effect.mapError(cause =>
                      new HttpClientError.HttpClientError({
                        reason: new HttpClientError.TransportError({ request, cause }),
                      })
                    ),
                  )
                ),
              ))),
            );
            return Stream.unwrap(Effect.map(RpcClient.make(WorldRpcs), client => client.watchWorld(input))).pipe(
              Stream.provide(protocol),
              Stream.mapError(cause => new WorldPublishError({ operation: "read", world: input.world, cause })),
            );
          },
        }),
      ),
    );
  }),
).pipe(Layer.provide(WorldsLive));
