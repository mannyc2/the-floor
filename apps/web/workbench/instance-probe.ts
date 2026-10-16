import { Effect, Option } from "effect";
import { openEngine } from "../src/map/_lib/renderer/engine";
import type { Engine } from "./renderer-probe";
import { WorkbenchFailure } from "./runtime";

export const instanceMemoryProbe = Effect.fn("Workbench.instanceMemory")(function*(engine: Engine) {
  const baseline = engine.inspect();
  const initial = engine.instancePositions();
  const revision = baseline.snapshotRevision + 1;
  for (let index = 0; index < 256; index++) {
    yield* engine.snapshot({
      revision: revision + index,
      instances: initial.filter((_instance, offset) => (offset + index) % 4 !== 0).map(instance => ({
        id: instance.id,
        x: instance.target.x + (index % 3),
        y: instance.target.y,
        z: instance.target.z,
      })),
    });
    engine.draw(true);
  }
  yield* engine.snapshot({
    revision: revision + 256,
    instances: initial.map(instance => ({ id: instance.id, ...instance.target })),
  });
  engine.draw(true);
  return { steps: 257, baseline, after: engine.inspect() };
});
export const partialAcquisitionProbe = Effect.fn("Workbench.partialAcquisition")(function*() {
  const before = window.floorNativeProbes.ledger();
  const host = yield* Effect.acquireRelease(
    Effect.sync(() => {
      const element = document.createElement("div");
      element.style.cssText = "position:fixed;width:64px;height:64px;left:-100px";
      document.body.append(element);
      return element;
    }),
    element => Effect.sync(() => element.remove()),
  );
  const caught = yield* Effect.scoped(openEngine(
    host,
    12,
    {
      revision: 1,
      theme: "day",
      camera: { x: 0, z: 0, extent: -1, rotation: 0 },
      sampleTime: 0,
      playbackRate: 0,
      intervalStart: 0,
      previousValue: 0,
      nextValue: 0,
    },
    () => 0,
    {
      preserveDrawingBuffer: true,
      initialSnapshot: Option.none(),
      active: () => true,
      failed: error => {
        // oxlint-disable-next-line effect/noThrowStatement -- The acquisition probe routes any unexpected asynchronous failure into the test error boundary.
        throw new WorkbenchFailure({ operation: "partial-acquisition", cause: error });
      },
    },
  )).pipe(Effect.matchCause({ onFailure: () => true, onSuccess: () => false }));
  return { before, after: window.floorNativeProbes.ledger(), caught };
}, Effect.scoped);
