import { Clock, Effect, Exit, Option, Schema } from "effect";
import { Command, Port, Subscription, type Update } from "foldkit";
import type { DrawSample } from "../src/map/_lib/renderer/engine";
import { MapCommands } from "../src/map/_lib/renderer/service";
import { Model, update } from "../src/map/main";
import { Message } from "../src/map/message";
import { Camera, Presentation } from "../src/map/model";
import { WorkbenchFailure } from "./runtime";

const MovedComparisonCamera = Schema.TaggedStruct("MovedComparisonCamera", { camera: Camera });
export const ComparisonMessage = Schema.Union([Message, MovedComparisonCamera]);
export type ComparisonMessage = typeof ComparisonMessage.Type;
const ComparisonInput = Schema.Struct({ camera: Camera, phase: Schema.Literals(["move", "rest"]) });
export type ComparisonInput = typeof ComparisonInput.Type;
export const comparisonPorts = { inbound: { comparisonCamera: Port.inbound(ComparisonInput) } };
export const comparisonSubscriptions = Subscription.make<Model, ComparisonMessage>()(() => ({
  camera: Port.subscriptionEntry(comparisonPorts.inbound.comparisonCamera, input =>
    input.phase === "move"
      ? MovedComparisonCamera.make({ camera: input.camera })
      : Message.RestedCamera({ camera: input.camera, history: false })),
}));
const PresentComparisonCamera = Command.define("PresentComparisonCamera", {
  args: { presentation: Presentation },
  messages: [Message.CompletedPresent, Message.FailedMap],
  execute: ({ presentation }) =>
    Effect.gen(function*() {
      const commands = yield* MapCommands;
      yield* commands.present(presentation);
      return Message.CompletedPresent();
    }).pipe(Effect.catch(error => Effect.succeed(Message.FailedMap({ reason: error.message })))),
});

type Mode = "local" | "model";
interface Sample {
  readonly index: number;
  readonly receivedMs: number;
  readonly expected: Camera;
  readonly drawsBefore: number;
  observedMs: Option.Option<number>;
  observedDraws: Option.Option<number>;
  coalesced: boolean;
}
const equalCamera = (left: Camera, right: Camera) =>
  Math.abs(left.x - right.x) < 1e-9 && Math.abs(left.z - right.z) < 1e-9
  && left.extent === right.extent && left.rotation === right.rotation;

