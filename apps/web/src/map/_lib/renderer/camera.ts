import { Option, Result } from "effect";
import type { Camera } from "../../model";
import { type Engine, listen, RendererFailure } from "./engine";

type Point = { readonly x: number; readonly y: number };
type Ground = { readonly x: number; readonly z: number };
interface Drag {
  readonly anchor: Ground;
  readonly origin: Point;
  last: Point;
  at: number;
  velocity: Ground;
  moved: boolean;
}
interface Flight {
  readonly from: Camera;
  readonly to: Camera;
  readonly start: number;
  readonly duration: number;
  readonly history: boolean;
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const cameraRungs = { building: 21, floor: 12, desk: 7 };
const limitedExtent = (extent: number) => Math.max(4, Math.min(1200, extent));

export const openCamera = (
  engine: Engine,
  nowMonotonicMs: () => number,
  onRest: (camera: Camera, history: boolean) => void,
  onSelect: (x: number, y: number) => void,
  onFailure: (error: RendererFailure) => void,
) => {
  const pointers = new Map<number, Point>();
  interface CameraState {
    paused: boolean;
    following: boolean;
    maybeDrag: Option.Option<Drag>;
    maybeFlight: Option.Option<Flight>;
    maybeGlide: Option.Option<{ velocity: Ground; at: number }>;
    maybePinch: Option.Option<{ readonly distance: number; readonly extent: number; readonly anchor: Ground }>;
    maybeTap: Option.Option<{ point: Point; at: number }>;
    multiple: boolean;
    multiMoved: boolean;
    multiStarted: number;
    pointerEvents: number;
    restCommits: number;
  }
  const state: CameraState = {
    paused: false,
    following: false,
    maybeDrag: Option.none(),
    maybeFlight: Option.none(),
    maybeGlide: Option.none(),
    maybePinch: Option.none(),
    maybeTap: Option.none(),
    multiple: false,
    multiMoved: false,
    multiStarted: 0,
    pointerEvents: 0,
    restCommits: 0,
  };
  const read = () => engine.inspect().camera;
  const rest = (history = true) => {
    state.restCommits++;
    onRest(read(), history);
  };
  const stop = () => {
    state.following = false;
    state.maybeFlight = Option.none();
    state.maybeGlide = Option.none();
  };
  const guard = (run: () => void) => {
    const result = Result.try(run);
    if (Result.isFailure(result)) {
      state.paused = true;
      stop();
      pointers.clear();
      state.maybeDrag = Option.none();
      state.maybePinch = Option.none();
      onFailure(new RendererFailure({ operation: "camera-input", cause: result.failure }));
    }
  };
  const listenInput = <K extends keyof HTMLElementEventMap>(
    event: K,
    handler: (event: HTMLElementEventMap[K]) => void,
    options?: AddEventListenerOptions,
  ) => listen(engine.ledger, engine.canvas, event, input => guard(() => handler(input)), options);
  const local = (event: PointerEvent): Point => {
    const rect = engine.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const soft = (value: number) => {
    const bound = engine.inspect().desks > 12 ? 80 : 25;
    const excess = Math.max(0, Math.abs(value) - bound);
    return excess === 0 ? value : Math.sign(value) * (bound + 12 * Math.tanh(excess / 12));
  };
  const place = (view: Camera) =>
    engine.setCamera({ x: soft(view.x), z: soft(view.z), extent: limitedExtent(view.extent) });
  const anchor = (point: Point, ground: Ground, extent: number) => {
    const view = read();
    engine.setCamera({ x: view.x, z: view.z, extent: limitedExtent(extent) });
    const under = engine.groundAt(point.x, point.y);
    place({ x: view.x + ground.x - under.x, z: view.z + ground.z - under.z, extent: limitedExtent(extent) });
  };
  const zoom = (point: Point, factor: number) => {
    if (state.paused) return;
    stop();
    const ground = engine.groundAt(point.x, point.y);
    anchor(point, ground, read().extent * factor);
    engine.draw();
    rest();
  };
  const fly = (to: Camera, history = true, duration = 900) => {
    if (state.paused) return;
    stop();
    state.maybeFlight = Option.some({
      from: read(),
      to,
      start: nowMonotonicMs(),
      duration: Math.max(600, Math.min(1200, duration)),
      history,
    });
  };
  const up = () =>
    fly({
      ...read(),
      extent: [4, cameraRungs.desk, cameraRungs.floor, cameraRungs.building, 80, 380, 1200].find(extent =>
        extent > read().extent + .001
      ) ?? 1200,
    });
  const pair = () => {
    const values = [...pointers.values()];
    const first = values[0];
    const second = values[1];
    if (!first || !second) return Option.none<{ distance: number; point: Point }>();
    return Option.some({
      distance: Math.hypot(first.x - second.x, first.y - second.y),
      point: { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 },
    });
  };
  const removers = [
    listenInput("pointerdown", event => {
      if (state.paused || event.button !== 0) return;
      event.preventDefault();
      engine.canvas.focus({ preventScroll: true });
      stop();
      const point = local(event);
      pointers.set(event.pointerId, point);
      engine.canvas.setPointerCapture(event.pointerId);
      state.maybeDrag = Option.some({
        anchor: engine.groundAt(point.x, point.y),
        origin: point,
        last: point,
        at: nowMonotonicMs(),
        velocity: { x: 0, z: 0 },
        moved: false,
      });
      const currentPair = pair();
      if (Option.isSome(currentPair)) {
        state.multiple = true;
        state.multiMoved = false;
        state.multiStarted = nowMonotonicMs();
        state.maybePinch = Option.some({
          distance: currentPair.value.distance,
          extent: read().extent,
          anchor: engine.groundAt(currentPair.value.point.x, currentPair.value.point.y),
        });
      }
    }),
    listenInput("pointermove", event => {
      if (state.paused || !pointers.has(event.pointerId)) return;
      event.preventDefault();
      state.pointerEvents++;
      const point = local(event);
      pointers.set(event.pointerId, point);
      const currentPair = pair();
      if (Option.isSome(currentPair) && Option.isSome(state.maybePinch)) {
        state.multiMoved = true;
        const pinch = state.maybePinch.value;
        anchor(
          currentPair.value.point,
          pinch.anchor,
          pinch.extent * pinch.distance / Math.max(1, currentPair.value.distance),
        );
      } else if (!state.multiple && Option.isSome(state.maybeDrag)) {
        const drag = state.maybeDrag.value;
        const before = read();
        anchor(point, drag.anchor, before.extent);
        const elapsed = Math.max(1, nowMonotonicMs() - drag.at);
        const after = read();
        drag.velocity = { x: (after.x - before.x) / elapsed, z: (after.z - before.z) / elapsed };
        drag.moved = drag.moved || Math.hypot(point.x - drag.origin.x, point.y - drag.origin.y) > 3;
        drag.last = point;
        drag.at = nowMonotonicMs();
      }
      engine.draw();
    }),
    listenInput("pointerup", event => {
      if (!pointers.has(event.pointerId)) return;
      event.preventDefault();
      pointers.delete(event.pointerId);
      if (engine.canvas.hasPointerCapture(event.pointerId)) engine.canvas.releasePointerCapture(event.pointerId);
      if (state.multiple) {
        if (pointers.size === 0) {
          if (!state.multiMoved && nowMonotonicMs() - state.multiStarted < 300) up();
          else rest();
          state.multiple = false;
          state.maybePinch = Option.none();
          state.maybeDrag = Option.none();
        }
        return;
      }
      if (Option.isSome(state.maybeDrag)) {
        const drag = state.maybeDrag.value;
        const point = local(event);
        if (!drag.moved) {
          if (
            event.pointerType === "touch" && Option.isSome(state.maybeTap)
            && nowMonotonicMs() - state.maybeTap.value.at < 320
            && Math.hypot(point.x - state.maybeTap.value.point.x, point.y - state.maybeTap.value.point.y) < 25
          ) {
            zoom(point, .6);
            state.maybeTap = Option.none();
          } else {
            onSelect(point.x, point.y);
            state.maybeTap = Option.some({ point, at: nowMonotonicMs() });
          }
        } else if (
          nowMonotonicMs() - drag.at < 80 && Math.hypot(drag.velocity.x, drag.velocity.z) > read().extent / 10000
        ) {
          state.maybeGlide = Option.some({ velocity: drag.velocity, at: nowMonotonicMs() });
        } else rest();
        state.maybeDrag = Option.none();
      }
    }),
    listenInput("pointercancel", event => {
      if (state.paused || !pointers.has(event.pointerId)) return;
      pointers.clear();
      state.maybeDrag = Option.none();
      state.maybePinch = Option.none();
      state.multiple = false;
      stop();
      rest();
    }),
    listenInput("wheel", event => {
      if (state.paused) return;
      event.preventDefault();
      stop();
      const rect = engine.canvas.getBoundingClientRect();
      const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      const pan = !event.ctrlKey
        && (event.shiftKey || event.deltaX !== 0 || (event.deltaMode === 0 && Math.abs(event.deltaY) < 50));
      if (pan) {
        const before = engine.groundAt(point.x, point.y);
        const after = engine.groundAt(point.x + event.deltaX, point.y + event.deltaY);
        const view = read();
        place({ x: view.x + after.x - before.x, z: view.z + after.z - before.z, extent: view.extent });
        engine.draw();
        rest();
      } else zoom(point, Math.exp(event.deltaY * .0015));
    }, { passive: false }),
    listenInput("dblclick", event => {
      const rect = engine.canvas.getBoundingClientRect();
      zoom({ x: event.clientX - rect.left, y: event.clientY - rect.top }, .6);
    }),
    listenInput("keydown", event => {
      if (!state.paused) {
        stop();
        if (event.key === "Escape") {
          event.preventDefault();
          up();
        }
      }
    }),
  ];
  const pop = () =>
    guard(() => {
      const query = new URL(location.href).searchParams;
      const x = Number(query.get("x"));
      const z = Number(query.get("z"));
      const extent = Number(query.get("extent"));
      if ([x, z, extent].every(Number.isFinite) && extent > 0) fly({ x, z, extent }, false);
    });
  window.addEventListener("popstate", pop);
  engine.ledger.listeners++;
  const tick = () => {
    if (state.paused) return;
    if (Option.isSome(state.maybeFlight)) {
      const flight = state.maybeFlight.value;
      const t = Math.min(1, (nowMonotonicMs() - flight.start) / flight.duration);
      const ease = t * t * (3 - 2 * t);
      engine.setCamera({
        x: lerp(flight.from.x, flight.to.x, ease),
        z: lerp(flight.from.z, flight.to.z, ease),
        extent: lerp(flight.from.extent, flight.to.extent, ease)
          + Math.max(flight.from.extent, flight.to.extent) * .2 * Math.sin(Math.PI * t),
      });
      if (t === 1) {
        state.maybeFlight = Option.none();
        engine.setCamera(flight.to);
        rest(flight.history);
      }
    } else if (Option.isSome(state.maybeGlide)) {
      const glide = state.maybeGlide.value;
      const dt = Math.min(50, nowMonotonicMs() - glide.at);
      glide.at = nowMonotonicMs();
      const view = read();
      place({ x: view.x + glide.velocity.x * dt, z: view.z + glide.velocity.z * dt, extent: view.extent });
      const damping = Math.exp(-dt / 140);
      glide.velocity = { x: glide.velocity.x * damping, z: glide.velocity.z * damping };
      if (Math.hypot(glide.velocity.x, glide.velocity.z) < view.extent / 100000) {
        state.maybeGlide = Option.none();
        rest();
      }
    }
    engine.draw();
  };
  return {
    fly,
    tick,
    up,
    follow: (camera: Camera) => {
      fly(camera);
      state.following = true;
    },
    pause: (paused: boolean) => {
      state.paused = paused;
      if (paused) {
        stop();
        pointers.clear();
        state.maybeDrag = Option.none();
        state.maybePinch = Option.none();
      }
    },
    busy: () => pointers.size > 0 || Option.isSome(state.maybeFlight) || Option.isSome(state.maybeGlide),
    inspect: () => ({
      following: state.following,
      paused: state.paused,
      flying: Option.isSome(state.maybeFlight),
      gliding: Option.isSome(state.maybeGlide),
      pointerEvents: state.pointerEvents,
      restCommits: state.restCommits,
    }),
    dispose: () => {
      removers.forEach(remove => remove());
      window.removeEventListener("popstate", pop);
      engine.ledger.listeners--;
      pointers.clear();
      stop();
    },
  };
};
