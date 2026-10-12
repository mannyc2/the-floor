import { Effect, Option, Schema } from "effect";
import { Command, type Update } from "foldkit";
import { modifyFields } from "foldkit/struct";
import { defineView } from "foldkit/submodel";
import { makeMountMap, MapCommands } from "./_lib/renderer/service";
import { Message } from "./message";
import { Camera, EntityId, Presentation } from "./model";

export { MapCommands } from "./_lib/renderer/service";
export { Message } from "./message";
export const Model = Schema.Struct({
  presentation: Presentation,
  desks: Schema.Int,
  acquireDelay: Schema.Int,
  visible: Schema.Boolean,
  order: Schema.Array(Schema.String),
  status: Schema.String,
  generation: Schema.Int,
  applied: Schema.Int,
  selected: Schema.Option(EntityId),
  cameraCommits: Schema.Int,
});
export type Model = typeof Model.Type;
export const initialModel = (desks: number, acquireDelay = 0, camera = Option.none<Camera>()): Model => ({
  presentation: {
    revision: 1,
    theme: "day",
    camera: Option.getOrElse(camera, () => ({ x: 0, z: 0, extent: desks > 12 ? 380 : 21 })),
    sampleTime: 0,
    playbackRate: 0,
    previousValue: 0,
    nextValue: 0,
    intervalStart: 0,
  },
  desks,
  acquireDelay,
  visible: true,
  order: ["map", "anchor"],
  status: "opening",
  generation: 0,
  applied: 0,
  selected: Option.none(),
  cameraCommits: 0,
});

const Present = Command.define("Present", {
  args: { presentation: Presentation },
  messages: [Message.CompletedPresent, Message.FailedMap],
  execute: ({ presentation }) =>
    Effect.gen(function*() {
      const commands = yield* MapCommands;
      yield* commands.present(presentation);
      return Message.CompletedPresent();
    }).pipe(Effect.catch(error => Effect.succeed(Message.FailedMap({ reason: error.message })))),
});
const Fly = Command.define("Fly", {
  args: { camera: Camera, follow: Schema.Boolean },
  messages: [Message.CompletedFlight, Message.FailedMap],
  execute: ({ camera, follow }) =>
    Effect.gen(function*() {
      const commands = yield* MapCommands;
      yield* commands.fly(camera, follow);
      return Message.CompletedFlight();
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
        if (push) history.pushState({}, "", url);
        else history.replaceState({}, "", url);
        return Message.CompletedUrl();
      },
      catch: cause => Message.FailedMap({ reason: String(cause) }),
    }).pipe(Effect.catch(Effect.succeed)),
});
const display = (model: Model, presentation: Presentation): Update.Return<Model, Message, MapCommands> => ({
  model: modifyFields(model, { presentation: () => presentation }),
  commands: [Present({ presentation })],
});
export const update = (model: Model, message: Message) =>
  Message.match<Update.Return<Model, Message, MapCommands>>(message, {
    SucceededMountMap: ({ generation, renderer }) => ({
      model: modifyFields(model, { generation: () => generation, status: () => renderer }),
      commands: [SyncUrl({ camera: model.presentation.camera, push: false })],
    }),
    AppliedFrame: ({ generation, sequence }) => ({
      model: generation === model.generation ? modifyFields(model, { applied: () => sequence }) : model,
    }),
    SelectedEntity: ({ entity }) => ({ model: modifyFields(model, { selected: () => entity }) }),
    RestedCamera: ({ camera, history }) => ({
      model: modifyFields(model, {
        presentation: frame => modifyFields(frame, { camera: () => camera }),
        cameraCommits: n => n + 1,
      }),
      commands: [SyncUrl({ camera, push: history })],
    }),
    FailedMap: ({ reason }) => ({ model: modifyFields(model, { status: () => `failed: ${reason}` }) }),
    ClickedVisibility: () => ({ model: modifyFields(model, { visible: value => !value }) }),
    ClickedReorder: () => ({ model: modifyFields(model, { order: order => order.toReversed() }) }),
    ClickedTheme: () =>
      display(
        model,
        modifyFields(model.presentation, {
          theme: theme => theme === "day" ? "night" : "day",
          revision: n => n + 1,
        }),
      ),
    ClickedFrameA: () => display(model, initialModel(model.desks).presentation),
    ClickedFrameB: () =>
      display(
        model,
        modifyFields(model.presentation, {
          revision: () => 2,
          theme: () => "night",
          sampleTime: () => 250,
          nextValue: () => .6,
        }),
      ),
    ClickedFlight: () => ({ model, commands: [Fly({ camera: { x: 4, z: -4, extent: 12 }, follow: false })] }),
    ClickedFollow: () => ({ model, commands: [Fly({ camera: { x: -4, z: -3, extent: 12 }, follow: true })] }),
    CompletedPresent: () => ({ model }),
    CompletedFlight: () => ({ model }),
    CompletedUrl: () => ({ model }),
  });

