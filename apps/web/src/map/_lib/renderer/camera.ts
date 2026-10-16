import { cameraFlight, cameraRungs } from "@floor/atlas/camera";
export { cameraRungs } from "@floor/atlas/camera";
import { Data, Option, Result } from "effect";
import { type Camera, cameraFromQuery, type GroundArea, type Rotation, type Turn } from "../../model";
import { type Engine, RendererFailure } from "./engine";

type Point = { readonly x: number; readonly y: number };
type Ground = { readonly x: number; readonly z: number };
type FollowTarget = () => Option.Option<Camera>;
type Motion = Data.TaggedEnum<{
  Idle: {};
  Drag: { readonly anchor: Ground; readonly origin: Point; at: number; velocity: Ground; moved: boolean };
  Pinch: {
    readonly distance: number;
    readonly extent: number;
    readonly anchor: Ground;
    readonly start: number;
    moved: boolean;
  };
  Flight: {
    readonly from: Camera;
    readonly to: Camera;
    readonly start: number;
    readonly duration: number;
    readonly history: boolean;
    readonly following: boolean;
    readonly target: Option.Option<FollowTarget>;
  };
  Glide: { velocity: Ground; at: number };
  Follow: { readonly read: FollowTarget; needsRest: boolean };
}>;
interface CameraState {
  paused: boolean;
  motion: Motion;
  tap: Option.Option<{ readonly point: Point; readonly at: number }>;
  revision: number;
}
const Motion = Data.taggedEnum<Motion>();
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const limitedExtent = (extent: number) => Math.max(4, Math.min(1200, extent));
// The synthetic test room keeps its original symmetric reach.
export const syntheticBounds = (desks: number): GroundArea => {
  const bound = desks > 12 ? 80 : 25;
  return { x0: -bound, z0: -bound, x1: bound, z1: bound };
};
// Past an edge, panning resists asymptotically instead of stopping dead.
const soft = (value: number, low: number, high: number) =>
  value > high
    ? high + 12 * Math.tanh((value - high) / 12)
    : value < low
    ? low - 12 * Math.tanh((low - value) / 12)
    : value;
const rightTurn: Readonly<Record<Rotation, Rotation>> = { 0: 1, 1: 2, 2: 3, 3: 0 };
const leftTurn: Readonly<Record<Rotation, Rotation>> = { 0: 3, 1: 0, 2: 1, 3: 2 };

