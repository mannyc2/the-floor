import { cameraCorners, cameraValues } from "@floor/atlas/camera";
import { lineWidthCssPx } from "@floor/atlas/look";
import { proportionPalette } from "@floor/atlas/materials";
import { Effect, Option, Result, Schema, Scope } from "effect";
import * as THREE from "three";
import type { Camera, LiveScene, Presentation, Theme } from "../../model";
import { bakeMotion } from "../assets/rig";
import { makeCrowd } from "./crowd";
import { makeFlights } from "./flights";
import { makeInstanceSnapshots } from "./instances";
import { createLiveScene } from "./live-scene";
import type { Palette } from "./palette";
import { createScene, names, type SceneData, syntheticPalette } from "./scene";
import { colorFragment, screenFragment, screenVertex, surfaceVertex } from "./shaders";

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

const own = <A extends { dispose: () => void }>(create: () => A) =>
  Effect.acquireRelease(Effect.sync(create), resource => Effect.sync(() => resource.dispose()));
const lostContext = (event: Event) => event.preventDefault();
const nativeEvent = (operation: string, run: () => void, failed: (error: RendererFailure) => void) => {
  const result = Result.try(run);
  if (Result.isFailure(result)) failed(new RendererFailure({ operation, cause: result.failure }));
};
export const openEngine = (
  element: HTMLElement,
  desks: number,
  initial: Presentation,
  nowMonotonicMs: () => number,
  options: {
    readonly preserveDrawingBuffer: boolean;
    readonly active: () => boolean;
    readonly failed: (error: RendererFailure) => void;
    readonly live: Option.Option<LiveScene>;
  },
) =>
  Effect.gen(function*() {
    const scope = yield* Effect.scope;

    const count = Schema.decodeResult(DeskCount)(desks);
    if (Result.isFailure(count)) failForeign("desk-count", count.failure);
    const canvas = document.createElement("canvas");
    canvas.style.touchAction = "none";
    canvas.setAttribute(
      "aria-label",
      Option.isSome(options.live)
        ? "Live trading floor — provisional kit posts, stations and figures"
        : "Synthetic desk scene — unapproved geometry and palette",
    );
    canvas.tabIndex = 0;
    // The canvas receives only the full-screen composite. Scene depth belongs
    // to the offscreen target, so the default framebuffer needs no depth buffer.
    const renderer = yield* Effect.acquireRelease(
      Effect.sync(() =>
        new THREE.WebGLRenderer({
          canvas,
          antialias: false,
          depth: false,
          preserveDrawingBuffer: options.preserveDrawingBuffer,
        })
      ),
      value =>
        Effect.sync(() => value.dispose()).pipe(Effect.ensuring(Effect.sync(() => {
          value.forceContextLoss();
          canvas.remove();
        }))),
    );
    element.append(canvas);
    renderer.info.autoReset = false;
    const gl = renderer.getContext();
    if (!(gl instanceof WebGL2RenderingContext)) failInvariant("context", "WebGL2 is required");
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
    // The live floor wears the palette of the picked Roomy frames; the
    // synthetic room keeps its neutral test palette.
    const initialPalette: Palette = Option.isNone(options.live) ? syntheticPalette : proportionPalette;
    writePaletteBytes(initialPalette);
    const palette = yield* own(() =>
      new THREE.DataTexture(paletteBytes, names.length, 2, THREE.RGBAFormat, THREE.UnsignedByteType)
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
    const colorDecode = yield* own(() =>
      new THREE.DataTexture(colorDecodeBytes, 256, 1, THREE.RGBAFormat, THREE.UnsignedByteType)
    );
    colorDecode.colorSpace = THREE.SRGBColorSpace;
    colorDecode.minFilter = THREE.NearestFilter;
    colorDecode.magFilter = THREE.NearestFilter;
    colorDecode.needsUpdate = true;
    const live = Option.isSome(options.live);
    // A live desk's dark screen is glass; the synthetic desk's is steel.
    const darkScreen = names.indexOf(live ? "glass-0" : "steel-0");
    const surfaceUniforms = {
      palette: { value: palette },
      paletteSize: { value: names.length },
      paletteTheme: { value: .25 },
      interpolation: { value: 0 },
      instanceInterpolation: { value: 1 },
      screenSlots: { value: new THREE.Vector2(darkScreen, names.indexOf("screen-light-0")) },
      // Live only: the three jackets, and what a working lamp and a crown
      // screen show, which setTheme lights at night.
      tintSlots: {
        value: new THREE.Vector3(
          names.indexOf("jacket-blue-0"),
          names.indexOf("jacket-red-0"),
          names.indexOf("jacket-green-0"),
        ),
      },
      nightSlots: { value: new THREE.Vector2(darkScreen, darkScreen) },
    };
    const material = yield* own(() =>
      new THREE.ShaderMaterial({
        vertexShader: surfaceVertex,
        fragmentShader: colorFragment,
        uniforms: surfaceUniforms,
        defines: live ? { LIVE_SCENE: "" } : {},
      })
    );
    // Traders skin their parts from a baked motion texture; the crowd moves
    // them and picks their clips, and the shader plays the clips.
    const baked = bakeMotion();
    const motion = yield* own(() =>
      new THREE.DataTexture(baked.data, baked.width, baked.height, THREE.RGBAFormat, THREE.FloatType)
    );
    motion.minFilter = THREE.NearestFilter;
    motion.magFilter = THREE.NearestFilter;
    motion.needsUpdate = true;
    const motionTime = { value: 0 };
    const traderMaterial = yield* own(() =>
      new THREE.ShaderMaterial({
        vertexShader: surfaceVertex,
        fragmentShader: colorFragment,
        // Shared uniform objects keep theme and palette changes in step.
        uniforms: { ...surfaceUniforms, motion: { value: motion }, motionTime },
        defines: { LIVE_SCENE: "", TRADER: "" },
      })
    );
    const data: SceneData = Option.match(options.live, {
      onNone: () => createScene({ width: element.clientWidth, height: element.clientHeight, desks }, material),
      onSome: scene => createLiveScene(scene, desks, material, traderMaterial),
    });
    for (const geometry of data.geometries) yield* own(() => geometry);
    for (const mesh of data.meshes) if (mesh instanceof THREE.InstancedMesh) yield* own(() => mesh);
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, 500);
    const sceneTarget = yield* own(() =>
      new THREE.WebGLRenderTarget(1, 1, { count: 2, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter })
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
      depthThreshold: { value: .0012 },
      lineColor: { value: new THREE.Color() },
      darkLineColor: { value: new THREE.Color() },
      lineOpacity: { value: 1 },
      mask: { value: 0 },
      surfaceLines: { value: 1 },
      farLines: { value: 1 },
    };
    const screenMaterial = yield* own(() =>
      new THREE.ShaderMaterial({
        vertexShader: screenVertex,
        fragmentShader: screenFragment,
        depthTest: false,
        depthWrite: false,
        uniforms: screenUniforms,
        defines: live ? { LIVE_SCENE: "" } : {},
      })
    );
    // Live line weights follow how tall a figure is on screen. Inner outlines
    // keep full strength from sixty CSS pixels and are gone below twelve, where
    // they would only scribble; below about ten every outline lightens, to a
    // third, so distant posts keep their colour. The synthetic room ignores both.
    const unitsPerH = Option.match(options.live, { onNone: () => 1, onSome: scene => scene.unitsPerH });
    const figurePixels = (extent: number) => unitsPerH * state.height / extent;
    const surfaceLines = (extent: number) => Math.max(0, Math.min(1, (figurePixels(extent) - 12) / 48));
    const farLines = (extent: number) => Math.max(1 / 3, Math.min(1, (figurePixels(extent) - 2) / 8));
    const quad = new THREE.Mesh(yield* own(() => new THREE.PlaneGeometry(2, 2)), screenMaterial);
    const screenScene = new THREE.Scene();
    screenScene.add(quad);
    const screenCamera = new THREE.Camera();
    const state = {
      camera: initial.camera,
      palette: initialPalette,
      theme: initial.theme,
      revision: initial.revision,
      width: 1,
      height: 1,
      dpr: 1,
      dirty: true,
      previousValue: NaN,
      nextValue: NaN,
    };
    const unitsPerTrader = Option.match(options.live, { onNone: () => 1, onSome: scene => scene.unitsPerH });
    const crowd = Option.flatMap(
      Option.fromUndefinedOr(data.traders),
      traders =>
        makeCrowd(
          traders,
          unitsPerTrader,
          2,
          Option.map(Option.fromUndefinedOr(data.planes), planes => makeFlights(planes, unitsPerTrader)),
        ),
    );
    const mountedAt = nowMonotonicMs();
    const instances = makeInstanceSnapshots(
      data.entities,
      nowMonotonicMs,
      () => {
        state.dirty = true;
      },
      surfaceUniforms.instanceInterpolation,
      surfaceUniforms.interpolation,
      Option.isSome(options.live),
      crowd,
    );
    if (Option.isSome(options.live)) yield* instances.snapshot(options.live.value.snapshot);
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
      // A top face's depth changes about 1.73 world units per unit up the
      // screen at this pitch, so far rungs crossed the fixed threshold on every
      // pixel and inked floors solid. The threshold follows the depth change
      // across the edge span with headroom; at every approved frame's rung the
      // scaled value stays below the fixed one, so those frames are unchanged.
      const unitsPerDevicePixel = view.extent / (state.height * state.dpr);
      screenUniforms.surfaceLines.value = surfaceLines(view.extent);
      screenUniforms.farLines.value = farLines(view.extent);
      screenUniforms.depthThreshold.value = Math.max(
        .0012,
        2.5 * unitsPerDevicePixel * screenUniforms.edgeSpan.value.y / (camera.far - camera.near),
      );
      camera.lookAt(target);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      state.dirty = true;
    };
    const setTheme = (theme: Theme) => {
      surfaceUniforms.paletteTheme.value = theme === "day" ? .25 : .75;
      if (theme === "night") {
        surfaceUniforms.nightSlots.value.set(names.indexOf("lamp-light-0"), names.indexOf("screen-light-0"));
      } else surfaceUniforms.nightSlots.value.set(darkScreen, darkScreen);
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
      if (Option.isSome(data.gauge) && presentation.previousValue !== state.previousValue) {
        writeAttribute("_PREVIOUS", presentation.previousValue, data.gauge.value);
        state.previousValue = presentation.previousValue;
      }
      if (Option.isSome(data.gauge) && presentation.nextValue !== state.nextValue) {
        writeAttribute("_NEXT", presentation.nextValue, data.gauge.value);
        state.nextValue = presentation.nextValue;
      }
      state.revision = presentation.revision;
      instances.present(presentation.sampleTime, presentation.intervalStart, presentation.playbackRate);
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
      if (!options.active() || gl.isContextLost() || (!state.dirty && !force)) return { drawn: false };
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
      state.dirty = false;
      return { drawn: true };
    };
    const drawing = { draw };
    // The floor is alive while anyone stands on it: every frame advances the
    // crowd and the clips it plays. The crowd alone redraws at most thirty
    // times a second, which small figures read as smooth and which halves the
    // cost on a laptop; camera motion still redraws every frame.
    const animation = { drawn: 0 };
    const advance = () => {
      instances.advance();
      Option.map(crowd, value => {
        const now = nowMonotonicMs();
        motionTime.value = (now - mountedAt) / 1000;
        if (value.tick(motionTime.value) && now - animation.drawn >= 1000 / 30 - 2) {
          animation.drawn = now;
          state.dirty = true;
        }
      });
    };
    const pixelCoordinates = (x: number, y: number) => ({
      x: Math.max(0, Math.min(canvas.width - 1, Math.floor(x * state.dpr))),
      y: Math.max(0, Math.min(canvas.height - 1, canvas.height - 1 - Math.floor(y * state.dpr))),
    });
    const pick = (x: number, y: number) => {
      if (x < 0 || x >= state.width || y < 0 || y >= state.height || gl.isContextLost() || !options.active()) return 0;
      drawing.draw();
      const point = pixelCoordinates(x, y);
      const bytes = new Uint8Array(4);
      renderer.readRenderTargetPixels(sceneTarget, point.x, point.y, 1, 1, bytes, 0, 1);
      return decodeEntity(bytes);
    };
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
    const restored = () =>
      nativeEvent("context-restored", () => {
        state.dirty = true;
        drawing.draw();
      }, options.failed);
    canvas.addEventListener("webglcontextlost", lostContext);
    canvas.addEventListener("webglcontextrestored", restored);
    yield* Scope.addFinalizer(
      scope,
      Effect.sync(() => {
        canvas.removeEventListener("webglcontextlost", lostContext);
        canvas.removeEventListener("webglcontextrestored", restored);
      }),
    );
    const observer = new ResizeObserver(() => nativeEvent("resize", resize, options.failed));
    yield* Scope.addFinalizer(scope, Effect.sync(() => observer.disconnect()));
    observer.observe(element);
    resize();
    setTheme(initial.theme);
    apply(initial);
    drawing.draw();
    return {
      camera: { canvas, read: () => state.camera, set: setCamera, groundAt, project },
      draw: (force = false) => drawing.draw(force),
      pick,
      apply,
      // This handle exposes owned resources to the workbench without executing
      // diagnostics, retaining histories, or instrumenting the production loop.
      internals: {
        scope,
        renderer,
        data,
        camera,
        sceneTarget,
        palette,
        paletteBytes,
        colorDecodeBytes,
        drawing,
        desks,
        surfaceUniforms,
        screenUniforms,
        state,
        instances,
        advance,
        writePaletteBytes,
        setTheme,
        writeAttribute,
        now: nowMonotonicMs,
      },
    };
  });
export type Engine = Effect.Success<ReturnType<typeof openEngine>>;
