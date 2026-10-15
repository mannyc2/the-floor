import { Effect, Option, SubscriptionRef } from "effect";
import type { DevToolsStore } from "foldkit/devtools-host";
import { createLedger } from "../src/map/_lib/renderer/engine";
import type { MapCommands } from "../src/map/_lib/renderer/service";
import type { Camera, Presentation } from "../src/map/model";
import { diagnostics } from "./probes";
import { partialAcquisitionProbe, reconciliationProbe } from "./reconciliation-probe";
import { replayProbe } from "./replay-probe";
import { WorkbenchFailure } from "./runtime";
import { digestBytes, SceneDigest } from "./scene-evidence";

export type RunWorkbench = <A, E>(effect: Effect.Effect<A, E, SceneDigest | MapCommands>) => Promise<A>;

export const makeWorkbenchApi = (
  commands: MapCommands["Service"],
  store: () => DevToolsStore,
  run: RunWorkbench,
) => {
  const current = () =>
    Option.getOrThrowWith(
      commands.inspect(),
      () => new WorkbenchFailure({ operation: "current-renderer", cause: "Map is not mounted" }),
    );
  const hash = () => run(digestBytes(current().engine.frameBytes()));
  const entries = () =>
    Effect.runSync(SubscriptionRef.get(store().stateRef)).entries
      .map((entry, index) => ({ tag: entry.tag, index }));
  return {
    inspect: () => ({ ...current().engine.inspect(), ...current().camera.inspect(), generation: current().generation }),
    ledger: () => structuredClone(Option.getOrElse(commands.inspectLedger(), createLedger)),
    draw: () => current().engine.draw(true),
    hash,
    frame: () => Array.from(current().engine.frameBytes()),
    png: () => current().engine.canvas.toDataURL(),
    mask: (value: boolean) => current().engine.setMask(value),
    project: (x: number, y: number, z: number) => current().engine.project(x, y, z),
    ground: (x: number, y: number) => current().engine.groundAt(x, y),
    pick: (x: number, y: number) => current().engine.pick(x, y),
    pickAsync: (x: number, y: number) => run(current().engine.pickAsync(x, y)),
    oracle: (x: number, y: number) => diagnostics(current().engine).oracle(x, y),
    setCamera: (view: Camera) => {
      current().engine.setCamera(view);
      current().engine.draw();
    },
    present: (presentation: Presentation) => run(current().service.present(presentation)),
    palette: (entity: number, name: string) => current().engine.setPaletteSlot(entity, name),
    injectRetirementFailure: () =>
      current().engine.onDispose(() => {
        // The real engine still retires every owned resource before aggregating
        // this injected finalizer failure into the host's quarantine decision.
        // oxlint-disable-next-line effect/noThrowStatement -- This probe deliberately throws from a synchronous foreign finalizer through the real renderer retirement path.
        throw new WorkbenchFailure({ operation: "injected-retirement", cause: "Deliberate failed-release regression" });
      }),
    injectResizeFailure: () => {
      const element = Option.getOrThrowWith(
        Option.fromNullishOr(current().engine.canvas.parentElement),
        () => new WorkbenchFailure({ operation: "resize-host", cause: "Canvas has no host" }),
      );
      const width = element.clientWidth;
      const previous = element.style.width;
      Object.defineProperty(element, "clientWidth", {
        configurable: true,
        get: () => {
          Reflect.deleteProperty(element, "clientWidth");
          element.style.width = previous;
          // oxlint-disable-next-line effect/noThrowStatement -- This one-shot DOM getter fails inside the real ResizeObserver callback to verify host poisoning and recovery by remount.
          throw new WorkbenchFailure({ operation: "injected-resize", cause: "Deliberate native callback regression" });
        },
      });
      element.style.width = `${width - 1}px`;
    },
    lose: () => current().engine.loseContext(),
    restore: () => current().engine.restoreContext(),
    line: () => run(diagnostics(current().engine).line()),
    picking: (count: number) => diagnostics(current().engine).picking(count),
    reconcile: () => run(reconciliationProbe(current().engine)),
    partialAcquisition: () => run(partialAcquisitionProbe()),
    replay: () => run(replayProbe(store(), entries, hash, () => current().engine.inspect())),
    entries,
    jump: (index: number) => run(store().jumpTo(index).pipe(Effect.asVoid)),
    resume: () => run(store().resume),
  };
};

declare global {
  interface Window {
    floorTest: ReturnType<typeof makeWorkbenchApi>;
  }
}
