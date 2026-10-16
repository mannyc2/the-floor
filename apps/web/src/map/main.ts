import { WorldSnapshot } from "@floor/contract/world-stream";
import { Effect, Option, Schema, Stream } from "effect";
import { Command, Subscription, type Update } from "foldkit";
import { modifyFields } from "foldkit/struct";
import { defineView } from "foldkit/submodel";
import { deskDrawer } from "./_components/desk-drawer";
import { deskCapacity, rendererSnapshot, watchWorld, worldDesks, WorldSelection } from "./_lib/live-world";
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
  world: Schema.Option(WorldSnapshot),
  worldConnection: WorldConnection,
  worldRevision: Schema.Natural,
});
export type Model = typeof Model.Type;
export const subscriptions = Subscription.make<Model, Message>()(entry => ({
  world: entry({ selection: Schema.Option(WorldSelection) }, {
    modelToDependencies: model => ({ selection: model.selection }),
    dependenciesToStream: ({ selection }) =>
      Option.match(selection, { onNone: () => Stream.empty, onSome: watchWorld }),
  }),
}));
export const initialModel = (
  desks: number,
  camera = Option.none<Camera>(),
  selection = Option.none<WorldSelection>(),
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
  world: Option.none(),
  worldConnection: "connecting",
  worldRevision: 0,
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

const SyncUrl = Command.define("SyncUrl", {
  args: { camera: Camera, push: Schema.Boolean },
  messages: [Message.CompletedUrl, Message.FailedMap],
  execute: ({ camera, push }) =>
    Effect.try({
      try: () => {
        const url = new URL(location.href);
        url.searchParams.set("x", String(camera.x));
        url.searchParams.set("z", String(camera.z));
        url.searchParams.set("extent", String(camera.extent));
        url.searchParams.set("rotation", String(camera.rotation));
        if (push) history.pushState({}, "", url);
        else history.replaceState({}, "", url);
        return Message.CompletedUrl();
      },
      catch: cause => Message.FailedMap({ reason: String(cause) }),
    }).pipe(Effect.catch(Effect.succeed)),
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
    ReceivedWorldSnapshot: ({ snapshot }) => {
      const desks = deskCapacity(snapshot);
      const worldRevision = model.worldRevision + 1;
      const remount = Option.isNone(model.world) || desks !== model.desks;
      const next = modifyFields(model, {
        desks: () => desks,
        world: () => Option.some(snapshot),
        worldRevision: () => worldRevision,
        generation: value => remount ? 0 : value,
        status: status =>
          snapshot.model.floors.length > 2
            ? Model.fields.status.members[2].make({
              reason: "Viewing more than one occupied floor is not yet available.",
            })
            : desks > 4085
            ? Model.fields.status.members[2].make({ reason: "This world exceeds the viewer's 4,085-desk capacity." })
            : remount
            ? Model.fields.status.members[0].make({})
            : status,
      });
      return {
        model: next,
        commands: !remount && next.status._tag === "Ready"
          ? [ApplyWorld({ snapshot, revision: worldRevision, generation: model.generation })]
          : [],
      };
    },
    ChangedWorldConnection: ({ connection }) => ({
      model: modifyFields(model, { worldConnection: () => connection }),
    }),
    AppliedWorldSnapshot: () => ({ model }),
    CompletedPresent: () => ({ model }),
    CompletedFlight: () => ({ model }),
    CompletedUrl: () => ({ model }),
  });

export const makeView = (commands: MapCommands["Service"]) => {
  const MountMap = makeMountMap(commands);
  return defineView<Model, Message>((model, h) => {
    const desks = Option.match(model.world, { onNone: () => [], onSome: worldDesks });
    const selectedAgent = Option.flatMap(
      model.selected,
      id =>
        Option.flatMap(
          Option.fromUndefinedOr(desks.find(desk => desk.id === id)),
          desk =>
            Option.flatMap(model.world, world =>
              Option.fromUndefinedOr(world.agents.find(agent => agent.agent === desk.agent))),
        ),
    );
    const canMount = Option.isNone(model.selection)
      || Option.exists(model.world, world => world.model.floors.length <= 2);
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
            initialSnapshot: Option.map(model.world, snapshot => rendererSnapshot(snapshot, model.worldRevision)),
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
        ...desks.map(desk =>
          h.button([
            h.AriaLabel(`Open desk for ${desk.agent}`),
            h.DataAttribute(
              "agent-state",
              Option.getOrElse(
                Option.flatMap(model.world, world =>
                  Option.flatMap(
                    Option.fromUndefinedOr(world.agents.find(agent => agent.agent === desk.agent)),
                    agent => agent.state,
                  )),
                () => "unreported",
              ),
            ),
            h.OnClick(Message.SelectedEntity({ entity: Option.some(desk.id) })),
          ], [desk.agent])
        ),
      ]),
      Option.match(selectedAgent, { onNone: () => h.empty, onSome: agent => deskDrawer(agent, h) }),
    ]);
  });
};