// The alternative lives entirely in the workbench. Its Port reaches this
// application's real Foldkit Model, then the normal renderer presentation pump.
export const makeCameraComparison = Effect.fn("Workbench.cameraComparison")(
  function*(
    commands: MapCommands["Service"],
    send: (input: ComparisonInput) => Exit.Exit<void, Schema.SchemaError>,
  ) {
    const clock = yield* Clock.Clock;
    const now = () => Number(clock.monotonicTimeNanosUnsafe()) / 1e6;
    const state = {
      mode: Option.none<Mode>(),
      samples: new Array<Sample>(),
      modelUpdates: 0,
      pending: Option.none<Sample>(),
      anchor: Option.none<{ readonly x: number; readonly z: number }>(),
      cleanup: () => {},
      failure: Option.none<string>(),
    };
    const current = () =>
      Option.getOrThrowWith(
        commands.inspect(),
        () => new WorkbenchFailure({ operation: "camera-comparison", cause: "Map is not mounted" }),
      );
    const observe = (rendered: DrawSample) => {
      if (
        Option.isSome(state.pending) && rendered.draw > state.pending.value.drawsBefore
        && equalCamera(rendered.camera, state.pending.value.expected)
      ) {
        state.pending.value.observedMs = Option.some(rendered.atMs);
        state.pending.value.observedDraws = Option.some(rendered.draw);
        state.pending = Option.none();
      }
    };
    const deliver = (input: ComparisonInput) => {
      const result = send(input);
      if (Exit.isFailure(result)) state.failure = Option.some("Comparison Port rejected its camera");
    };
    const stop = () => {
      state.cleanup();
      state.cleanup = () => {};
      state.anchor = Option.none();
      state.mode = Option.none();
    };
    yield* Effect.addFinalizer(() => Effect.sync(stop));
    const start = (mode: Mode) => {
      stop();
      state.samples = [];
      state.modelUpdates = 0;
      state.pending = Option.none();
      state.failure = Option.none();
      state.mode = Option.some(mode);
      const { engine } = current();
      const canvas = engine.canvas;
      // A failed assertion may unmount before finish is called. The renderer's
      // retirement must also retire this observer of its canvas and frames.
      engine.onDispose(stop);
      const removeDrawObserver = engine.observeDraws(observe);
      const local = (event: PointerEvent) => {
        const bounds = canvas.getBoundingClientRect();
        return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
      };
      const intercept = (event: PointerEvent) => {
        if (mode === "model") {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      };
      const down = (event: PointerEvent) => {
        if (event.button !== 0) return;
        const point = local(event);
        state.anchor = Option.some(engine.groundAt(point.x, point.y));
        if (mode === "model") canvas.setPointerCapture(event.pointerId);
        intercept(event);
      };
      const move = (event: PointerEvent) => {
        if (Option.isNone(state.anchor)) return;
        const receivedMs = now();
        const point = local(event);
        const under = engine.groundAt(point.x, point.y);
        const rendered = engine.inspect();
        const before = rendered.camera;
        const expected = {
          ...before,
          x: before.x + state.anchor.value.x - under.x,
          z: before.z + state.anchor.value.z - under.z,
        };
        if (Option.isSome(state.pending)) state.pending.value.coalesced = true;
        const sample: Sample = {
          index: state.samples.length,
          receivedMs,
          expected,
          drawsBefore: rendered.draws,
          observedMs: Option.none(),
          observedDraws: Option.none(),
          coalesced: false,
        };
        state.samples.push(sample);
        state.pending = Option.some(sample);
        if (mode === "model") deliver({ camera: expected, phase: "move" });
        intercept(event);
      };
      const up = (event: PointerEvent) => {
        if (Option.isNone(state.anchor)) return;
        state.anchor = Option.none();
        if (mode === "model") {
          if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
          deliver({ camera: engine.inspect().camera, phase: "rest" });
        }
        intercept(event);
      };
      canvas.addEventListener("pointerdown", down, true);
      canvas.addEventListener("pointermove", move, true);
      canvas.addEventListener("pointerup", up, true);
      canvas.addEventListener("pointercancel", up, true);
      state.cleanup = () => {
        removeDrawObserver();
        canvas.removeEventListener("pointerdown", down, true);
        canvas.removeEventListener("pointermove", move, true);
        canvas.removeEventListener("pointerup", up, true);
        canvas.removeEventListener("pointercancel", up, true);
      };
    };
    const inspect = () => ({
      mode: Option.getOrNull(state.mode),
      modelUpdates: state.modelUpdates,
      pending: Option.isSome(state.pending),
      failure: Option.getOrNull(state.failure),
      samples: state.samples.map(sample => ({
        index: sample.index,
        expected: sample.expected,
        drawsBefore: sample.drawsBefore,
        observedDraws: Option.getOrNull(sample.observedDraws),
        receivedMs: sample.receivedMs,
        observedMs: Option.getOrNull(sample.observedMs),
        latencyMs: Option.getOrNull(Option.map(sample.observedMs, observedMs => observedMs - sample.receivedMs)),
        coalesced: sample.coalesced,
      })),
    });
    return {
      start,
      inspect,
      finish: () => {
        const result = inspect();
        stop();
        return result;
      },
      update: (model: Model, message: ComparisonMessage): Update.Return<Model, ComparisonMessage, MapCommands> => {
        if (message._tag !== "MovedComparisonCamera") return update(model, message);
        state.modelUpdates++;
        const presentation = { ...model.presentation, camera: message.camera };
        return {
          model: { ...model, presentation },
          commands: [PresentComparisonCamera({ presentation })],
        };
      },
    };
  },
);
export type CameraComparison = Effect.Success<ReturnType<typeof makeCameraComparison>>;
