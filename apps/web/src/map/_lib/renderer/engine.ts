import { cameraCorners, cameraValues } from "@floor/atlas/camera";
import { lineWidthCssPx } from "@floor/atlas/look";
import { Effect, Option, Result, Schema } from "effect";
import * as THREE from "three";
import type { Camera, Presentation, Theme } from "../../model";
import { makeInstanceSnapshots } from "./instances";
import type { Palette } from "./palette";
import { createScene, names, slot, syntheticPalette } from "./scene";
import { colorFragment, screenFragment, screenVertex, surfaceVertex } from "./shaders";
import { trackUploads } from "./uploads";

export class RendererFailure extends Schema.TaggedError<RendererFailure>()("RendererFailure", {
  operation: Schema.String,
  cause: Schema.Defect(),
}) {}
class RendererInvariant extends Schema.TaggedError<RendererInvariant>()("RendererInvariant", {
  operation: Schema.String,
  detail: Schema.String,
}) {}
// Browser and Three callbacks are synchronous. The Mount’s Effect.try boundary
// turns these structured failures into the host error channel.
const raise = (error: RendererFailure | RendererInvariant): never => {
  // oxlint-disable-next-line effect/noThrowStatement -- Three callbacks are synchronous; the owning Mount converts tagged SDK failures into its Effect error channel.
  throw error;
};
function failForeign(operation: string, cause: unknown): never {
  return raise(new RendererFailure({ operation, cause }));
}
function failInvariant(operation: string, detail: string): never {
  return raise(new RendererInvariant({ operation, detail }));
}
// The 12-bit entity channel reserves ten identifiers for synthetic room parts.
const DeskCount = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 4085 }));
const decodeEntity = (bytes: Uint8Array) =>
  Math.floor(((bytes[0] ?? 0) + (bytes[1] ?? 0) * 256 + (bytes[2] ?? 0) * 65536) / 4096);

