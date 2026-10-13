import { Effect, Option } from "effect";
import * as THREE from "three";
import { createLedger, type Engine, openEngine } from "../src/map/_lib/renderer/engine";
import { tokenColor } from "../src/map/_lib/renderer/scene";
import { makeTransactionalHost } from "../src/map/_lib/transactional-host";
import type { Snapshot } from "../src/map/model";
import { WorkbenchFailure } from "./runtime";

export const reconciliationProbe = Effect.fn("Workbench.reconciliation")(function*(engine: Engine) {
  const baseline = engine.inspect();
  const counts = { created: 0, disposed: 0, rendered: 0 };
  yield* Effect.scoped(Effect.gen(function*() {
    const target = yield* Effect.acquireRelease(
      Effect.sync(() => new THREE.WebGLRenderTarget(128, 128)),
      (value) => Effect.sync(() => value.dispose()),
    );
    const scene = new THREE.Scene();
    const host = yield* makeTransactionalHost((marker) => {
      const geometry = marker.kind === "box" ? new THREE.BoxGeometry(1, 1, 1) : new THREE.SphereGeometry(.5, 8, 6);
      const material = new THREE.MeshBasicMaterial({ color: tokenColor("steel", "day") });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.frustumCulled = false;
      mesh.position.x = marker.x;
      scene.add(mesh);
      const token = ++counts.created;
      return {
        token,
        kind: marker.kind,
        read: () => mesh.position.x,
        write: (x: number) => {
          mesh.position.x = x;
        },
        dispose: () => {
          scene.remove(mesh);
          geometry.dispose();
          material.dispose();
          counts.disposed++;
        },
      };
    });
    yield* Effect.addFinalizer(() => host.close.pipe(Effect.orDie));
    const state = { seed: 1729 }, history: Array<Snapshot> = [];
    const random = () => {
      state.seed = (Math.imul(state.seed, 1664525) + 1013904223) >>> 0;
      return state.seed;
    };
    yield* Effect.forEach(
      Array.from({ length: 2000 }, (_, index) => index),
      Effect.fnUntraced(function*(index) {
        const count = random() % 20;
        const positions = Array.from({ length: count }, () => random() % 100);
        const kinds = Array.from({ length: count }, () => random() % 2 === 1 ? "box" : "sphere");
        const fresh: Snapshot = {
          revision: index,
          markers: positions.map((x, item) => ({
            id: String(item),
            x,
            kind: kinds[item] === "box" ? "box" : "sphere",
          })),
        };
        const old = index % 7 === 0 && history.length > 0
          ? Option.fromUndefinedOr(history[random() % history.length])
          : Option.none<Snapshot>();
        const next = Option.getOrElse(old, () => fresh);
        if (Option.isNone(old)) history.push(fresh);
        yield* host.apply(next);
        engine.renderDiagnostic(scene, target);
        counts.rendered++;
        if (engine.inspect().geometries !== baseline.geometries + next.markers.length) {
          return yield* new WorkbenchFailure({
            operation: "reconcile-resources",
            cause: `Ownership mismatch at ${index}`,
          });
        }
        const actual = yield* host.inspect;
        if (actual.resources.some((resource, item) => resource.x !== next.markers[item]?.x)) {
          return yield* new WorkbenchFailure({
            operation: "reconcile-transforms",
            cause: `Transform mismatch at ${index}`,
          });
        }
        return counts.rendered;
      }),
      { concurrency: 1 },
    );
  }));
  engine.draw(true);
  return {
    seed: 1729,
    steps: 2000,
    diagnosticTarget: { width: 128, height: 128 },
    baseline,
    after: engine.inspect(),
    ...counts,
  };
});

export const partialAcquisitionProbe = Effect.fn("Workbench.partialAcquisition")(function*() {
  const ledger = createLedger(), before = structuredClone(ledger);
  const host = yield* Effect.acquireRelease(
    Effect.sync(() => {
      const element = document.createElement("div");
      element.style.cssText = "position:fixed;width:64px;height:64px;left:-100px";
      document.body.append(element);
      return element;
    }),
    (element) => Effect.sync(() => element.remove()),
  );
  const caught = yield* Effect.try({
    try: () =>
      openEngine(host, 12, {
        revision: 1,
        theme: "day",
        camera: { x: 0, z: 0, extent: -1, rotation: 0 },
        sampleTime: 0,
        playbackRate: 0,
        intervalStart: 0,
        previousValue: 0,
        nextValue: 0,
      }, () =>
        0, ledger),
    catch: (cause) => new WorkbenchFailure({ operation: "partial-acquisition", cause }),
  }).pipe(Effect.match({
    onFailure: () => true,
    onSuccess: (engine) => {
      engine.dispose();
      return false;
    },
  }));
  return { before, after: structuredClone(ledger), caught };
}, Effect.scoped);
