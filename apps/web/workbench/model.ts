import { Effect, Option, Queue, Schema, Stream } from "effect";
import { Command, Mount, type Update } from "foldkit";
import { defineMessageUnion } from "foldkit/message";
import { defineView } from "foldkit/submodel";
import { MapCommands } from "../src/map/_lib/renderer/service";
import * as Map from "../src/map/main";
import { Message as MapMessage } from "../src/map/message";
import { Camera, fault, Presentation } from "../src/map/model";

export const Controls = defineMessageUnion({
  ClickedVisibility: {},
  ClickedReorder: {},
  ClickedTheme: {},
  ClickedFrameA: {},
  ClickedFrameB: {},
  ClickedFlight: {},
  ClickedFollow: {},
});
export const Message = Schema.Union([MapMessage, Controls]);
export type Message = typeof Message.Type;
type MountMessage =
  | typeof MapMessage.SucceededMountMap.Type
  | typeof MapMessage.FailedMap.Type
  | typeof MapMessage.AppliedFrame.Type
  | typeof MapMessage.SelectedEntity.Type
  | typeof MapMessage.RestedCamera.Type;
export const Model = Schema.Struct({
  ...Map.Model.fields,
  acquireDelay: Schema.Int,
  visible: Schema.Boolean,
  order: Schema.Array(Schema.String),
  applied: Schema.Int,
  cameraCommits: Schema.Int,
  renderer: Schema.String,
});
export type Model = typeof Model.Type;
export const initialModel = (desks: number, acquireDelay: number, camera: Option.Option<Camera>): Model => ({
  ...Map.initialModel(desks, camera),
  acquireDelay,
  visible: true,
  order: ["map", "anchor"],
  applied: 0,
  cameraCommits: 0,
  renderer: "opening",
});
const Present = Command.define("Present", {
  args: { presentation: Presentation },
  messages: [MapMessage.CompletedPresent, MapMessage.FailedMap],
  execute: ({ presentation }) =>
    Effect.gen(function*() {
      const commands = yield* MapCommands;
      yield* commands.present(presentation, false, true);
      return MapMessage.CompletedPresent();
    }).pipe(Effect.catch(error => Effect.succeed(MapMessage.FailedMap({ reason: error.message })))),
});
const Fly = Command.define("Fly", {
  args: { camera: Camera, follow: Schema.Boolean },
  messages: [MapMessage.CompletedFlight, MapMessage.FailedMap],
  execute: ({ camera, follow }) =>
    Effect.gen(function*() {
      const commands = yield* MapCommands;
      yield* commands.fly(camera, follow);
      return MapMessage.CompletedFlight();
    }).pipe(Effect.catch(error => Effect.succeed(MapMessage.FailedMap({ reason: error.message })))),
});
const display = (model: Model, presentation: Presentation): Update.Return<Model, Message, MapCommands> => ({
  model: { ...model, presentation },
  commands: [Present({ presentation })],
});
export const update = (model: Model, message: Message): Update.Return<Model, Message, MapCommands> => {
  if (Schema.is(MapMessage)(message)) {
    const result = Map.update(model, message);
    return {
      ...result,
      model: {
        ...model,
        ...result.model,
        renderer: message._tag === "SucceededMountMap" ? message.renderer : model.renderer,
        applied: message._tag === "AppliedFrame" && message.generation === model.generation
          ? message.sequence
          : model.applied,
        cameraCommits: model.cameraCommits + (message._tag === "RestedCamera" ? 1 : 0),
      },
    };
  }
  return Controls.match<Update.Return<Model, Message, MapCommands>>(message, {
    ClickedVisibility: () => ({ model: { ...model, visible: !model.visible } }),
    ClickedReorder: () => ({ model: { ...model, order: model.order.toReversed() } }),
    ClickedTheme: () =>
      display(model, {
        ...model.presentation,
        theme: model.presentation.theme === "day" ? "night" : "day",
        revision: model.presentation.revision + 1,
      }),
    ClickedFrameA: () =>
      display(model, { ...Map.initialModel(model.desks).presentation, camera: model.presentation.camera }),
    ClickedFrameB: () =>
      display(model, { ...model.presentation, revision: 2, theme: "night", sampleTime: 250, nextValue: .6 }),
    ClickedFlight: () => ({
      model,
      commands: [Fly({ camera: { ...model.presentation.camera, x: 4, z: -4, extent: 12 }, follow: false })],
    }),
    ClickedFollow: () => ({
      model,
      commands: [Fly({ camera: { ...model.presentation.camera, x: -4, z: -3, extent: 12 }, follow: true })],
    }),
  });
};