export const createLedger = () => ({
  acquired: 0,
  released: 0,
  live: 0,
  listeners: 0,
  contexts: 0,
  history: new Array<{ geometries: number; textures: number; contextLost: boolean }>(),
});
export type Ledger = ReturnType<typeof createLedger>;
export interface DrawSample {
  readonly atMs: number;
  readonly camera: Camera;
  readonly draw: number;
}
export const listen = <K extends keyof HTMLElementEventMap>(
  ledger: Ledger,
  element: HTMLElement,
  event: K,
  handler: (event: HTMLElementEventMap[K]) => void,
  options?: AddEventListenerOptions,
) => {
  element.addEventListener(event, handler, options);
  ledger.listeners++;
  return () => {
    element.removeEventListener(event, handler, options);
    ledger.listeners--;
  };
};
const listenContext = (ledger: Ledger, canvas: HTMLCanvasElement, name: string, handler: (event: Event) => void) => {
  canvas.addEventListener(name, handler);
  ledger.listeners++;
  return () => {
    canvas.removeEventListener(name, handler);
    ledger.listeners--;
  };
};
export const openEngine = (
  element: HTMLElement,
  desks: number,
  initial: Presentation,
  nowMonotonicMs: () => number,
  ledger: Ledger,
) => {
  const finalizers: Array<() => void> = [];
  const ownedContext = { counted: false, closed: false };
  const own = <A extends { dispose: () => void }>(resource: A): A => {
    finalizers.push(() => resource.dispose());
    return resource;
  };
  const release = () => {
    if (ownedContext.closed) return;
    ownedContext.closed = true;
    const errors: Array<unknown> = [];
    finalizers.toReversed().forEach(dispose => {
      const result = Result.try(dispose);
      if (Result.isFailure(result)) errors.push(result.failure);
    });
    if (errors.length > 0) failForeign("release", errors);
  };
  const acquired = Result.try({
    try: () => {
      const count = Schema.decodeResult(DeskCount)(desks);
      if (Result.isFailure(count)) failForeign("desk-count", count.failure);
      const canvas = document.createElement("canvas");
      canvas.style.touchAction = "none";
      canvas.setAttribute("aria-label", "Synthetic desk scene — unapproved geometry and palette");
      canvas.tabIndex = 0;
      // The canvas receives only the full-screen composite. Scene depth belongs
      // to the offscreen target, so the default framebuffer needs no depth buffer.
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, depth: false, preserveDrawingBuffer: true });
      ledger.acquired++;
      ledger.live++;
      ledger.contexts++;
      ownedContext.counted = true;
      finalizers.push(() => {
        renderer.dispose();
        renderer.forceContextLoss();
        canvas.remove();
        if (ownedContext.counted) {
          ledger.contexts--;
          ownedContext.counted = false;
        }
        ledger.live--;
        ledger.released++;
        ledger.history.push({
          geometries: renderer.info.memory.geometries,
          textures: renderer.info.memory.textures,
          contextLost: renderer.getContext().isContextLost(),
        });
      });
      element.append(canvas);
      renderer.info.autoReset = false;
      const gl = renderer.getContext();
      if (!(gl instanceof WebGL2RenderingContext)) failInvariant("context", "WebGL2 is required");
      const bufferUploads = trackUploads(gl);
      finalizers.push(bufferUploads.restore);
      const extension = gl.getExtension("WEBGL_debug_renderer_info");
      const rendererName = Schema.decodeUnknownOption(Schema.String)(
        extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      );
      // Palette colors are authored as sRGB bytes. The scene target preserves
      // those bytes, so converting each covered fragment through linear adds no information.
      const paletteBytes = new Uint8Array(names.length * 2 * 4);
      const writePaletteBytes = (selection: Palette) => {
        for (const theme of ["day", "night"] satisfies ReadonlyArray<Theme>) {
          const offset = theme === "day" ? 0 : names.length * 4;
          names.forEach((name, index) => {
            const color = selection.colors[name][theme];
            paletteBytes.set([(color >>> 16) & 255, (color >>> 8) & 255, color & 255, 255], offset + index * 4);
          });
        }
      };
      writePaletteBytes(syntheticPalette);
      const palette = own(
        new THREE.DataTexture(paletteBytes, names.length, 2, THREE.RGBAFormat, THREE.UnsignedByteType),
      );
      palette.colorSpace = THREE.NoColorSpace;
      palette.minFilter = THREE.NearestFilter;
      palette.magFilter = THREE.NearestFilter;
      palette.needsUpdate = true;
      // Fractional outlines use the same hardware sRGB decoder as a color target.
      // A shader approximation can round the final blended byte differently.
      const colorDecodeBytes = new Uint8Array(256 * 4).map((_value, index) =>
        index % 4 === 3 ? 255 : Math.floor(index / 4)
      );
      const colorDecode = own(
        new THREE.DataTexture(colorDecodeBytes, 256, 1, THREE.RGBAFormat, THREE.UnsignedByteType),
      );
      colorDecode.colorSpace = THREE.SRGBColorSpace;
      colorDecode.minFilter = THREE.NearestFilter;
      colorDecode.magFilter = THREE.NearestFilter;
      colorDecode.needsUpdate = true;
      const surfaceUniforms = {
        palette: { value: palette },
        paletteSize: { value: names.length },
        paletteTheme: { value: .25 },
        interpolation: { value: 0 },
        instanceInterpolation: { value: 1 },
      };
      const material = own(
        new THREE.ShaderMaterial({
          vertexShader: surfaceVertex,
          fragmentShader: colorFragment,
          uniforms: surfaceUniforms,
        }),
      );
      const data = createScene({ width: element.clientWidth, height: element.clientHeight, desks }, material);
      data.geometries.forEach(own);
      data.meshes.forEach(mesh => {
        if (mesh instanceof THREE.InstancedMesh) own(mesh);
      });
      const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, 500);
      const sceneTarget = own(
        new THREE.WebGLRenderTarget(1, 1, { count: 2, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter }),
      );
      const colorTexture = Option.getOrElse(
        Option.fromUndefinedOr(sceneTarget.textures[0]),
        () => failInvariant("scene-target", "Color attachment is required"),
      );
      const idTexture = Option.getOrElse(
        Option.fromUndefinedOr(sceneTarget.textures[1]),
        () => failInvariant("scene-target", "Identity attachment is required"),
      );
      // The surface shader stores encoded bytes explicitly. Sampling them without
      // conversion lets the composite leave pixels outside outlines untouched.
      colorTexture.colorSpace = THREE.NoColorSpace;
      idTexture.colorSpace = THREE.NoColorSpace;
      sceneTarget.depthTexture = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
      const clearGroundBytes = new Float32Array([0, 0, 0, 1]);
      const clearIdentity = new Float32Array([0, 0, 0, 1]);
      const screenUniforms = {
        colors: { value: colorTexture },
        colorDecode: { value: colorDecode },
        ids: { value: idTexture },
        depths: { value: sceneTarget.depthTexture },
        edgeSpan: { value: new THREE.Vector2(0, 1) },
        lineColor: { value: new THREE.Color() },
        darkLineColor: { value: new THREE.Color() },
        lineOpacity: { value: 1 },
        mask: { value: 0 },
      };
      const screenMaterial = own(
        new THREE.ShaderMaterial({
          vertexShader: screenVertex,
          fragmentShader: screenFragment,
          depthTest: false,
          depthWrite: false,
          uniforms: screenUniforms,
        }),
      );
      const quad = new THREE.Mesh(own(new THREE.PlaneGeometry(2, 2)), screenMaterial);
      const screenScene = new THREE.Scene();
      screenScene.add(quad);
      const screenCamera = new THREE.Camera();
      const state = {
        camera: initial.camera,
        palette: syntheticPalette,
        theme: initial.theme,
        revision: initial.revision,
        width: 1,
        height: 1,
        dpr: 1,
        closed: false,
        lost: false,
        dirty: true,
        drawCount: 0,
        cumulativeDrawCpuMs: 0,
        uploadBytes: 0,
        uploadCalls: 0,
        cumulativeUploadCalls: 0,
        cumulativeUploadArrayBytes: 0,
        previousValue: NaN,
        nextValue: NaN,
        sampleOffsetMs: 0,
        playbackRate: 0,
        intervalStartOffsetMs: 0,
        anchorMonotonicMs: nowMonotonicMs(),
        failureHandler: Option.none<(error: RendererFailure) => void>(),
      };
      const drawObservers = new Set<(sample: DrawSample) => void>();
      finalizers.push(() => drawObservers.clear());
      const instances = makeInstanceSnapshots(data.entities, nowMonotonicMs, () => {
        state.dirty = true;
      }, surfaceUniforms.instanceInterpolation);
      const observeAttribute = (attribute: THREE.BufferAttribute) => {
        attribute.onUpload(() => {
          state.uploadCalls++;
          state.uploadBytes += attribute.array.byteLength;
          state.cumulativeUploadCalls++;
          // Three's callback identifies a touched attribute, not the exact
          // bufferSubData range; whole-array bytes are an explicit upper bound.
          state.cumulativeUploadArrayBytes += attribute.array.byteLength;
        });
      };
      data.geometries.forEach(geometry => {
        Object.values(geometry.attributes).forEach(attribute => {
          if (attribute instanceof THREE.BufferAttribute) observeAttribute(attribute);
        });
      });
      data.meshes.forEach(mesh => {
        if (mesh instanceof THREE.InstancedMesh) {
          observeAttribute(mesh.instanceMatrix);
          Option.map(Option.fromNullishOr(mesh.instanceColor), observeAttribute);
        }
      });
      const setCamera = (view: Camera) => {
        state.camera = view;
        camera.left = -view.extent * state.width / state.height / 2;
        camera.right = -camera.left;
        camera.top = view.extent / 2;
        camera.bottom = -camera.top;
        const target = new THREE.Vector3(view.x, cameraValues.targetHeight, view.z);
        const corner = cameraCorners[view.rotation];
        const towardCamera = new THREE.Vector3(
          cameraValues.horizontalOffset * corner.x,
          cameraValues.verticalOffset,
          cameraValues.horizontalOffset * corner.z,
        ).normalize();
        camera.position.set(target.x, target.y, target.z).addScaledVector(
          towardCamera,
          cameraValues.distance,
        );
        data.cutaway(towardCamera);
        camera.lookAt(target);
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld();
        state.dirty = true;
      };
      const setTheme = (theme: Theme) => {
        surfaceUniforms.paletteTheme.value = theme === "day" ? .25 : .75;
        state.theme = theme;
        screenUniforms.lineColor.value.setHex(state.palette.colors.line[theme]);
        screenUniforms.darkLineColor.value.setHex(state.palette.darkLine[theme]);
        screenUniforms.lineOpacity.value = state.palette.lineOpacity[theme];
        state.dirty = true;
      };
      const writeAttribute = (name: string, value: number, entityId: number) => {
        const maybeEntity = Option.fromNullishOr(data.entities.find(item => item.id === entityId));
        if (Option.isNone(maybeEntity)) failInvariant("write-attribute", `Unknown entity ${entityId}`);
        const entity = maybeEntity.value;
        const attribute = entity.mesh.geometry.getAttribute(name);
        if (!(attribute instanceof THREE.BufferAttribute)) {
          failInvariant("write-attribute", `Missing dynamic attribute ${name}`);
        }
        if (Option.isSome(entity.maybeInstance)) {
          attribute.setX(entity.maybeInstance.value, value);
          attribute.addUpdateRange(entity.maybeInstance.value, 1);
        } else attribute.array.fill(value);
        attribute.needsUpdate = true;
      };
      const apply = (presentation: Presentation, applyView = true) => {
        // Validate every fallible selector before the no-allocation commit phase.
        if (presentation.camera.extent <= 0 || !Number.isFinite(presentation.camera.extent)) {
          failInvariant("presentation", "Invalid extent");
        }
        if (presentation.theme !== state.theme) {
          setTheme(presentation.theme);
        }
        if (presentation.previousValue !== state.previousValue) {
          writeAttribute("_PREVIOUS", presentation.previousValue, data.gaugeId);
          state.previousValue = presentation.previousValue;
        }
        if (presentation.nextValue !== state.nextValue) {
          writeAttribute("_NEXT", presentation.nextValue, data.gaugeId);
          state.nextValue = presentation.nextValue;
        }
        state.revision = presentation.revision;
        state.sampleOffsetMs = presentation.sampleTime;
        state.playbackRate = presentation.playbackRate;
        state.intervalStartOffsetMs = presentation.intervalStart;
        state.anchorMonotonicMs = nowMonotonicMs();
        surfaceUniforms.interpolation.value = Math.max(
          0,
          Math.min(1, (presentation.sampleTime - presentation.intervalStart) / 250),
        );
        if (applyView) setCamera(presentation.camera);
        state.dirty = true;
      };
      const resize = () => {
        state.width = Math.max(1, element.clientWidth);
        state.height = Math.max(1, element.clientHeight);
        state.dpr = window.devicePixelRatio;
        renderer.setPixelRatio(state.dpr);
        renderer.setSize(state.width, state.height);
        const size = renderer.getDrawingBufferSize(new THREE.Vector2());
        sceneTarget.setSize(size.x, size.y);
        // Integer, asymmetric spans keep a one-CSS-pixel line at DPR 1, 2 and 3.
        screenUniforms.edgeSpan.value.set(
          Math.floor(state.dpr * lineWidthCssPx / 2),
          Math.ceil(state.dpr * lineWidthCssPx / 2),
        );
        setCamera(state.camera);
      };
      const draw = (force = false) => {
        if (state.closed || state.lost || (!state.dirty && !force)) return { cpuMs: 0, drawn: false };
        state.uploadBytes = 0;
        state.uploadCalls = 0;
        const start = nowMonotonicMs();
        renderer.info.reset();
        renderer.setRenderTarget(sceneTarget);
        // One geometry pass writes color and exact IDs against the same depth.
        // Their backgrounds differ, so a broadcast clear would corrupt picking.
        const ground = state.palette.colors.ground[state.theme];
        clearGroundBytes[0] = ((ground >>> 16) & 255) / 255;
        clearGroundBytes[1] = ((ground >>> 8) & 255) / 255;
        clearGroundBytes[2] = (ground & 255) / 255;
        renderer.state.buffers.color.setMask(true);
        renderer.state.buffers.depth.setMask(true);
        renderer.state.buffers.depth.setClear(1);
        gl.clearBufferfv(gl.COLOR, 0, clearGroundBytes);
        gl.clearBufferfv(gl.COLOR, 1, clearIdentity);
        renderer.clear(false, true, false);
        const savedAutoClear = renderer.autoClear;
        renderer.autoClear = false;
        const rendered = Result.try(() => renderer.render(data.scene, camera));
        renderer.autoClear = savedAutoClear;
        if (Result.isFailure(rendered)) return failForeign("scene-pass", rendered.failure);
        // Three requires null to select the browser’s default framebuffer.
        // oxlint-disable-next-line effect/noNullish -- Three requires null to select the default browser framebuffer.
        renderer.setRenderTarget(null);
        // The opaque, depth-free quad overwrites every canvas pixel. Clearing it
        // first adds work on software renderers without contributing to the image.
        renderer.autoClear = false;
        const composited = Result.try(() => renderer.render(screenScene, screenCamera));
        renderer.autoClear = savedAutoClear;
        if (Result.isFailure(composited)) return failForeign("composite-pass", composited.failure);
        state.drawCount++;
        state.dirty = false;
        const ended = nowMonotonicMs();
        const cpuMs = ended - start;
        state.cumulativeDrawCpuMs += cpuMs;
        if (drawObservers.size > 0) {
          const sample = { atMs: ended, camera: state.camera, draw: state.drawCount };
          drawObservers.forEach(observe => observe(sample));
        }
        return { cpuMs, drawn: true };
      };
      const advance = () => {
        instances.advance();
        if (state.playbackRate === 0) return;
        // Presentation values are simulation offsets. Only the monotonic
        // elapsed duration is scaled, so capture epochs never enter replay math.
        const next = Math.max(
          0,
          Math.min(
            1,
            (state.sampleOffsetMs + (nowMonotonicMs() - state.anchorMonotonicMs) * state.playbackRate
              - state.intervalStartOffsetMs) / 250,
          ),
        );
        if (next !== surfaceUniforms.interpolation.value) {
          surfaceUniforms.interpolation.value = next;
          state.dirty = true;
        }
      };
      const pixelCoordinates = (x: number, y: number) => ({
        x: Math.max(0, Math.min(canvas.width - 1, Math.floor(x * state.dpr))),
        y: Math.max(0, Math.min(canvas.height - 1, canvas.height - 1 - Math.floor(y * state.dpr))),
      });
      const pick = (x: number, y: number) => {
        if (x < 0 || x >= state.width || y < 0 || y >= state.height || state.lost || state.closed) return 0;
        draw();
        const point = pixelCoordinates(x, y);
        const bytes = new Uint8Array(4);
        renderer.readRenderTargetPixels(sceneTarget, point.x, point.y, 1, 1, bytes, 0, 1);
        return decodeEntity(bytes);
      };
      const pickAsync = (x: number, y: number) =>
        Effect.suspend(() => {
          if (x < 0 || x >= state.width || y < 0 || y >= state.height || state.lost || state.closed) {
            return Effect.succeed(0);
          }
          draw();
          const point = pixelCoordinates(x, y);
          const bytes = new Uint8Array(4);
          // Three 0.180 implements this with PIXEL_PACK_BUFFER, fenceSync and getBufferSubData.
          return Effect.tryPromise({
            try: () => renderer.readRenderTargetPixelsAsync(sceneTarget, point.x, point.y, 1, 1, bytes, 0, 1),
            catch: cause => new RendererFailure({ operation: "async-pick", cause }),
          }).pipe(Effect.map(() => decodeEntity(bytes)));
        });
      const raycaster = new THREE.Raycaster();
      const rayAt = (x: number, y: number) => {
        raycaster.setFromCamera(new THREE.Vector2(x / state.width * 2 - 1, 1 - y / state.height * 2), camera);
        return raycaster.ray;
      };
      const groundAt = (x: number, y: number) => {
        const point = rayAt(x, y).intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
        return point ? { x: point.x, z: point.z } : { x: state.camera.x, z: state.camera.z };
      };
      const project = (x: number, y: number, z: number) => {
        const point = new THREE.Vector3(x, y, z).project(camera);
        return { x: (point.x + 1) * state.width / 2, y: (1 - point.y) * state.height / 2 };
      };
      const frameBytes = () => {
        draw();
        const bytes = new Uint8Array(canvas.width * canvas.height * 4);
        gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
        return bytes;
      };
      const inspect = () => ({
        renderer: Option.getOrElse(rendererName, () => "unreported"),
        webgl2: renderer.capabilities.isWebGL2,
        width: state.width,
        height: state.height,
        dpr: state.dpr,
        draws: state.drawCount,
        cumulativeDrawCpuMs: state.cumulativeDrawCpuMs,
        camera: state.camera,
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
        uploadBytes: state.uploadBytes,
        uploadCalls: state.uploadCalls,
        cumulativeUploadCalls: state.cumulativeUploadCalls,
        cumulativeUploadArrayBytes: state.cumulativeUploadArrayBytes,
        bufferUploads: bufferUploads.read(),
        lost: state.lost,
        interpolation: surfaceUniforms.interpolation.value,
        instanceInterpolation: instances.interpolation.value,
        snapshotRevision: instances.revision(),
        entityCount: data.entities.length,
        desks,
      });
      const nativeEvent = (operation: string, run: () => void) => {
        const result = Result.try(run);
        if (Result.isFailure(result)) {
          state.closed = true;
          const error = new RendererFailure({ operation, cause: result.failure });
          Option.match(state.failureHandler, { onNone: () => raise(error), onSome: handler => handler(error) });
        }
      };
      const removeLost = listenContext(ledger, canvas, "webglcontextlost", event => {
        event.preventDefault();
        state.lost = true;
        if (ownedContext.counted) {
          ledger.contexts--;
          ownedContext.counted = false;
        }
      });
      const removeRestored = listenContext(
        ledger,
        canvas,
        "webglcontextrestored",
        () =>
          nativeEvent("context-restored", () => {
            state.lost = false;
            state.dirty = true;
            if (!ownedContext.counted) {
              ledger.contexts++;
              ownedContext.counted = true;
            }
            draw();
          }),
      );
      finalizers.push(removeLost, removeRestored);
      const observer = new ResizeObserver(() => nativeEvent("resize", resize));
      finalizers.push(() => observer.disconnect());
      observer.observe(element);
      resize();
      setTheme(initial.theme);
      apply(initial);
      draw();
      const dispose = () => {
        state.closed = true;
        release();
      };
      return {
        ledger,
        canvas,
        draw,
        observeDraws: (observe: (sample: DrawSample) => void) => {
          drawObservers.add(observe);
          return () => {
            drawObservers.delete(observe);
          };
        },
        advance,
        snapshot: instances.snapshot,
        instancePositions: instances.positions,
        inspect,
        setCamera,
        // The workbench supplies unapproved candidate data through the same
        // upload path that the Atlas uses, never through image recolouring.
        setPalette: (selection: Palette) => {
          state.palette = selection;
          writePaletteBytes(selection);
          palette.needsUpdate = true;
          setTheme(state.theme);
        },
        groundAt,
        project,
        apply,
        pick,
        pickAsync,
        frameBytes,
        dispose,
        diagnosticScene: () => ({ ...data, camera }),
        onDispose: (finalizer: () => void) => finalizers.push(finalizer),
        renderDiagnostic: (scene: THREE.Scene, target: THREE.WebGLRenderTarget) => {
          renderer.setRenderTarget(target);
          renderer.render(scene, camera);
          state.dirty = true;
        },
        setMask: (mask: boolean) => {
          screenUniforms.mask.value = mask ? 1 : 0;
          state.dirty = true;
          draw();
        },
        setPaletteSlot: (entity: number, name: string) => {
          const paletteSlot = slot(name);
          if (Option.isNone(paletteSlot)) {
            failInvariant("palette-slot", `Unknown synthetic palette slot ${name}`);
          }
          writeAttribute("_PALETTE", paletteSlot.value, entity);
          state.dirty = true;
        },
        finishFrame: () => gl.finish(),
        onFailure: (handler: (error: RendererFailure) => void) => {
          state.failureHandler = Option.some(handler);
        },
        loseContext: () => renderer.forceContextLoss(),
        restoreContext: () => renderer.forceContextRestore(),
      };
    },
    catch: cause => cause,
  });
  if (Result.isFailure(acquired)) {
    const cleanup = Result.try(release);
    return failForeign("acquire", { acquisition: acquired.failure, cleanup: Result.getFailure(cleanup) });
  }
  return acquired.success;
};
export type Engine = ReturnType<typeof openEngine>;