export const openCamera = (
  engine: Engine,
  bounds: GroundArea,
  nowMonotonicMs: () => number,
  onRest: (camera: Camera, history: boolean) => void,
  onSelect: (x: number, y: number) => void,
  onFailure: (error: RendererFailure) => void,
) => {
  const { canvas, read, set, groundAt } = engine.camera;
  const pointers = new Map<number, Point>();
  const state: CameraState = { paused: false, motion: Motion.Idle(), tap: Option.none(), revision: 0 };
  const rest = (history = true) => {
    state.revision++;
    onRest(read(), history);
  };
  const stop = () => {
    state.motion = Motion.Idle();
  };
  const releasePointers = () => {
    pointers.forEach((_, id) => {
      if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
    });
    pointers.clear();
  };
  const autonomous = () => ["Flight", "Follow", "Glide"].includes(state.motion._tag);
  const guard = (run: () => void) => {
    const result = Result.try(run);
    if (Result.isFailure(result)) {
      state.paused = true;
      stop();
      pointers.clear();
      onFailure(new RendererFailure({ operation: "camera-input", cause: result.failure }));
    }
  };
  const listenInput = <K extends keyof HTMLElementEventMap>(
    event: K,
    handler: (event: HTMLElementEventMap[K]) => void,
    options?: AddEventListenerOptions,
  ) => {
    const listener = (input: HTMLElementEventMap[K]) => guard(() => handler(input));
    canvas.addEventListener(event, listener, options);
    return () => canvas.removeEventListener(event, listener, options);
  };
  const local = (event: PointerEvent): Point => {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const place = (view: Camera) =>
    set({
      ...view,
      x: soft(view.x, bounds.x0, bounds.x1),
      z: soft(view.z, bounds.z0, bounds.z1),
      extent: limitedExtent(view.extent),
    });
  const anchor = (point: Point, ground: Ground, extent: number) => {
    const view = read();
    set({ ...view, extent: limitedExtent(extent) });
    const under = groundAt(point.x, point.y);
    place({ ...view, x: view.x + ground.x - under.x, z: view.z + ground.z - under.z, extent: limitedExtent(extent) });
  };
  const zoom = (point: Point, factor: number) => {
    if (state.paused) return;
    stop();
    anchor(point, groundAt(point.x, point.y), read().extent * factor);
    engine.draw();
    rest();
  };
  const fly = (
    to: Camera,
    history = true,
    duration = cameraFlight.defaultMs,
    following = false,
    target = Option.none<FollowTarget>(),
  ) => {
    if (state.paused) return;
    releasePointers();
    state.motion = Motion.Flight({
      from: read(),
      to,
      start: nowMonotonicMs(),
      duration: Math.max(cameraFlight.minimumMs, Math.min(cameraFlight.maximumMs, duration)),
      history,
      following,
      target,
    });
  };
  const rotate = (direction: Turn) => {
    if (state.paused) return;
    stop();
    // A turn ends the gesture: its old ground anchor belongs to a different basis.
    releasePointers();
    state.tap = Option.none();
    const view = read();
    set({ ...view, rotation: (direction === "right" ? rightTurn : leftTurn)[view.rotation] });
    engine.draw();
    rest();
  };
  const up = () =>
    fly({
      ...read(),
      extent: [4, cameraRungs.desk, cameraRungs.floor, cameraRungs.building, 80, 380, 1200]
        .find(extent => extent > read().extent + .001) ?? 1200,
    });
  const pair = () => {
    const [first, second] = pointers.values();
    return first && second
      ? Option.some({
        distance: Math.hypot(first.x - second.x, first.y - second.y),
        point: { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 },
      })
      : Option.none();
  };
  const removers = [
    listenInput("pointerdown", event => {
      if (state.paused || event.button !== 0) return;
      event.preventDefault();
      canvas.focus({ preventScroll: true });
      const interrupted = autonomous();
      stop();
      // A click can cancel a flight without a later drag-rest event.
      if (interrupted) rest(false);
      const point = local(event);
      pointers.set(event.pointerId, point);
      canvas.setPointerCapture(event.pointerId);
      const currentPair = pair();
      state.motion = Option.isSome(currentPair)
        ? Motion.Pinch({
          distance: currentPair.value.distance,
          extent: read().extent,
          anchor: groundAt(currentPair.value.point.x, currentPair.value.point.y),
          start: nowMonotonicMs(),
          moved: false,
        })
        : Motion.Drag({
          anchor: groundAt(point.x, point.y),
          origin: point,
          at: nowMonotonicMs(),
          velocity: { x: 0, z: 0 },
          moved: false,
        });
    }),
    listenInput("pointermove", event => {
      if (state.paused || !pointers.has(event.pointerId)) return;
      event.preventDefault();
      const point = local(event);
      pointers.set(event.pointerId, point);
      const motion = state.motion;
      if (motion._tag === "Pinch") {
        const currentPair = pair();
        if (Option.isSome(currentPair)) {
          state.motion = Motion.Pinch({ ...motion, moved: true });
          anchor(
            currentPair.value.point,
            motion.anchor,
            motion.extent * motion.distance / Math.max(1, currentPair.value.distance),
          );
        }
      } else if (motion._tag === "Drag") {
        const before = read();
        anchor(point, motion.anchor, before.extent);
        const elapsed = Math.max(1, nowMonotonicMs() - motion.at);
        const after = read();
        state.motion = Motion.Drag({
          ...motion,
          velocity: { x: (after.x - before.x) / elapsed, z: (after.z - before.z) / elapsed },
          moved: motion.moved || Math.hypot(point.x - motion.origin.x, point.y - motion.origin.y) > 3,
          at: nowMonotonicMs(),
        });
      }
      engine.draw();
    }),
    listenInput("pointerup", event => {
      if (!pointers.has(event.pointerId)) return;
      event.preventDefault();
      pointers.delete(event.pointerId);
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      const motion = state.motion;
      if (motion._tag === "Pinch") {
        if (pointers.size === 0) {
          stop();
          if (!motion.moved && nowMonotonicMs() - motion.start < 300) up();
          else rest();
        }
      } else if (motion._tag === "Drag") {
        stop();
        const point = local(event);
        if (!motion.moved) {
          if (
            event.pointerType === "touch" && Option.isSome(state.tap)
            && nowMonotonicMs() - state.tap.value.at < 320
            && Math.hypot(point.x - state.tap.value.point.x, point.y - state.tap.value.point.y) < 25
          ) {
            zoom(point, .6);
            state.tap = Option.none();
          } else {
            onSelect(point.x, point.y);
            state.tap = Option.some({ point, at: nowMonotonicMs() });
          }
        } else if (
          nowMonotonicMs() - motion.at < 80
          && Math.hypot(motion.velocity.x, motion.velocity.z) > read().extent / 10000
        ) {
          state.motion = Motion.Glide({ velocity: motion.velocity, at: nowMonotonicMs() });
        } else rest();
      }
    }),
    listenInput("pointercancel", event => {
      if (state.paused || !pointers.has(event.pointerId)) return;
      releasePointers();
      stop();
      rest();
    }),
    listenInput("wheel", event => {
      if (state.paused) return;
      event.preventDefault();
      stop();
      releasePointers();
      const rect = canvas.getBoundingClientRect();
      const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      const pan = !event.ctrlKey
        && (event.shiftKey || event.deltaX !== 0 || (event.deltaMode === 0 && Math.abs(event.deltaY) < 50));
      if (pan) {
        const before = groundAt(point.x, point.y);
        const after = groundAt(point.x + event.deltaX, point.y + event.deltaY);
        const view = read();
        place({ ...view, x: view.x + after.x - before.x, z: view.z + after.z - before.z });
        engine.draw();
        rest();
      } else zoom(point, Math.exp(event.deltaY * .0015));
    }, { passive: false }),
    listenInput("dblclick", event => {
      const rect = canvas.getBoundingClientRect();
      zoom({ x: event.clientX - rect.left, y: event.clientY - rect.top }, .6);
    }),
    listenInput("keydown", event => {
      if (state.paused) return;
      const interrupted = autonomous();
      if (
        !event.altKey && !event.ctrlKey && !event.metaKey
        && (event.key.toLowerCase() === "q" || event.key.toLowerCase() === "e")
      ) {
        event.preventDefault();
        if (!event.repeat) rotate(event.key.toLowerCase() === "q" ? "left" : "right");
        else if (interrupted) {
          stop();
          rest(false);
        }
      } else if (event.key === "Escape") {
        event.preventDefault();
        up();
      } else if (interrupted) {
        stop();
        rest(false);
      }
    }),
  ];
  const pop = () =>
    guard(() => {
      const camera = cameraFromQuery(new URL(location.href).searchParams);
      if (Option.isSome(camera)) fly(camera.value, false);
    });
  window.addEventListener("popstate", pop);
  const tick = () => {
    if (state.paused) return;
    const motion = state.motion;
    if (motion._tag === "Flight") {
      const target = Option.match(motion.target, {
        onNone: () => Option.some(motion.to),
        onSome: readTarget => readTarget(),
      });
      if (Option.isNone(target)) {
        stop();
        rest(false);
      } else {
        // Retarget the original flight clock so a moving target still arrives.
        const to = target.value;
        const t = Math.min(1, (nowMonotonicMs() - motion.start) / motion.duration);
        const ease = t * t * (3 - 2 * t);
        set({
          rotation: to.rotation,
          x: lerp(motion.from.x, to.x, ease),
          z: lerp(motion.from.z, to.z, ease),
          extent: lerp(motion.from.extent, to.extent, ease)
            + Math.max(motion.from.extent, to.extent) * cameraFlight.arc * Math.sin(Math.PI * t),
        });
        if (t === 1) {
          state.motion = Option.match(motion.target, {
            onNone: (): Motion => Motion.Idle(),
            onSome: (readTarget): Motion => Motion.Follow({ read: readTarget, needsRest: false }),
          });
          set(to);
          rest(motion.history);
        }
      }
    } else if (motion._tag === "Follow") {
      const target = motion.read();
      if (Option.isNone(target)) {
        stop();
        rest(false);
      } else {
        const view = read();
        if (
          view.x !== target.value.x || view.z !== target.value.z || view.extent !== target.value.extent
          || view.rotation !== target.value.rotation
        ) {
          set(target.value);
          state.motion = Motion.Follow({ read: motion.read, needsRest: true });
        } else if (motion.needsRest) {
          // Only a settled follow enters the Model and URL, like a settled drag.
          state.motion = Motion.Follow({ read: motion.read, needsRest: false });
          rest(false);
        }
      }
    } else if (motion._tag === "Glide") {
      const dt = Math.min(50, nowMonotonicMs() - motion.at);
      const view = read();
      place({ ...view, x: view.x + motion.velocity.x * dt, z: view.z + motion.velocity.z * dt });
      const damping = Math.exp(-dt / 140);
      const velocity = { x: motion.velocity.x * damping, z: motion.velocity.z * damping };
      state.motion = Motion.Glide({ velocity, at: nowMonotonicMs() });
      if (Math.hypot(velocity.x, velocity.z) < view.extent / 100000) {
        stop();
        rest();
      }
    }
    engine.draw();
  };
  return {
    fly,
    rotate,
    tick,
    up,
    follow: (camera: Camera) => fly(camera, true, cameraFlight.defaultMs, true),
    followTarget: (readTarget: FollowTarget) => {
      if (state.paused) return;
      const target = readTarget();
      if (Option.isSome(target)) fly(target.value, true, cameraFlight.defaultMs, true, Option.some(readTarget));
    },
    pause: (paused: boolean) => {
      state.paused = paused;
      if (paused) {
        stop();
        releasePointers();
      }
    },
    busy: () => state.motion._tag !== "Idle" || pointers.size > 0,
    revision: () => state.revision,
    inspect: () => ({
      following: state.motion._tag === "Follow" || (state.motion._tag === "Flight" && state.motion.following),
      paused: state.paused,
      flying: state.motion._tag === "Flight",
      gliding: state.motion._tag === "Glide",
    }),
    dispose: () => {
      removers.forEach(remove => remove());
      window.removeEventListener("popstate", pop);
      releasePointers();
      stop();
    },
  };
};
