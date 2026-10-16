import { WorldSnapshot } from "@floor/contract/world-stream";
import { Effect, Option, Result, Schema, Stream } from "effect";
import { Command, Subscription, type Update } from "foldkit";
import { modifyFields } from "foldkit/struct";
import { defineView } from "foldkit/submodel";
import { deskDrawer } from "./_components/desk-drawer";
import {
  acceptWorldFrame,
  deskCapacity,
  floorInView,
  liveScene,
  locationText,
  rendererSnapshot,
  watchWorld,
  WorldSelection,
  worldView,
} from "./_lib/live-world";
import { makeMountMap, MapCommands } from "./_lib/renderer/service";
import { Message, WorldConnection } from "./message";
import { Camera, EntityId, Presentation, Turn } from "./model";

export { MapCommands } from "./_lib/renderer/service";
export { Message } from "./message";
export const Model = Schema.Struct({
  presentation: Presentation,
  desks: Schema.Int,
  status: Schema.Union([
    Schema.TaggedStruct("Opening", {}),
    Schema.TaggedStruct("Ready", {}),
    Schema.TaggedStruct("Failed", { reason: Schema.String }),
  ]),
  generation: Schema.Int,
  selected: Schema.Option(EntityId),
  selection: Schema.Option(WorldSelection),
  // A reloaded page's delivery sequence, used only until a snapshot is accepted.
  resume: Schema.Option(Schema.Natural),
  // The single world the renderer reconciles from. Deliveries fold into it here,
  // so its sequence is the stream cursor.
  world: Schema.Option(WorldSnapshot),
  worldConnection: WorldConnection,
  worldRevision: Schema.Natural,
  // Advanced when the Model rejects a frame, restarting the stream from the cursor.
  worldEpoch: Schema.Natural,
});
export type Model = typeof Model.Type;

const sameSelection = Schema.toEquivalence(Schema.Option(WorldSelection));
const worldCursor = (model: Model) =>
  Option.orElse(Option.map(model.world, world => world.sequence), () => model.resume);
export const subscriptions = Subscription.make<Model, Message>()(entry => ({
  world: entry({
    selection: Schema.Option(WorldSelection),
    epoch: Schema.Natural,
    cursor: Schema.Option(Schema.Natural),
  }, {
    modelToDependencies: model => ({ selection: model.selection, epoch: model.worldEpoch, cursor: worldCursor(model) }),
    // The cursor advances with every delivery; reading it must not restart the stream.
    keepAliveEquivalence: (self, that) => self.epoch === that.epoch && sameSelection(self.selection, that.selection),
    dependenciesToStream: ({ selection, epoch }, read) =>
      Option.match(selection, {
        onNone: () => Stream.empty,
        onSome: value => watchWorld(value, epoch > 0, () => read().cursor),
      }),
  }),
}));
export const initialModel = (
  desks: number,
  camera = Option.none<Camera>(),
  selection = Option.none<WorldSelection>(),
  resume = Option.none<number>(),
): Model => ({
  presentation: {
    revision: 1,
    theme: "day",
    camera: Option.getOrElse(camera, () => ({ x: 0, z: 0, extent: desks > 12 ? 380 : 21, rotation: 0 })),
    sampleTime: 0,
    playbackRate: 0,
    previousValue: 0,
    nextValue: 0,
    intervalStart: 0,
  },
  desks,
  status: Model.fields.status.members[0].make({}),
  generation: 0,
  selected: Option.none(),
  selection,
  resume,
  world: Option.none(),
  worldConnection: "connecting",
  worldRevision: 0,
  worldEpoch: 0,
});

const ApplyWorld = Command.define("ApplyWorld", {
  args: { snapshot: WorldSnapshot, revision: Schema.Natural, generation: Schema.Natural },
  messages: [Message.AppliedWorldSnapshot, Message.FailedMap],
  execute: ({ snapshot, revision, generation }) =>
    Effect.gen(function*() {
      const commands = yield* MapCommands;
      yield* commands.snapshotWorld(rendererSnapshot(snapshot, revision), generation);
      return Message.AppliedWorldSnapshot({ revision });
    }).pipe(Effect.catch(error => Effect.succeed(Message.FailedMap({ reason: error.message })))),
});

const writeUrl = (change: (url: URL) => void, push: boolean) =>
  Effect.try({
    try: () => {
      const url = new URL(location.href);
      change(url);
      if (push) history.pushState({}, "", url);
      else history.replaceState({}, "", url);
      return Message.CompletedUrl();
    },
    catch: cause => Message.FailedMap({ reason: String(cause) }),
  }).pipe(Effect.catch(Effect.succeed));
