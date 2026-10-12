import { AdoptedDesign } from "@floor/contract";
import { MarketSlot, MarketTier } from "@floor/districts";
import { type AtlasTheme, KitScene, palette } from "@floor/kit";
import { Option, Order, Result, Schema, Struct } from "effect";
import * as THREE from "three";
import { animatedDesignMarkets, commitDesignAnimation, designAnimationDue, planDesignAnimation } from "./animation";
import { eligibleEvidence } from "./evidence";
import { cacheMarkets, commitMarketUpdate, planMarketUpdate } from "./incremental";
import { type AtlasLayout, createLayout } from "./layout";
import { AtlasEvidence, AtlasMarket, AtlasRendererError } from "./types";
import type {
  AtlasLabel,
  AtlasLens,
  AtlasRenderer,
  AtlasRendererOptions,
  AtlasView,
  AtlasZoom,
  RendererStats,
} from "./types";
import { layoutWindow } from "./visibility";

export type { AtlasTheme } from "@floor/kit";
export { AtlasEvidence, AtlasRendererError } from "./types";
export type {
  AtlasLabel,
  AtlasLens,
  AtlasMarket,
  AtlasRenderer,
  AtlasRendererOptions,
  AtlasView,
  AtlasZoom,
  RendererFrame,
  RendererStats,
} from "./types";

const sameSlots = Schema.toEquivalence(Schema.Array(MarketSlot));
const sameTiers = Schema.toEquivalence(Schema.Array(MarketTier));
const sameAdoptions = Schema.toEquivalence(Schema.Array(AdoptedDesign));
const sameMarkets = Schema.toEquivalence(Schema.Array(AtlasMarket));
// Advancing a source clock alone does not change geometry when the eligible evidence remains identical.
const sameEvidence = Option.makeEquivalence(
  Schema.toEquivalence(AtlasEvidence.mapFields(Struct.pick(["agents", "notes", "receipts"]))),
);
const sameId = Option.makeEquivalence<string>((a, b) => a === b);
const sameMarketIds = (left: readonly AtlasMarket[], right: readonly AtlasMarket[]): boolean =>
  left.length === right.length && left.every((market, index) => market.id === right[index]?.id);
const completeSlots = (markets: readonly AtlasMarket[], slots: readonly MarketSlot[]): boolean => {
  const assigned = new Map(slots.map(assignment => [assignment.marketId, assignment.slot]));
  return assigned.size === slots.length && new Set(slots.map(assignment => assignment.slot)).size === slots.length
    && markets.every(market => assigned.has(market.id));
};
const completeTiers = (markets: readonly AtlasMarket[], tiers: readonly MarketTier[]): boolean => {
  const assigned = new Set(tiers.map(assignment => assignment.marketId));
  return assigned.size === tiers.length && markets.every(market => assigned.has(market.id));
};
const hasSlotAuthority = (data: Parameters<AtlasRenderer["setData"]>[0], options: AtlasRendererOptions): boolean =>
  options.allowSynthetic === true || Option.isSome(Option.fromUndefinedOr(data.slots));
const dataSlots = (data: Parameters<AtlasRenderer["setData"]>[0]): readonly MarketSlot[] =>
  data.slots
    ?? data.markets.toSorted((a, b) => Order.String(a.id, b.id)).map((market, slot) => ({ marketId: market.id, slot }));