// The historical workbench view carries its presentation without mutating the live Model.
// @effect-diagnostics-next-line schemaSync:off -- Foldkit view construction cannot await an encoder.
const encodeFrame = Schema.encodeSync(Schema.fromJsonString(Presentation));
export const makeView = (commands: MapCommands["Service"], controls: boolean) => {
  const MountMap = Mount.defineStream("MountMap", {
    args: { initialPresentation: Presentation, initialDesks: Schema.Int, acquireDelay: Schema.Int },
    messages: [
      MapMessage.SucceededMountMap,
      MapMessage.FailedMap,
      MapMessage.AppliedFrame,
      MapMessage.SelectedEntity,
      MapMessage.RestedCamera,
    ],
    execute: ({ element, initialPresentation, initialDesks, acquireDelay, viewStateChanges }) =>
      Stream.callback<MountMessage>(queue =>
        Effect.gen(function*() {
          if (!(element instanceof HTMLElement)) return yield* fault("host", "Expected an HTMLElement");
          // Delayed acquisition is a cancellation probe, not production mount policy.
          yield* Effect.sleep(acquireDelay);
          yield* commands.mount({
            element,
            desks: initialDesks,
            initial: initialPresentation,
            initialSnapshot: Option.none(),
            queue,
            viewStateChanges,
          });
          return yield* Effect.never;
        }).pipe(Effect.catch(error =>
          Effect.sync(() => {
            Queue.offerUnsafe(queue, MapMessage.FailedMap({ reason: error.message }));
          })
        )), { bufferSize: 32, strategy: "sliding" }),
  });
  return defineView<Model, Message>((model, h) =>
    h.section([h.Class("map-shell"), h.AriaLabel("Trading floor")], [
      h.p([h.Class("synthetic-label")], ["Synthetic desk scene — unapproved geometry and palette."]),
      h.div([h.Class("camera-rotation"), h.AriaLabel("Camera rotation")], [
        h.button([
          h.Id("rotate-left"),
          h.Disabled(model.generation === 0 || !model.visible),
          h.OnClick(MapMessage.ClickedRotate({ direction: "left" })),
        ], ["Rotate left"]),
        h.button([
          h.Id("rotate-right"),
          h.Disabled(model.generation === 0 || !model.visible),
          h.OnClick(MapMessage.ClickedRotate({ direction: "right" })),
        ], ["Rotate right"]),
      ]),
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
      controls
        ? h.div([h.Id("controls")], [
          h.button([h.Id("visibility"), h.OnClick(Controls.ClickedVisibility())], ["Mount / unmount"]),
          h.button([h.Id("reorder"), h.OnClick(Controls.ClickedReorder())], ["Move keyed host"]),
          h.button([h.Id("theme"), h.OnClick(Controls.ClickedTheme())], ["Theme"]),
          h.button([h.Id("frame-a"), h.OnClick(Controls.ClickedFrameA())], ["A"]),
          h.button([h.Id("frame-b"), h.OnClick(Controls.ClickedFrameB())], ["B"]),
          h.button([h.Id("fly"), h.OnClick(Controls.ClickedFlight())], ["Fly"]),
          h.button([h.Id("follow"), h.OnClick(Controls.ClickedFollow())], ["Follow"]),
        ])
        : h.empty,
      h.output([
        h.Id("status"),
        h.DataAttribute("generation", String(model.generation)),
        h.DataAttribute("applied", String(model.applied)),
        h.DataAttribute("selection", Option.match(model.selected, { onNone: () => "", onSome: String })),
        h.DataAttribute("commits", String(model.cameraCommits)),
      ], [model.status._tag === "Failed" ? `failed: ${model.status.reason}` : model.renderer]),
    ])
  );
};
