import { Effect, Option, Schema } from "effect";
import { Command, type Update } from "foldkit";
import { modifyFields } from "foldkit/struct";
import { defineView } from "foldkit/submodel";
import { makeMountMap, MapCommands } from "./_lib/renderer/service";
import { Message } from "./message";
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
});
export type Model = typeof Model.Type;
export const initialModel = (desks: number, camera = Option.none<Camera>()): Model => ({
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
    SucceededMountMap: ({ generation }) => ({
      model: modifyFields(model, {
        generation: () => generation,
        status: () => Model.fields.status.members[1].make({}),
      }),
      commands: [SyncUrl({ camera: model.presentation.camera, push: false })],
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
    CompletedPresent: () => ({ model }),
    CompletedFlight: () => ({ model }),
    CompletedUrl: () => ({ model }),
  });

export const makeView = (commands: MapCommands["Service"]) => {
  const MountMap = makeMountMap(commands);
  return defineView<Model, Message>((model, h) =>
    h.section([h.Class("map-shell"), h.AriaLabel("Trading floor")], [
      h.p([h.Class("synthetic-label")], ["Synthetic desk scene — unapproved geometry and palette."]),
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
      h.div([
        h.Id("map"),
        h.Class("map"),
        h.OnMount(MountMap({ initialPresentation: model.presentation, initialDesks: model.desks })),
      ]),
      h.p([], [
        model.status._tag === "Failed"
          ? model.status.reason
          : model.status._tag === "Ready"
          ? "Synthetic desks"
          : "Preparing synthetic desks…",
      ]),
    ])
  );
};