// A native DOM attribute is the replay bridge: Foldkit's historical view carries
// the historical presentation without sending a Command to the live Model.
// oxlint-disable-next-line effecttsgo/schema-sync -- Foldkit view construction is synchronous and encodes an already Schema-owned Model into its replay attribute.
// @effect-diagnostics-next-line schemaSync:off -- Foldkit view construction cannot await the Schema encoder.
const encodeFrame = Schema.encodeSync(Schema.fromJsonString(Presentation));
export const makeView = (commands: MapCommands["Service"], diagnostics = false) => {
  const MountMap = makeMountMap(commands);
  return defineView<Model, Message>((model, h) =>
    h.section([h.Class("map-shell"), h.AriaLabel("Trading floor")], [
      h.p([h.Class("synthetic-label")], ["Synthetic desk scene — visual references await the owner's selection."]),
      ...model.order.filter(key => key !== "map" || model.visible).map(key =>
        key === "map"
          ? h.keyed("div")(key, [
            h.Id("map"),
            h.Class("map"),
            h.DataAttribute("frame", encodeFrame(model.presentation)),
            h.OnMount(
              MountMap({
                initialPresentation: model.presentation,
                initialDesks: model.desks,
                acquireDelay: model.acquireDelay,
              }),
            ),
          ])
          : h.keyed("div")(key, [h.Id("anchor")])
      ),
      diagnostics
        ? h.div([h.Id("controls")], [
          h.button([h.Id("visibility"), h.OnClick(Message.ClickedVisibility())], ["Mount / unmount"]),
          h.button([h.Id("reorder"), h.OnClick(Message.ClickedReorder())], ["Move keyed host"]),
          h.button([h.Id("theme"), h.OnClick(Message.ClickedTheme())], ["Theme"]),
          h.button([h.Id("frame-a"), h.OnClick(Message.ClickedFrameA())], ["A"]),
          h.button([h.Id("frame-b"), h.OnClick(Message.ClickedFrameB())], ["B"]),
          h.button([h.Id("fly"), h.OnClick(Message.ClickedFlight())], ["Fly"]),
          h.button([h.Id("follow"), h.OnClick(Message.ClickedFollow())], ["Follow"]),
        ])
        : h.empty,
      (diagnostics ? h.output : h.p)([
        h.Id("status"),
        h.DataAttribute("generation", String(model.generation)),
        h.DataAttribute("applied", String(model.applied)),
        h.DataAttribute("selection", Option.match(model.selected, { onNone: () => "", onSome: String })),
        h.DataAttribute("commits", String(model.cameraCommits)),
      ], [
        diagnostics || model.status.startsWith("failed:")
          ? model.status
          : model.generation > 0
          ? "Synthetic desks"
          : "Preparing synthetic desks…",
      ]),
    ])
  );
};