function validateSnapshot(
  data: Parameters<AtlasRenderer["setData"]>[0],
  options: AtlasRendererOptions,
  authority: {
    readonly slots: readonly MarketSlot[];
    readonly tiers: readonly MarketTier[];
    readonly slotsUnchanged: boolean;
    readonly identitiesUnchanged: boolean;
    readonly tiersUnchanged: boolean;
  },
): Result.Result<void, AtlasRendererError> {
  if (options.allowSynthetic !== true && data.markets.some(market => market.source === "synthetic")) {
    return Result.fail(
      new AtlasRendererError({
        message: "Synthetic readings belong to the renderer bench and cannot enter the live atlas.",
      }),
    );
  }
  if (
    !hasSlotAuthority(data, options)
    || (!(authority.slotsUnchanged && authority.identitiesUnchanged) && !completeSlots(data.markets, authority.slots))
  ) {
    return Result.fail(
      new AtlasRendererError({ message: "Observed markets require complete, unique persistent slot assignments." }),
    );
  }
  if (!(authority.tiersUnchanged && authority.identitiesUnchanged) && !completeTiers(data.markets, authority.tiers)) {
    return Result.fail(
      new AtlasRendererError({ message: "Observed markets require complete authoritative tier assignments." }),
    );
  }
  return Result.succeed(void 0);
}
const steps = [0.56, 1, 1.8, 3.3, 6] as const;
const names: readonly AtlasZoom[] = ["archipelago", "island", "district", "works", "machine"];
const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));
const levelOf = (zoom: number): number => zoom < 0.76 ? 0 : zoom < 1.35 ? 1 : zoom < 2.45 ? 2 : zoom < 4.5 ? 3 : 4;