const SyncUrl = Command.define("SyncUrl", {
  args: { camera: Camera, push: Schema.Boolean },
  messages: [Message.CompletedUrl, Message.FailedMap],
  execute: ({ camera, push }) =>
    writeUrl(url => {
      url.searchParams.set("x", String(camera.x));
      url.searchParams.set("z", String(camera.z));
      url.searchParams.set("extent", String(camera.extent));
      url.searchParams.set("rotation", String(camera.rotation));
    }, push),
});
// The accepted sequence rides in the URL like the resting camera, so a reload
// resumes the stream from it and replays later deliveries through this Model.
const SyncSequence = Command.define("SyncSequence", {
  args: { sequence: Schema.Natural },
  messages: [Message.CompletedUrl, Message.FailedMap],
  execute: ({ sequence }) => writeUrl(url => url.searchParams.set("sequence", String(sequence)), false),
});
const Rotate = Command.define("Rotate", {
  args: { direction: Turn },
  messages: [Message.CompletedFlight, Message.FailedMap],
  execute: ({ direction }) =>
    Effect.gen(function*() {
      const commands = yield* MapCommands;
      yield* commands.rotate(direction);
      return Message.CompletedFlight();
    }).pipe(Effect.catch(error => Effect.succeed(Message.FailedMap({ reason: error.message })))),
});
const Fly = Command.define("Fly", {
  args: { camera: Camera },
  messages: [Message.CompletedFlight, Message.FailedMap],
  execute: ({ camera }) =>
    Effect.gen(function*() {
      const commands = yield* MapCommands;
      yield* commands.fly(camera, false);
      return Message.CompletedFlight();
    }).pipe(Effect.catch(error => Effect.succeed(Message.FailedMap({ reason: error.message })))),
});
const FollowAgent = Command.define("FollowAgent", {
  args: { entity: EntityId },
  messages: [Message.CompletedFlight, Message.FailedMap],
  execute: ({ entity }) =>
    Effect.gen(function*() {
      const commands = yield* MapCommands;
      yield* commands.followMarker(entity);
      return Message.CompletedFlight();
    }).pipe(Effect.catch(error => Effect.succeed(Message.FailedMap({ reason: error.message })))),
});

const acceptWorld = (model: Model, snapshot: typeof WorldSnapshot.Type): Update.Return<Model, Message, MapCommands> => {
  const desks = deskCapacity(snapshot);
  const worldRevision = model.worldRevision + 1;
  const remount = Option.isNone(model.world) || desks !== model.desks;
  const next = modifyFields(model, {
    desks: () => desks,
    resume: () => Option.none(),
    world: () => Option.some(snapshot),
    worldRevision: () => worldRevision,
    generation: value => remount ? 0 : value,
    status: status =>
      desks > 4085
        ? Model.fields.status.members[2].make({ reason: "This world exceeds the viewer's 4,085-desk capacity." })
        : remount
        ? Model.fields.status.members[0].make({})
        : status,
  });
  return {
    model: next,
    commands: [
      SyncSequence({ sequence: snapshot.sequence }),
      ...(!remount && next.status._tag === "Ready"
        ? [ApplyWorld({ snapshot, revision: worldRevision, generation: model.generation })]
        : []),
    ],
  };
};

export const update = (model: Model, message: Message) =>
  Message.match<Update.Return<Model, Message, MapCommands>>(message, {
    SucceededMountMap: ({ generation, snapshotRevision }) => ({
      model: modifyFields(model, {
        generation: () => generation,
        status: () => Model.fields.status.members[1].make({}),
      }),
      commands: [
        SyncUrl({ camera: model.presentation.camera, push: false }),
        ...(Option.isSome(model.world) && model.worldRevision > (snapshotRevision ?? -1)
          ? [ApplyWorld({ snapshot: model.world.value, revision: model.worldRevision, generation })]
          : []),
      ],
    }),
    AppliedFrame: () => ({ model }),
    SelectedEntity: ({ entity }) => ({ model: modifyFields(model, { selected: () => entity }) }),
    RestedCamera: ({ camera, history }) => ({
      model: modifyFields(model, {
        presentation: frame => modifyFields(frame, { camera: () => camera }),
      }),
      commands: [SyncUrl({ camera, push: history })],
    }),
    FailedMap: ({ reason }) => ({
      model: modifyFields(model, { status: () => Model.fields.status.members[2].make({ reason }) }),
    }),
    ClickedRotate: ({ direction }) => ({ model, commands: [Rotate({ direction })] }),
    ClickedFloor: ({ floor }) => ({
      model,
      commands: Option.match(
        Option.flatMap(model.world, world => Option.fromUndefinedOr(worldView(world).floors[floor])),
        {
          onNone: () => [],
          onSome: target => [Fly({ camera: { ...model.presentation.camera, x: target.focus.x, z: target.focus.z } })],
        },
      ),
    }),
    ClickedFollow: ({ entity }) => ({ model, commands: [FollowAgent({ entity })] }),
    ReceivedWorldFrame: ({ frame }) =>
      Option.match(model.selection, {
        onNone: () => ({ model }),
        onSome: selection =>
          Result.match(acceptWorldFrame(selection, model.world, frame), {
            // Only the first rejection on a live connection restarts it; frames the
            // old connection had already queued are stale by then.
            onFailure: () => ({
              model: model.worldConnection === "live"
                ? modifyFields(model, { worldConnection: () => "reconnecting", worldEpoch: epoch => epoch + 1 })
                : model,
            }),
            onSuccess: accepted =>
              Option.match(accepted, { onNone: () => ({ model }), onSome: snapshot => acceptWorld(model, snapshot) }),
          }),
      }),
    ChangedWorldConnection: ({ connection }) => ({
      model: modifyFields(model, {
        worldConnection: () => connection,
        // A resume cursor the world no longer serves must not block a fresh page.
        resume: resume => connection === "reconnecting" && Option.isNone(model.world) ? Option.none() : resume,
      }),
    }),
    AppliedWorldSnapshot: () => ({ model }),
    CompletedPresent: () => ({ model }),
    CompletedFlight: () => ({ model }),
    CompletedUrl: () => ({ model }),
  });

