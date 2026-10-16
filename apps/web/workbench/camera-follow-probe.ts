import { Clock, Effect, Option } from "effect";
import type { MapCommands } from "../src/map/_lib/renderer/service";
import { mountedProbe } from "./renderer-probe";
import { nextFrame, WorkbenchFailure } from "./runtime";

// This source observes the real reconciled instance, including its interpolation.
// Only the workbench supplies synthetic snapshots; the camera owns cancellation.
export const followInstance = Effect.fn("Workbench.followInstance")(function*(
  commands: MapCommands["Service"],
  entity: number,
) {
  const mounted = commands.inspect();
  if (Option.isNone(mounted)) {
    return yield* new WorkbenchFailure({ operation: "follow-instance", cause: "Map is not mounted" });
  }
  const { engine } = mountedProbe(mounted.value);
  const initial = engine.inspect().camera;
  const readTarget = () =>
    Option.map(
      Option.fromUndefinedOr(engine.instancePositions().find(instance => instance.id === entity && instance.visible)),
      position => ({ ...initial, x: position.x, z: position.z, extent: 12 }),
    );
  if (Option.isNone(readTarget())) {
    return yield* new WorkbenchFailure({ operation: "follow-instance", cause: `Visible instance ${entity} is absent` });
  }
  return yield* commands.followTarget(readTarget);
});

export const moveFollowInstance = Effect.fn("Workbench.moveFollowInstance")(function*(
  commands: MapCommands["Service"],
  entity: number,
  x: number,
  z: number,
) {
  const mounted = commands.inspect();
  if (Option.isNone(mounted)) {
    return yield* new WorkbenchFailure({ operation: "move-follow-instance", cause: "Map is not mounted" });
  }
  const engine = mountedProbe(mounted.value).engine;
  return yield* commands.snapshot({
    revision: engine.inspect().snapshotRevision + 1,
    instances: engine.instancePositions().filter(instance => instance.visible).map(instance => ({
      id: instance.id,
      x: instance.id === entity ? x : instance.target.x,
      y: instance.target.y,
      z: instance.id === entity ? z : instance.target.z,
    })),
  });
});

// Keep the narrow mid-flight regression inside one browser frame. Test-protocol
// round trips can outlast a flight; the separate cases still use real input.
export const interruptFollow = Effect.fn("Workbench.interruptFollow")(function*(
  commands: MapCommands["Service"],
  entity: number,
  input: "click" | "key",
  pointerId: number,
) {
  const mounted = commands.inspect();
  if (Option.isNone(mounted)) {
    return yield* new WorkbenchFailure({ operation: "interrupt-follow", cause: "Map is not mounted" });
  }
  const { engine, camera } = mountedProbe(mounted.value);
  const clock = yield* Clock.Clock;
  const now = () => Number(clock.monotonicTimeNanosUnsafe()) / 1e6;
  const initial = engine.inspect().camera;
  const start = now();
  yield* followInstance(commands, entity);
  while (engine.inspect().camera.x === initial.x && engine.inspect().camera.z === initial.z) yield* nextFrame;
  if (!camera.inspect().flying) {
    return yield* new WorkbenchFailure({
      operation: "interrupt-follow",
      cause: "First moving frame missed the flight",
    });
  }
  const beforeInput = engine.inspect().camera;
  const elapsedMs = now() - start;
  yield* Effect.try({
    try: () => {
      const canvas = engine.canvas;
      if (input === "key") canvas.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
      else {
        const bounds = canvas.getBoundingClientRect();
        const pointer = {
          pointerId,
          pointerType: "mouse",
          button: 0,
          clientX: bounds.left + bounds.width / 2,
          clientY: bounds.top + bounds.height / 2,
          bubbles: true,
        };
        canvas.dispatchEvent(new PointerEvent("pointerdown", { ...pointer, buttons: 1 }));
        canvas.dispatchEvent(new PointerEvent("pointerup", { ...pointer, buttons: 0 }));
      }
    },
    catch: cause => new WorkbenchFailure({ operation: "interrupt-follow-input", cause }),
  });
  return { input, initial, beforeInput, afterInput: engine.inspect().camera, elapsedMs, ...camera.inspect() };
}, Effect.timeout("5 seconds"));
