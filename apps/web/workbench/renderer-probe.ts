import { Effect, Option, Schema, Scope } from "effect";
import * as THREE from "three";
import type { Engine as RendererEngine } from "../src/map/_lib/renderer/engine";
import type { Palette } from "../src/map/_lib/renderer/palette";
import { slot } from "../src/map/_lib/renderer/scene";
import type { Mounted as RendererMounted } from "../src/map/_lib/renderer/service";
import type { Camera } from "../src/map/model";
import { WorkbenchFailure } from "./runtime";

export interface DrawSample {
  readonly atMs: number;
  readonly camera: Camera;
  readonly draw: number;
}
export interface RendererFrame {
  readonly atMs: number;
  readonly cpuMs: number;
  readonly snapshotCpuMs: number;
  readonly pumpCpuMs: number;
  readonly betweenPumpDrawCpuMs: number;
  readonly snapshots: number;
  readonly revision: number;
  readonly draws: number;
  readonly uploadCalls: number;
  readonly uploadBytes: number;
}
const makeEngineProbe = (engine: RendererEngine) => {
  const {
    renderer,
    data,
    camera,
    sceneTarget,
    palette,
    paletteBytes,
    colorDecodeBytes,
    surfaceUniforms,
    screenUniforms,
    state,
    instances,
    now,
    scope,
  } = engine.internals;
  const { canvas } = engine.camera;
  const gl = renderer.getContext();
  const measured = {
    draws: renderer.info.render.calls > 0 ? 1 : 0,
    cumulativeDrawCpuMs: 0,
    uploadBytes: 0,
    uploadCalls: 0,
    cumulativeUploadCalls: 0,
    cumulativeUploadArrayBytes: 0,
  };
  const observers = new Set<(sample: DrawSample) => void>();
  const draw = engine.internals.drawing.draw;
  engine.internals.drawing.draw = force => {
    const started = now();
    measured.uploadBytes = 0;
    measured.uploadCalls = 0;
    const result = draw(force);
    const ended = now();
    if (result.drawn) {
      measured.draws++;
      measured.cumulativeDrawCpuMs += ended - started;
      observers.forEach(observe => observe({ atMs: ended, camera: engine.camera.read(), draw: measured.draws }));
    }
    return result;
  };
  const dispose = renderer.dispose.bind(renderer);
  renderer.dispose = () => {
    dispose();
    window.floorNativeProbes.memory(gl, {
      geometries: renderer.info.memory.geometries,
      textures: renderer.info.memory.textures,
    });
  };
  const observeAttribute = (attribute: THREE.BufferAttribute) =>
    attribute.onUpload(() => {
      measured.uploadCalls++;
      measured.uploadBytes += attribute.array.byteLength;
      measured.cumulativeUploadCalls++;
      measured.cumulativeUploadArrayBytes += attribute.array.byteLength;
    });
  data.geometries.forEach(geometry =>
    Object.values(geometry.attributes).forEach(attribute => {
      if (attribute instanceof THREE.BufferAttribute) observeAttribute(attribute);
    })
  );
  data.meshes.forEach(mesh => {
    if (mesh instanceof THREE.InstancedMesh) {
      observeAttribute(mesh.instanceMatrix);
      if (mesh.instanceColor) observeAttribute(mesh.instanceColor);
    }
  });
  const extension = gl.getExtension("WEBGL_debug_renderer_info");
  const rendererName = Schema.decodeUnknownOption(Schema.String)(
    extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
  );
  const inspect = () => ({
    renderer: Option.getOrElse(rendererName, () => "unreported"),
    webgl2: renderer.capabilities.isWebGL2,
    width: state.width,
    height: state.height,
    dpr: state.dpr,
    ...measured,
    camera: engine.camera.read(),
    cutaway: data.boundaries.map(boundary => ({
      name: boundary.name,
      id: boundary.id,
      visible: boundary.mesh.visible && boundary.mesh.layers.test(camera.layers),
    })),
    theme: state.theme,
    revision: state.revision,
    geometries: renderer.info.memory.geometries,
    textures: renderer.info.memory.textures,
    programs: renderer.info.programs?.length ?? 0,
    calls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
    targetBytes: canvas.width * canvas.height * 12,
    lineBufferBytes: 0,
    paletteBytes: paletteBytes.byteLength,
    transferBytes: colorDecodeBytes.byteLength,
    bufferUploads: window.floorNativeProbes.uploads(gl),
    lost: gl.isContextLost(),
    interpolation: surfaceUniforms.interpolation.value,
    instanceInterpolation: instances.interpolation.value,
    snapshotRevision: instances.revision(),
    entityCount: data.entities.length,
    desks: engine.internals.desks,
  });
  const onDispose = (finalizer: () => void) => Effect.runSync(Scope.addFinalizer(scope, Effect.sync(finalizer)));
  return {
    canvas,
    inspect,
    draw: (force = false) => {
      const started = now();
      const result = engine.draw(force);
      return { ...result, cpuMs: now() - started };
    },
    observeDraws: (observe: (sample: DrawSample) => void) => {
      observers.add(observe);
      return () => {
        observers.delete(observe);
      };
    },
    advance: engine.internals.advance,
    snapshot: instances.snapshot,
    instancePositions: instances.positions,
    setCamera: engine.camera.set,
    setPalette: (selection: Palette) => {
      state.palette = selection;
      engine.internals.writePaletteBytes(selection);
      palette.needsUpdate = true;
      engine.internals.setTheme(state.theme);
    },
    groundAt: engine.camera.groundAt,
    project: engine.camera.project,
    apply: engine.apply,
    pick: engine.pick,
    pickAsync: (x: number, y: number) =>
      Effect.suspend(() => {
        if (x < 0 || x >= state.width || y < 0 || y >= state.height || gl.isContextLost()) return Effect.succeed(0);
        engine.draw();
        const bytes = new Uint8Array(4);
        return Effect.tryPromise({
          try: () =>
            renderer.readRenderTargetPixelsAsync(
              sceneTarget,
              Math.max(0, Math.min(canvas.width - 1, Math.floor(x * state.dpr))),
              Math.max(0, Math.min(canvas.height - 1, canvas.height - 1 - Math.floor(y * state.dpr))),
              1,
              1,
              bytes,
              0,
              1,
            ),
          catch: cause => new WorkbenchFailure({ operation: "async-pick", cause }),
        }).pipe(
          Effect.map(() => Math.floor(((bytes[0] ?? 0) + (bytes[1] ?? 0) * 256 + (bytes[2] ?? 0) * 65536) / 4096)),
        );
      }),
    frameBytes: () => {
      engine.draw();
      const bytes = new Uint8Array(canvas.width * canvas.height * 4);
      gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
      return bytes;
    },
    diagnosticScene: () => ({ ...data, camera }),
    onDispose,
    renderDiagnostic: (scene: THREE.Scene, target: THREE.WebGLRenderTarget) => {
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      state.dirty = true;
    },
    setMask: (mask: boolean) => {
      screenUniforms.mask.value = mask ? 1 : 0;
      state.dirty = true;
      engine.draw();
    },
    setPaletteSlot: (entity: number, name: string) => {
      const selected = Option.getOrThrowWith(
        slot(name),
        () => new WorkbenchFailure({ operation: "palette-slot", cause: name }),
      );
      engine.internals.writeAttribute("_PALETTE", selected, entity);
      state.dirty = true;
    },
    finishFrame: () => gl.finish(),
    loseContext: () => renderer.forceContextLoss(),
    restoreContext: () => renderer.forceContextRestore(),
  };
};
export type Engine = ReturnType<typeof makeEngineProbe>;
const instrument = (mounted: RendererMounted) => {
  const engine = makeEngineProbe(mounted.engine);
  const observers = new Set<(sample: RendererFrame) => void>();
  let previous = engine.inspect();
  const counts = { snapshots: 0, snapshotCpuMs: 0, pointerEvents: 0 };
  const now = mounted.engine.internals.now;
  const snapshot = mounted.service.snapshot;
  mounted.service.snapshot = input =>
    Effect.suspend(() => {
      const started = now();
      return snapshot(input).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            counts.snapshots++;
          })
        ),
        Effect.ensuring(Effect.sync(() => {
          counts.snapshotCpuMs += now() - started;
        })),
      );
    });
  const pump = mounted.driver.pump;
  mounted.driver.pump = Effect.suspend(() => {
    if (observers.size === 0) {
      counts.snapshots = 0;
      counts.snapshotCpuMs = 0;
      return pump;
    }
    const before = engine.inspect();
    const started = now();
    return pump.pipe(Effect.tap(() =>
      Effect.sync(() => {
        const pumpCpuMs = now() - started;
        const after = engine.inspect();
        const betweenPumpDrawCpuMs = before.cumulativeDrawCpuMs - previous.cumulativeDrawCpuMs;
        const sample: RendererFrame = {
          atMs: started,
          cpuMs: pumpCpuMs + counts.snapshotCpuMs + betweenPumpDrawCpuMs,
          snapshotCpuMs: counts.snapshotCpuMs,
          pumpCpuMs,
          betweenPumpDrawCpuMs,
          snapshots: counts.snapshots,
          revision: after.snapshotRevision,
          draws: after.draws - previous.draws,
          uploadCalls: after.bufferUploads.calls - previous.bufferUploads.calls,
          uploadBytes: after.bufferUploads.bytes - previous.bufferUploads.bytes,
        };
        previous = after;
        counts.snapshots = 0;
        counts.snapshotCpuMs = 0;
        observers.forEach(observe => observe(sample));
      })
    ));
  });
  const pointer = () => {
    counts.pointerEvents++;
  };
  engine.canvas.addEventListener("pointermove", pointer);
  engine.onDispose(() => engine.canvas.removeEventListener("pointermove", pointer));
  return {
    ...mounted,
    engine,
    camera: {
      ...mounted.camera,
      inspect: () => ({
        ...mounted.camera.inspect(),
        pointerEvents: counts.pointerEvents,
        restCommits: mounted.camera.revision(),
      }),
    },
    observeFrames: (observe: (sample: RendererFrame) => void) => {
      if (observers.size === 0) previous = engine.inspect();
      observers.add(observe);
      return () => {
        observers.delete(observe);
      };
    },
  };
};
export type Mounted = ReturnType<typeof instrument>;
const mountedProbes = new WeakMap<RendererMounted, Mounted>();
export const instrumentMounted = (mounted: RendererMounted) =>
  Effect.sync(() => {
    if (!mountedProbes.has(mounted)) mountedProbes.set(mounted, instrument(mounted));
  });
export const mountedProbe = (mounted: RendererMounted): Mounted =>
  Option.getOrThrowWith(
    Option.fromUndefinedOr(mountedProbes.get(mounted)),
    () => new WorkbenchFailure({ operation: "renderer-probe", cause: "Renderer was not instrumented at acquisition" }),
  );