export const makeView = (commands: MapCommands["Service"]) => {
  const MountMap = makeMountMap(commands);
  return defineView<Model, Message>((model, h) => {
    const view = Option.map(model.world, worldView);
    const desks = Option.match(view, { onNone: () => [], onSome: value => value.desks });
    const inView = Option.flatMap(view, value => floorInView(value, model.presentation.camera));
    const selectedDesk = Option.flatMap(
      model.selected,
      id => Option.fromUndefinedOr(desks.find(desk => desk.id === id)),
    );
    const selectedAgent = Option.flatMap(selectedDesk, desk => desk.record);
    const canMount = Option.isNone(model.selection) || Option.isSome(model.world);
    return h.section([
      h.Class(Option.isSome(selectedAgent) ? "map-shell has-drawer" : "map-shell"),
      h.AriaLabel("Trading floor"),
    ], [
      h.div([h.Class("camera-rotation"), h.AriaLabel("Camera rotation")], [
        h.button([
          h.Id("rotate-left"),
          h.Disabled(model.status._tag !== "Ready"),
          h.OnClick(Message.ClickedRotate({ direction: "left" })),
        ], ["Rotate left"]),
        h.button([
          h.Id("rotate-right"),
          h.Disabled(model.status._tag !== "Ready"),
          h.OnClick(Message.ClickedRotate({ direction: "right" })),
        ], ["Rotate right"]),
      ]),
      canMount && model.desks <= 4085
        ? h.keyed("div")(`map-${model.desks}`, [
          h.Id("map"),
          h.Class("map"),
          h.OnMount(MountMap({
            initialPresentation: model.presentation,
            initialDesks: model.desks,
            initialLive: Option.map(model.world, snapshot => liveScene(snapshot, model.worldRevision)),
          })),
        ])
        : h.empty,
      h.p([h.Class("map-status")], [
        model.status._tag === "Failed"
          ? model.status.reason
          : model.status._tag === "Ready"
          ? Option.isSome(model.selection) ? "Rendering live world" : "Synthetic desks"
          : Option.isSome(model.selection)
          ? "Waiting for the world…"
          : "Preparing synthetic desks…",
      ]),
      h.div([h.Class("world-status"), h.AriaLive("polite")], [
        h.p([], [
          Option.isNone(model.selection)
            ? "Open a world link with world and chain parameters to watch agents."
            : model.worldConnection === "live"
            ? "World connected"
            : model.worldConnection === "reconnecting"
            ? "World disconnected · reconnecting from the last event"
            : "Connecting to the world…",
        ]),
        Option.match(view, {
          onNone: () => h.empty,
          onSome: value =>
            h.nav(
              [h.AriaLabel("Floors"), h.Class("world-floors")],
              value.floors.map(floor =>
                h.button([
                  h.AriaCurrent(Option.exists(inView, current => current.index === floor.index) ? "location" : "false"),
                  h.OnClick(Message.ClickedFloor({ floor: floor.index })),
                  h.Disabled(model.status._tag !== "Ready"),
                ], [
                  `Floor ${floor.index + 1} · ${
                    floor.blueprint ? "blueprint" : `${floor.desks} ${floor.desks === 1 ? "desk" : "desks"}`
                  }`,
                ])
              ),
            ),
        }),
        // Desks on the floor in view; the floor list reaches the others.
        h.div(
          [h.Class("world-desks")],
          desks.filter(desk => Option.exists(inView, floor => floor.index === desk.floor)).map(desk =>
            h.button([
              h.AriaLabel(`Open desk for ${desk.agent}`),
              h.DataAttribute("agent-state", Option.getOrElse(desk.state, () => "unreported")),
              h.OnClick(Message.SelectedEntity({ entity: Option.some(desk.id) })),
            ], [desk.agent])
          ),
        ),
      ]),
      Option.match(Option.all({ agent: selectedAgent, desk: selectedDesk }), {
        onNone: () => h.empty,
        onSome: ({ agent, desk }) =>
          deskDrawer({
            agent,
            location: locationText(desk),
            follow: Option.isSome(desk.marker) && model.status._tag === "Ready"
              ? Option.some(Message.ClickedFollow({ entity: desk.id }))
              : Option.none(),
          }, h),
      }),
    ]);
  });
};