/** The viewer owns no market authority: only supplied observations may fill an instrument. */
export function createAtlasRenderer(host: HTMLElement, options: AtlasRendererOptions = {}): AtlasRenderer {
  const scene = new THREE.Scene();
  let theme: AtlasTheme = "day";
  scene.background = new THREE.Color(palette.day.ground);
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    preserveDrawingBuffer: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(palette.day.ground);
  const canvas = renderer.domElement;
  canvas.setAttribute(
    "aria-label",
    "Interactive isometric atlas of observed on-chain markets. Drag to pan, scroll to zoom, or choose a market in the list.",
  );
  canvas.setAttribute("role", "img");
  canvas.dataset["atlasCanvas"] = "true";
  canvas.style.cssText = "display:block;width:100%;height:100%;touch-action:none;cursor:grab;outline-offset:-4px";
  canvas.tabIndex = 0;
  host.appendChild(canvas);

  const camera = new THREE.OrthographicCamera(-60, 60, 40, -40, 0.1, 1000);
  const cameraDirection = new THREE.Vector3(Math.sqrt(3 / 8), 0.5, Math.sqrt(3 / 8));
  const center = new THREE.Vector3(0, 0, 3);
  const targetCenter = center.clone();
  let zoom = 1;
  let targetZoom = 1;
  let width = 1;
  let height = 1;
  let markets: readonly AtlasMarket[] = [];
  let revision = 0;
  let slots: readonly MarketSlot[] = [];
  let tiers: readonly MarketTier[] = [];
  let adoptedDesigns: readonly AdoptedDesign[] = [];
  let evidence = Option.none<AtlasEvidence>();
  let activeMarketId = Option.none<string>();
  let selectedId = Option.none<string>();
  let hoverId = Option.none<string>();
  let lens: AtlasLens = "flow";
  let moorings: ReadonlySet<string> = new Set();
  let exploded = false;
  let reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let layout: AtlasLayout = createLayout(markets, {
    lens,
    moorings,
    explodedId: Option.none(),
    activeMarketId,
    window: layoutWindow([center.x, center.z], zoom, width, height),
  });
  let marketCache = cacheMarkets(layout, markets);
  let kit = new KitScene(layout.parts, theme, marketCache.keys);
  let prioritySource = layout.labels;
  let prioritySelection = Option.none<string>();
  let priorityLabels = layout.labels;
  let linework = Option.none<THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>>();
  let disposed = false;
  let pendingFrame = 0;
  // requestAnimationFrame supplies this same monotonic browser timestamp origin.
  // oxlint-disable-next-line effect/noGlobals -- Browser renderer timing shares the requestAnimationFrame timestamp origin.
  let lastFrame = performance.now();
  let lastAnimationAt = lastFrame;
  let animationMarkets: readonly string[] = [];
  let needsRender = true;
  let sampledFrames = 0;
  let sampledDuration = 0;
  let detailCeiling = 3;
  let orangeParts = layout.parts.filter((part) => part.material === "accent").length;
  let tierCounts = { stall: 0, works: 0, tower: 0 };
  let instrumentTierCounts = { stall: 0, works: 0, tower: 0 };
  let previousViewKey = "";
  let lastLabelKey = "";
  let stats: RendererStats = {
    framesPerSecond: 0,
    frameTimeMs: 0,
    drawCalls: 0,
    triangles: 0,
    parts: layout.parts.length,
    markets: 0,
    detail: 3,
    orangeParts: 0,
    activeMarketId: Option.getOrNull(activeMarketId),
    tierCounts,
    instrumentTierCounts,
  };
  scene.add(kit.group);

  const selectionGeometry = new THREE.BufferGeometry();
  const selectionMaterial = new THREE.LineBasicMaterial({
    color: palette.day.line,
    transparent: true,
    opacity: 0.8,
    depthTest: false,
  });
  const selection = new THREE.LineSegments(selectionGeometry, selectionMaterial);
  selection.renderOrder = 10;
  selection.visible = false;
  scene.add(selection);

  const chartMaterial = new THREE.LineBasicMaterial({
    color: palette.day.line,
    transparent: true,
    opacity: 0.2,
    depthWrite: false,
  });
  const chartVertices: number[] = [];
  for (let line = -10; line <= 10; line++) {
    const n = line * 12;
    chartVertices.push(-120, -2.3, n, 120, -2.3, n, n, -2.3, -120, n, -2.3, 120);
  }
  const chartGeometry = new THREE.BufferGeometry();
  chartGeometry.setAttribute("position", new THREE.Float32BufferAttribute(chartVertices, 3));
  const chart = new THREE.LineSegments(chartGeometry, chartMaterial);
  scene.add(chart);

  const raycaster = new THREE.Raycaster();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.9);
  const projected = new THREE.Vector3();

  function updateCamera(): void {
    const aspect = width / height;
    const half = 39 / zoom;
    camera.left = -half * aspect;
    camera.right = half * aspect;
    camera.top = half;
    camera.bottom = -half;
    const distance = Math.max(220, layout.radius * 3);
    camera.far = distance * 3;
    camera.position.copy(center).addScaledVector(cameraDirection, distance);
    camera.lookAt(center);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  }

  function getView(): AtlasView {
    return {
      level: names[levelOf(zoom)] ?? "island",
      zoom,
      center: [center.x, center.z],
      selectedId: Option.getOrNull(selectedId),
    };
  }

  function rebuildLinework(): void {
    Option.map(linework, (lines) => {
      scene.remove(lines);
      lines.geometry.dispose();
      lines.material.dispose();
    });
    const vertices: number[] = [];
    for (const path of layout.paths) {
      for (let i = 1; i < path.length; i++) {
        const from = path[i - 1], to = path[i];
        if (from && to) vertices.push(...from, ...to);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    const lines = new THREE.LineSegments(
      geometry,
      new THREE.LineBasicMaterial({
        color: palette[theme].line,
        transparent: true,
        opacity: theme === "day" ? 0.46 : 0.45,
        depthWrite: false,
      }),
    );
    linework = Option.some(lines);
    scene.add(lines);
  }

  function updateSelection(): void {
    const current = Option.orElse(selectedId, () => hoverId);
    if (Option.isNone(current)) {
      selection.visible = false;
      return;
    }
    const market = layout.markets.find(item => item.market.id === current.value);
    selection.visible = Boolean(market);
    if (!market) return;
    const vertices: number[] = [];
    const r = market.radius + 0.5;
    const { x, z } = market;
    for (const inset of Option.isSome(selectedId) ? [0, 0.32] : [0]) {
      const s = r + inset;
      const corners = [[x - s, 0.94, z - s], [x + s, 0.94, z - s], [x + s, 0.94, z + s], [x - s, 0.94, z + s]];
      corners.forEach((corner, i) => {
        const next = corners[(i + 1) % 4];
        if (next) vertices.push(...corner, ...next);
      });
    }
    selectionGeometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    selectionGeometry.computeBoundingSphere();
  }

  function projectLabels(): void {
    const occupied: { x: number; y: number; w: number; h: number }[] = [];
    const labels: AtlasLabel[] = [];
    if (prioritySource !== layout.labels || !sameId(prioritySelection, selectedId)) {
      priorityLabels = layout.labels.toSorted((a, b) =>
        (Option.contains(selectedId, b.id) ? 10000 : b.priority)
        - (Option.contains(selectedId, a.id) ? 10000 : a.priority)
      );
      prioritySource = layout.labels;
      prioritySelection = selectedId;
    }
    for (const item of priorityLabels) {
      const eligible = Option.contains(selectedId, item.id) || (zoom >= item.minZoom && zoom <= item.maxZoom);
      if (!eligible) continue;
      projected.set(...item.position).project(camera);
      const x = (projected.x * 0.5 + 0.5) * width;
      const y = (-projected.y * 0.5 + 0.5) * height;
      const labelWidth = item.kind === "market"
        ? Math.max(68, item.text.length * 8)
        : Math.max(130, item.text.length * 9);
      const labelHeight = Option.isSome(Option.fromNullishOr(item.subtitle)) ? 38 : 22;
      const within = x > 35 && x < width - 35 && y > 25 && y < height - 35 && projected.z > -1 && projected.z < 1;
      const collision = occupied.some((box) =>
        Math.abs(x - box.x) < (labelWidth + box.w) / 2 + 10 && Math.abs(y - box.y) < (labelHeight + box.h) / 2 + 7
      );
      const visible = within && (!collision || Option.contains(selectedId, item.id));
      if (visible) occupied.push({ x, y, w: labelWidth, h: labelHeight });
      if (visible) {
        labels.push({
          id: item.id,
          text: item.text,
          kind: item.kind,
          x,
          y,
          visible,
          selected: Option.contains(selectedId, item.id),
          subtitle: item.subtitle,
        });
      }
      if (labels.length >= 75) break;
    }
    const key = labels.map((label) => `${label.id}:${label.x.toFixed(1)}:${label.y.toFixed(1)}:${label.selected}`).join(
      "|",
    );
    if (key !== lastLabelKey) {
      lastLabelKey = key;
      options.onLabels?.(labels);
    }
  }

  function continueAnimation(): void {
    if (animationMarkets.length > 0) invalidate(false);
  }

  function beginFrame(now: number): boolean {
    pendingFrame = 0;
    if (disposed) return false;
    const animationDue = animationMarkets.length > 0 && designAnimationDue(lastAnimationAt, now);
    if (!needsRender && !animationDue) {
      continueAnimation();
      return false;
    }
    needsRender = false;
    return true;
  }

  function advanceDesignAnimations(now: number): void {
    if (animationMarkets.length === 0 || !designAnimationDue(lastAnimationAt, now)) return;
    const seconds = now / 1000;
    const update = planDesignAnimation(layout, marketCache, animationMarkets, seconds);
    if (kit.update(update.parts)) layout = commitDesignAnimation(layout, marketCache, update, seconds);
    lastAnimationAt = now;
  }

  function render(now: number): void {
    if (!beginFrame(now)) return;
    const elapsed = Math.min(64, now - lastFrame);
    lastFrame = now;
    const factor = reducedMotion ? 1 : 1 - Math.exp(-elapsed / 90);
    const moving = Math.abs(zoom - targetZoom) > 0.002 || center.distanceToSquared(targetCenter) > 0.002;
    zoom += (targetZoom - zoom) * factor;
    center.lerp(targetCenter, factor);
    if (!moving) {
      zoom = targetZoom;
      center.copy(targetCenter);
    }
    updateCamera();
    const window = layoutWindow([center.x, center.z], zoom, width, height);
    if (!Option.exists(layout.window, value => value.key === window.key)) rebuild(true);
    advanceDesignAnimations(now);
    const level = levelOf(zoom);
    const detail = Math.min(detailCeiling, level === 0 ? 0 : level === 1 ? 1 : 3);
    kit.setDetail(detail);
    chart.visible = level <= 2;
    // Submission cost must use the browser performance clock used by the frame scheduler.
    // oxlint-disable-next-line effect/noGlobals -- Browser renderer timing shares the requestAnimationFrame timestamp origin.
    const start = performance.now();
    renderer.render(scene, camera);
    // oxlint-disable-next-line effect/noGlobals -- Browser renderer timing shares the requestAnimationFrame timestamp origin.
    const duration = performance.now() - start;
    sampledFrames++;
    sampledDuration += moving ? elapsed : duration;
    if (sampledFrames >= 20 && sampledDuration / sampledFrames > 20 && detailCeiling > 1) detailCeiling--;
    stats = {
      framesPerSecond: moving ? Math.round(1000 / Math.max(1, elapsed)) : 0,
      frameTimeMs: Number(duration.toFixed(2)),
      drawCalls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      parts: kit.partCount,
      markets: markets.length,
      detail,
      orangeParts,
      activeMarketId: Option.getOrNull(layout.activeId),
      tierCounts,
      instrumentTierCounts,
    };
    projectLabels();
    const view = getView();
    const viewKey = `${view.level}:${view.zoom.toFixed(2)}:${view.center[0].toFixed(1)}:${view.center[1].toFixed(1)}:${
      Option.getOrElse(selectedId, () => "")
    }`;
    if (viewKey !== previousViewKey) {
      previousViewKey = viewKey;
      options.onViewChange?.(view);
    }
    if (sampledFrames % 20 === 0 || !moving) options.onStats?.(stats);
    options.onFrame?.({
      revision,
      renderedAtMs: start + duration,
      stats,
      memory: { geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures },
    });
    if (moving) invalidate();
    else continueAnimation();
  }

  function invalidate(redraw = true): void {
    needsRender ||= redraw;
    if (!pendingFrame && !disposed) pendingFrame = requestAnimationFrame(render);
  }

  function rebuild(keepPlacement = false): void {
    const old = kit;
    layout = createLayout(markets, {
      lens,
      moorings,
      explodedId: exploded ? selectedId : Option.none(),
      activeMarketId,
      slots,
      tiers,
      adoptedDesigns,
      seconds: layout.drawingOptions.seconds ?? 0,
      window: layoutWindow([center.x, center.z], zoom, width, height),
      placement: keepPlacement ? Option.some(layout) : Option.none(),
      ...Option.match(evidence, { onNone: () => ({}), onSome: value => ({ evidence: value }) }),
    });
    orangeParts = layout.parts.filter((part) => part.material === "accent").length;
    marketCache = cacheMarkets(layout, markets);
    animationMarkets = animatedDesignMarkets(layout, marketCache, reducedMotion);
    tierCounts = { stall: 0, works: 0, tower: 0 };
    instrumentTierCounts = { stall: 0, works: 0, tower: 0 };
    for (const item of layout.markets) tierCounts[item.tier]++;
    for (const drawing of layout.marketDrawings) {
      const tier = marketCache.markets.get(drawing.marketId)?.position.tier;
      if (drawing.detail === "instrument" && tier) instrumentTierCounts[tier]++;
    }
    kit = new KitScene(layout.parts, theme, marketCache.keys);
    scene.remove(old.group);
    old.dispose();
    scene.add(kit.group);
    rebuildLinework();
    updateSelection();
    lastLabelKey = "";
    invalidate();
  }

  function updateMarkets(nextMarkets: readonly AtlasMarket[], nextActive: Option.Option<string>): boolean {
    const update = planMarketUpdate(layout, markets, nextMarkets, nextActive, marketCache);
    if (Option.isNone(update) || !kit.update(update.value.parts)) return false;
    const priorPaths = layout.paths;
    layout = commitMarketUpdate(layout, marketCache, update.value);
    if (priorPaths.length !== layout.paths.length || priorPaths.some((path, index) => path !== layout.paths[index])) {
      rebuildLinework();
    }
    markets = nextMarkets;
    activeMarketId = nextActive;
    orangeParts = layout.parts.filter(part => part.material === "accent").length;
    updateSelection();
    lastLabelKey = "";
    invalidate();
    return true;
  }

  function resize(): void {
    const rect = host.getBoundingClientRect();
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    renderer.setSize(width, height, false);
    updateCamera();
    invalidate();
  }

  function worldAt(clientX: number, clientY: number): Option.Option<THREE.Vector3> {
    const rect = canvas.getBoundingClientRect();
    const pointer = new THREE.Vector2((clientX - rect.left) / width * 2 - 1, -(clientY - rect.top) / height * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    return Option.fromNullishOr(raycaster.ray.intersectPlane(groundPlane, new THREE.Vector3()));
  }

  function marketAt(clientX: number, clientY: number): Option.Option<string> {
    const rect = canvas.getBoundingClientRect();
    const px = clientX - rect.left, py = clientY - rect.top;
    let closest = Option.none<{ id: string; distance: number }>();
    for (const item of layout.markets) {
      projected.set(item.x, item.height / 2, item.z).project(camera);
      const x = (projected.x * 0.5 + 0.5) * width;
      const y = (-projected.y * 0.5 + 0.5) * height;
      const distance = Math.hypot(x - px, y - py);
      const radius = Math.max(14, item.radius * height / 78 * zoom);
      if (distance <= radius && (Option.isNone(closest) || distance < closest.value.distance)) {
        closest = Option.some({ id: item.market.id, distance });
      }
    }
    return Option.map(closest, (value) => value.id);
  }

  let pointerId = Option.none<number>();
  let pointerStart = Option.none<{ x: number; y: number; world: THREE.Vector3; center: THREE.Vector3 }>();
  let dragged = false;
  function pointerDown(event: PointerEvent): void {
    if (event.button !== 0 || Option.isSome(pointerId)) return;
    const world = worldAt(event.clientX, event.clientY);
    if (Option.isNone(world)) return;
    pointerId = Option.some(event.pointerId);
    pointerStart = Option.some({
      x: event.clientX,
      y: event.clientY,
      world: world.value,
      center: targetCenter.clone(),
    });
    dragged = false;
    canvas.setPointerCapture(event.pointerId);
    canvas.style.cursor = "grabbing";
  }
  function pointerMove(event: PointerEvent): void {
    if (Option.contains(pointerId, event.pointerId) && Option.isSome(pointerStart)) {
      if (Math.hypot(event.clientX - pointerStart.value.x, event.clientY - pointerStart.value.y) > 4) dragged = true;
      if (dragged) {
        const scale = 78 / height / zoom;
        const dx = (event.clientX - pointerStart.value.x) * scale;
        const dy = (event.clientY - pointerStart.value.y) * scale * 2;
        targetCenter.set(
          pointerStart.value.center.x - dx / Math.SQRT2 + dy / Math.SQRT2,
          0,
          pointerStart.value.center.z + dx / Math.SQRT2 + dy / Math.SQRT2,
        );
        targetCenter.x = clamp(targetCenter.x, -layout.radius * 2, layout.radius * 2);
        targetCenter.z = clamp(targetCenter.z, -layout.radius * 2, layout.radius * 2);
        invalidate();
      }
    } else {
      const id = marketAt(event.clientX, event.clientY);
      if (!sameId(id, hoverId)) {
        hoverId = id;
        canvas.style.cursor = Option.isSome(id) ? "pointer" : "grab";
        updateSelection();
        options.onHover?.(Option.getOrNull(id));
        invalidate();
      }
    }
  }
  function pointerUp(event: PointerEvent): void {
    if (!Option.contains(pointerId, event.pointerId)) return;
    if (!dragged) {
      const id = marketAt(event.clientX, event.clientY);
      Option.map(id, (value) => options.onSelect?.(value));
    }
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    pointerId = Option.none();
    pointerStart = Option.none();
    canvas.style.cursor = "grab";
  }
  function pointerCancel(): void {
    pointerId = Option.none();
    pointerStart = Option.none();
    canvas.style.cursor = "grab";
  }
  function wheel(event: WheelEvent): void {
    event.preventDefault();
    targetZoom = clamp(targetZoom * Math.exp(-event.deltaY * 0.0016), 0.35, 10);
    invalidate();
  }
  function changeStep(direction: number): void {
    const level = clamp(levelOf(targetZoom) + direction, 0, steps.length - 1);
    targetZoom = steps[level] ?? 1;
    invalidate();
  }
  function keyDown(event: KeyboardEvent): void {
    const unit = 4 / zoom;
    let handled = true;
    switch (event.key) {
      case "+":
      case "=":
        changeStep(1);
        break;
      case "-":
        changeStep(-1);
        break;
      case "ArrowLeft":
        targetCenter.x -= unit;
        targetCenter.z += unit;
        break;
      case "ArrowRight":
        targetCenter.x += unit;
        targetCenter.z -= unit;
        break;
      case "ArrowUp":
        targetCenter.x -= unit;
        targetCenter.z -= unit;
        break;
      case "ArrowDown":
        targetCenter.x += unit;
        targetCenter.z += unit;
        break;
      case "Home":
        targetZoom = 1;
        targetCenter.set(0, 0, 3);
        break;
      default:
        handled = false;
    }
    if (handled) {
      event.preventDefault();
      invalidate();
    }
  }
  function contextLost(event: Event): void {
    event.preventDefault();
    options.onError?.(
      new AtlasRendererError({
        message:
          "The drawing's graphics context was interrupted. Reload to restore the atlas; source readings remain available in the market list.",
      }),
    );
  }

  const observer = new ResizeObserver(resize);
  observer.observe(host);
  canvas.addEventListener("pointerdown", pointerDown);
  canvas.addEventListener("pointermove", pointerMove);
  canvas.addEventListener("pointerup", pointerUp);
  canvas.addEventListener("pointercancel", pointerCancel);
  canvas.addEventListener("wheel", wheel, { passive: false });
  canvas.addEventListener("keydown", keyDown);
  canvas.addEventListener("webglcontextlost", contextLost);
  rebuildLinework();
  resize();

  return {
    canvas,
    setData(data) {
      const nextSlots = dataSlots(data);
      const initialData = markets.length === 0;
      const slotsUnchanged = sameSlots(slots, nextSlots);
      const identitiesUnchanged = sameMarketIds(markets, data.markets);
      const nextActive = Option.fromNullishOr(data.activeMarketId);
      const nextTiers = data.tiers ?? [];
      const tiersUnchanged = sameTiers(tiers, nextTiers);
      const valid = validateSnapshot(data, options, {
        slots: nextSlots,
        tiers: nextTiers,
        slotsUnchanged,
        identitiesUnchanged,
        tiersUnchanged,
      });
      if (Result.isFailure(valid)) return valid;
      const nextAdoptions = data.adoptedDesigns ?? [];
      const adoptionsUnchanged = sameAdoptions(adoptedDesigns, nextAdoptions);
      const nextEvidence = Option.map(Option.fromUndefinedOr(data.evidence), eligibleEvidence);
      const evidenceUnchanged = sameEvidence(evidence, nextEvidence);
      revision = data.revision ?? revision + 1;
      // Foldkit may supply newly allocated DTOs for an unchanged snapshot. Equal observations retain GPU resources.
      if (
        sameId(activeMarketId, nextActive) && sameMarkets(markets, data.markets) && slotsUnchanged
        && evidenceUnchanged && tiersUnchanged && adoptionsUnchanged
      ) {
        if (options.onFrame) invalidate();
        return Result.succeed(void 0);
      }
      if (
        slotsUnchanged && identitiesUnchanged && evidenceUnchanged && tiersUnchanged && adoptionsUnchanged
        && updateMarkets(data.markets, nextActive)
      ) {
        slots = nextSlots;
        evidence = nextEvidence;
        tiers = nextTiers;
        adoptedDesigns = nextAdoptions;
        return Result.succeed(void 0);
      }
      markets = data.markets;
      slots = nextSlots;
      tiers = nextTiers;
      adoptedDesigns = nextAdoptions;
      evidence = nextEvidence;
      activeMarketId = nextActive;
      selectedId = Option.filter(selectedId, (id) => markets.some((market) => market.id === id));
      rebuild();
      // Fit a newly opened large atlas once; subsequent observations must not undo the viewer's camera.
      if (initialData && markets.length > 100 && Option.isNone(selectedId)) {
        targetZoom = Math.min(1, 40 / layout.radius);
        invalidate();
      }
      return Result.succeed(void 0);
    },
    setSelected(id) {
      const nextSelected = Option.fromNullishOr(id);
      if (sameId(selectedId, nextSelected)) return;
      selectedId = nextSelected;
      if (exploded) rebuild();
      else {
        updateSelection();
        lastLabelKey = "";
        invalidate();
      }
    },
    setTheme(nextTheme) {
      if (theme === nextTheme) return;
      theme = nextTheme;
      scene.background = new THREE.Color(palette[theme].ground);
      renderer.setClearColor(palette[theme].ground);
      kit.setTheme(theme);
      chartMaterial.color.set(palette[theme].line);
      selectionMaterial.color.set(palette[theme].line);
      rebuildLinework();
      invalidate();
    },
    setExploded(value) {
      if (exploded === value) return;
      exploded = value;
      rebuild();
    },
    setReducedMotion(value) {
      if (reducedMotion === value) return;
      reducedMotion = value;
      animationMarkets = animatedDesignMarkets(layout, marketCache, reducedMotion);
      invalidate();
    },
    setLens(value) {
      if (lens === value) return;
      lens = value;
      rebuild();
    },
    setMoorings(ids) {
      const next = new Set(ids);
      if (next.size === moorings.size && ids.every((id) => moorings.has(id))) return;
      moorings = next;
      rebuild();
    },
    zoomIn() {
      changeStep(1);
    },
    zoomOut() {
      changeStep(-1);
    },
    focus(id) {
      const item = layout.markets.find((entry) => entry.market.id === id);
      if (item) {
        selectedId = Option.fromNullishOr(id);
        targetCenter.set(item.x, item.height * 0.34, item.z);
        targetZoom = 4.8;
        if (exploded) rebuild();
        else updateSelection();
      } else {
        targetCenter.set(0, 0, 3);
        targetZoom = 1;
      }
      invalidate();
    },
    resetView() {
      targetZoom = 1;
      targetCenter.set(0, 0, 3);
      invalidate();
    },
    exportPlate() {
      renderer.render(scene, camera);
      const plate = document.createElement("canvas");
      const margin = Math.round(32 * renderer.getPixelRatio());
      plate.width = canvas.width + margin * 2;
      plate.height = canvas.height + margin * 2;
      const context = plate.getContext("2d");
      if (!context) {
        return Result.fail(new AtlasRendererError({ message: "The plate could not obtain a drawing surface" }));
      }
      context.fillStyle = palette[theme].paper;
      context.fillRect(0, 0, plate.width, plate.height);
      context.drawImage(canvas, margin, margin);
      context.strokeStyle = palette[theme].line;
      context.lineWidth = renderer.getPixelRatio();
      context.strokeRect(margin / 2, margin / 2, plate.width - margin, plate.height - margin);
      return Result.succeed(plate.toDataURL("image/png"));
    },
    getView,
    getStats() {
      return stats;
    },
    destroy() {
      disposed = true;
      cancelAnimationFrame(pendingFrame);
      observer.disconnect();
      canvas.removeEventListener("pointerdown", pointerDown);
      canvas.removeEventListener("pointermove", pointerMove);
      canvas.removeEventListener("pointerup", pointerUp);
      canvas.removeEventListener("pointercancel", pointerCancel);
      canvas.removeEventListener("wheel", wheel);
      canvas.removeEventListener("keydown", keyDown);
      canvas.removeEventListener("webglcontextlost", contextLost);
      kit.dispose();
      Option.map(linework, (lines) => {
        lines.geometry.dispose();
        lines.material.dispose();
      });
      chartGeometry.dispose();
      chartMaterial.dispose();
      selectionGeometry.dispose();
      selectionMaterial.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}
