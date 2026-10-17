import { WorldSnapshot } from "@floor/contract/world-stream";
import { Effect, Option, Result, Schema, Stream } from "effect";
import { Command, Subscription, type Update } from "foldkit";
import type { HtmlBuilder } from "foldkit/html";
import { modifyFields } from "foldkit/struct";
import { defineView } from "foldkit/submodel";
import { deskDrawer } from "./_components/desk-drawer";
import { worldPanel } from "./_components/world-panel";
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
import { Camera, EntityId, Presentation, type Theme, Turn } from "./model";

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
  // The desk list stays folded away until asked for, so it never covers the floor.
  desksOpen: Schema.Boolean,
  deskQuery: Schema.String,
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
  theme: Theme = "day",
): Model => ({
  presentation: {
    revision: 1,
    theme,
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
  desksOpen: false,
  deskQuery: "",
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
// The theme rides in the URL like the camera, without a history entry.
const SyncTheme = Command.define("SyncTheme", {
  args: { theme: Schema.Literals(["day", "night"]) },
  messages: [Message.CompletedUrl, Message.FailedMap],
  execute: ({ theme }) =>
    writeUrl(url => {
      if (theme === "night") url.searchParams.set("theme", "night");
      else url.searchParams.delete("theme");
    }, false),
});
// Hands the renderer a new presentation, keeping whatever view the camera holds.
const Present = Command.define("Present", {
  args: { presentation: Presentation },
  messages: [Message.CompletedPresent, Message.FailedMap],
  execute: ({ presentation }) =>
    Effect.gen(function*() {
      const commands = yield* MapCommands;
      yield* commands.present(presentation, false, true);
      return Message.CompletedPresent();
    }).pipe(Effect.catch(error => Effect.succeed(Message.FailedMap({ reason: error.message })))),
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
    ClickedTheme: () => {
      const presentation = modifyFields(model.presentation, {
        theme: theme => theme === "day" ? "night" : "day",
        revision: revision => revision + 1,
      });
      return {
        model: modifyFields(model, { presentation: () => presentation }),
        commands: [
          SyncTheme({ theme: presentation.theme }),
          ...(model.status._tag === "Ready" ? [Present({ presentation })] : []),
        ],
      };
    },
    ToggledDesks: () => ({ model: modifyFields(model, { desksOpen: open => !open }) }),
    ChangedDeskQuery: ({ query }) => ({ model: modifyFields(model, { deskQuery: () => query }) }),
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

// Connection and renderer state, small at the foot of the view.
const mapFooter = (model: Model, h: HtmlBuilder<Message>) =>
  h.footer([h.Class("map-footer")], [
    h.p([h.Class("world-status"), h.AriaLive("polite")], [
      Option.isNone(model.selection)
        ? "Open a world link with world and chain parameters to watch agents."
        : model.worldConnection === "live"
        ? "World connected"
        : model.worldConnection === "reconnecting"
        ? "World disconnected · reconnecting from the last event"
        : "Connecting to the world…",
    ]),
    h.p([h.Class(model.status._tag === "Failed" ? "map-status failed" : "map-status")], [
      model.status._tag === "Failed"
        ? model.status.reason
        : model.status._tag === "Ready"
        ? Option.isSome(model.selection) ? "Rendering live world" : "Synthetic desks"
        : Option.isSome(model.selection)
        ? "Waiting for the world…"
        : "Preparing synthetic desks…",
    ]),
  ]);

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
    const ready = model.status._tag === "Ready";
    const night = model.presentation.theme === "night";
    return h.section([
      h.Class(Option.isSome(selectedAgent) ? "map-shell has-drawer" : "map-shell"),
      h.AriaLabel("Trading floor"),
    ], [
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
      h.div([h.Class("camera-controls"), h.AriaLabel("Camera")], [
        h.button([
          h.Id("rotate-left"),
          h.Class("chrome-button"),
          h.AriaLabel("Rotate left"),
          h.Title("Rotate left"),
          h.Disabled(!ready),
          h.OnClick(Message.ClickedRotate({ direction: "left" })),
        ], ["↺"]),
        h.button([
          h.Id("rotate-right"),
          h.Class("chrome-button"),
          h.AriaLabel("Rotate right"),
          h.Title("Rotate right"),
          h.Disabled(!ready),
          h.OnClick(Message.ClickedRotate({ direction: "right" })),
        ], ["↻"]),
        h.button([
          h.Id("theme"),
          h.Class("chrome-button chrome-text"),
          h.AriaPressed(night ? "true" : "false"),
          h.OnClick(Message.ClickedTheme()),
        ], ["Night"]),
      ]),
      Option.match(view, {
        onNone: () => h.empty,
        onSome: value =>
          worldPanel({
            floors: value.floors,
            inView,
            desks,
            open: model.desksOpen,
            query: model.deskQuery,
            selected: model.selected,
            ready,
          }, h),
      }),
      mapFooter(model, h),
      Option.match(Option.all({ agent: selectedAgent, desk: selectedDesk }), {
        onNone: () => h.empty,
        onSome: ({ agent, desk }) =>
          deskDrawer({
            agent,
            location: locationText(desk),
            follow: Option.isSome(desk.marker) && ready
              ? Option.some(Message.ClickedFollow({ entity: desk.id }))
              : Option.none(),
          }, h),
      }),
    ]);
  });
};
