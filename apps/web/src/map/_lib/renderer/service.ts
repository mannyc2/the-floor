import {
  Clock,
  Context,
  Deferred,
  Effect,
  Exit,
  Layer,
  Option,
  Queue,
  Ref,
  Result,
  Schema,
  Scope,
  Semaphore,
  Stream,
} from "effect";
import { Mount } from "foldkit";
import { Message } from "../../message";
import { type Camera, fault, type MapFault, Presentation, type Turn } from "../../model";
import type { openCamera } from "./camera";
import type { Engine } from "./engine";

type MountMessage =
  | typeof Message.SucceededMountMap.Type
  | typeof Message.FailedMap.Type
  | typeof Message.AppliedFrame.Type
  | typeof Message.SelectedEntity.Type
  | typeof Message.RestedCamera.Type;
interface RendererService {
  snapshot: (
    input: Schema.Json,
  ) => Effect.Effect<Effect.Success<ReturnType<Engine["internals"]["instances"]["snapshot"]>>, MapFault>;
  readonly present: (
    presentation: Presentation,
    fromHistory?: boolean,
    retainCamera?: boolean,
  ) => Effect.Effect<void, MapFault>;
  readonly fly: (camera: Camera, follow: boolean) => Effect.Effect<void, MapFault>;
  readonly followTarget: (readTarget: () => Option.Option<Camera>) => Effect.Effect<void, MapFault>;
  readonly rotate: (direction: Turn) => Effect.Effect<void, MapFault>;
  readonly pause: (paused: boolean) => Effect.Effect<void, MapFault>;
}
export interface Mounted {
  readonly generation: number;
  readonly engine: Engine;
  readonly camera: ReturnType<typeof openCamera>;
  readonly service: RendererService;
  readonly driver: { pump: Effect.Effect<void, MapFault> };
}
interface FrameState {
  sequence: number;
  applied: number;
  mode: "Live" | "Paused";
  pending: Option.Option<
    { readonly presentation: Presentation; readonly cameraCommits: number; readonly retainCamera: boolean }
  >;
}
interface MountOptions {
  readonly element: HTMLElement;
  readonly desks: number;
  readonly initial: Presentation;
  readonly queue: Queue.Enqueue<MountMessage>;
  readonly viewStateChanges: Stream.Stream<Mount.ViewState>;
}
interface Configuration {
  readonly preserveDrawingBuffer?: boolean;
  readonly mounted?: (mounted: Mounted, options: MountOptions) => Effect.Effect<void, MapFault, Scope.Scope>;
}
const nativeCall = <A>(phase: MapFault["phase"], run: () => A) =>
  Effect.try({ try: run, catch: cause => fault(phase, cause) });
const report = (queue: Queue.Enqueue<MountMessage>, error: MapFault) =>
  Effect.sync(() => {
    Queue.offerUnsafe(queue, Message.FailedMap({ reason: error.message }));
  });
const nextFrame = Effect.callback<void>(resume => {
  const id = requestAnimationFrame(() => resume(Effect.void));
  return Effect.sync(() => cancelAnimationFrame(id));
});
const loadEngine = Effect.tryPromise({
  // oxlint-disable-next-line effect/noDynamicImports -- The renderer is a measured deferred browser entry; static imports exceed the shell budget.
  try: () => import("./engine"),
  catch: cause => fault("renderer-import", cause),
});
const loadCamera = Effect.tryPromise({
  // oxlint-disable-next-line effect/noDynamicImports -- The camera shares the renderer's deferred acquisition boundary.
  try: () => import("./camera"),
  catch: cause => fault("camera-import", cause),
});

const acquire = Effect.fn("Renderer.acquire")(
  function*(options: MountOptions, generation: number, configuration: Configuration) {
    const { element, initial, queue } = options;
    const engineModule = yield* loadEngine;
    const cameraModule = yield* loadCamera;
    const clock = yield* Clock.Clock;
    const now = () => Number(clock.monotonicTimeNanosUnsafe()) / 1e6;
    const failure = yield* Deferred.make<never, MapFault>();
    const live = () => !Deferred.isDoneUnsafe(failure);
    const failedNative = (error: MapFault) => {
      Deferred.doneUnsafe(failure, Effect.fail(error));
    };
    const engine = yield* engineModule.openEngine(element, options.desks, initial, now, {
      preserveDrawingBuffer: configuration.preserveDrawingBuffer ?? false,
      active: live,
      failed: error => failedNative(fault("renderer-callback", error)),
    }).pipe(Effect.catchCause(cause => Effect.fail(fault("webgl-open", cause))));
    const frame: FrameState = {
      sequence: 0,
      applied: -1,
      mode: "Live",
      pending: Option.none<
        { readonly presentation: Presentation; readonly cameraCommits: number; readonly retainCamera: boolean }
      >(),
    };
    const camera = yield* Effect.acquireRelease(
      nativeCall("camera-open", () =>
        cameraModule.openCamera(engine, options.desks, now, (view, history) => {
          if (live() && frame.mode === "Live") {
            Queue.offerUnsafe(queue, Message.RestedCamera({ camera: view, history }));
          }
        }, (x, y) => {
          if (
            live() && frame.mode === "Live" && !engine.internals.renderer.getContext().isContextLost()
            && frame.applied === frame.sequence
          ) {
            const picked = Result.try({ try: () => engine.pick(x, y), catch: cause => fault("pick", cause) });
            if (Result.isFailure(picked)) failedNative(picked.failure);
            else {Queue.offerUnsafe(
                queue,
                Message.SelectedEntity({ entity: picked.success > 0 ? Option.some(picked.success) : Option.none() }),
              );}
          }
        }, error => failedNative(fault("camera-input", error)))),
      resource => nativeCall("camera-close", () => resource.dispose()).pipe(Effect.orDie),
    );
    const available = <A>(use: () => Effect.Effect<A, MapFault>) =>
      Effect.suspend(() =>
        live() ? use() : Effect.fail(fault("poisoned-display", "A failed frame requires a new Mount"))
      );
    const present = Effect.fn("Renderer.present")(
      function*(presentation: Presentation, fromHistory: boolean = false, retainCamera: boolean = false) {
        if (!live()) return yield* fault("poisoned-display", "A failed frame requires a new Mount");
        if (frame.mode === "Paused" && !fromHistory) return yield* Effect.void;
        // Decode once to own the accepted value; caller mutations cannot alter a queued frame.
        const accepted = yield* Schema.decodeEffect(Presentation)(presentation).pipe(
          Effect.mapError(cause => fault("presentation", cause)),
        );
        frame.sequence++;
        frame.pending = Option.some({ presentation: accepted, cameraCommits: camera.revision(), retainCamera });
        return yield* Effect.void;
      },
    );
    const pump = Effect.gen(function*() {
      if (!live()) return;
      if (Option.isSome(frame.pending) && !engine.internals.renderer.getContext().isContextLost()) {
        const pending = frame.pending.value;
        const sequence = frame.sequence;
        const result = yield* nativeCall("draw", () => {
          // Input can settle after acceptance. Such a frame still owns its data,
          // while the newer resting camera retains the view until historical replay.
          engine.apply(
            pending.presentation,
            frame.mode === "Paused"
              || (!pending.retainCamera && !camera.busy() && pending.cameraCommits === camera.revision()),
          );
          return engine.draw();
        });
        if (!live() || !result.drawn || sequence !== frame.sequence) return;
        frame.pending = Option.none();
        frame.applied = frame.sequence;
        Queue.offerUnsafe(queue, Message.AppliedFrame({ generation, sequence: frame.sequence }));
      }
      yield* nativeCall("advance", () => {
        if (frame.mode === "Live") engine.internals.advance();
        camera.tick();
      });
    });
    const service: RendererService = {
      snapshot: input =>
        available(() =>
          frame.mode === "Paused"
            ? Effect.fail(fault("inactive-snapshot", "Renderer is not live"))
            : engine.internals.instances.snapshot(input).pipe(
              Effect.mapError(cause => fault("instance-snapshot", cause)),
            )
        ),
      present,
      rotate: direction => available(() => nativeCall("camera-rotation", () => camera.rotate(direction))),
      fly: (view, follow) =>
        available(() => nativeCall("camera-flight", () => follow ? camera.follow(view) : camera.fly(view))),
      followTarget: readTarget =>
        available(() => nativeCall("camera-follow-target", () => camera.followTarget(readTarget))),
      pause: paused =>
        nativeCall("camera-pause", () => {
          frame.mode = paused ? "Paused" : "Live";
          camera.pause(paused || !live());
        }),
    };
    const mounted: Mounted = { generation, engine, camera, service, driver: { pump } };
    if (configuration.mounted) yield* configuration.mounted(mounted, options);
    yield* present(initial);
    yield* nextFrame.pipe(
      Effect.andThen(Effect.suspend(() => mounted.driver.pump)),
      Effect.forever,
      Effect.catch(error => Effect.sync(() => failedNative(error))),
      Effect.forkScoped,
    );
    const gl = engine.internals.renderer.getContext();
    const extension = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = Schema.decodeUnknownOption(Schema.String)(
      extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    );
    Queue.offerUnsafe(
      queue,
      Message.SucceededMountMap({ generation, renderer: Option.getOrElse(renderer, () => "unreported") }),
    );
    return {
      mounted,
      wait: Deferred.await(failure).pipe(
        Effect.catch(error =>
          nativeCall("camera-pause", () => camera.pause(true)).pipe(
            Effect.andThen(report(queue, error)),
            Effect.andThen(Effect.never),
          )
        ),
      ),
    };
  },
);

interface CommandService {
  snapshot: RendererService["snapshot"];
  readonly present: RendererService["present"];
  readonly fly: RendererService["fly"];
  readonly followTarget: RendererService["followTarget"];
  readonly rotate: RendererService["rotate"];
  readonly inspect: () => Option.Option<Mounted>;
  readonly mount: (options: MountOptions) => Effect.Effect<void, MapFault, Scope.Scope>;
}
export class MapCommands extends Context.Service<MapCommands, CommandService>()("floor/web/map/MapCommands") {
  static readonly makeLayer = (configuration: Configuration = {}) =>
    Layer.effect(
      MapCommands,
      Effect.gen(function*() {
        const permit = yield* Semaphore.make(1);
        const current = yield* Ref.make(Option.none<Mounted>());
        const quarantine = yield* Ref.make(Option.none<MapFault>());
        let generation = 0;
        const use = <A>(f: (service: RendererService) => Effect.Effect<A, MapFault>) =>
          Effect.flatMap(Ref.get(current), mounted =>
            Option.match(mounted, {
              onNone: () => Effect.fail(fault("not-mounted", "Map is not mounted")),
              onSome: value => f(value.service),
            }));
        const mount = (options: MountOptions) =>
          permit.withPermit(Effect.gen(function*() {
            const retired = yield* Ref.get(quarantine);
            if (Option.isSome(retired)) return yield* retired.value;
            const scope = yield* Scope.make();
            // The permit spans acquisition, use, and retirement. A failed release blocks
            // future mounts because ownership of native resources is then uncertain.
            return yield* Effect.acquireUseRelease(
              Effect.succeed(scope),
              child =>
                Effect.gen(function*() {
                  const owned = yield* acquire(options, ++generation, configuration).pipe(
                    Effect.provideService(Scope.Scope, child),
                  );
                  yield* Ref.set(current, Option.some(owned.mounted));
                  return yield* owned.wait;
                }),
              child =>
                Ref.set(current, Option.none()).pipe(Effect.andThen(
                  Scope.close(child, Exit.void).pipe(
                    Effect.interruptible,
                    Effect.timeout("100 millis"),
                    Effect.catchCause(cause => {
                      const error = fault("renderer-retire", cause);
                      return Ref.set(quarantine, Option.some(error)).pipe(Effect.andThen(report(options.queue, error)));
                    }),
                  ),
                )),
            );
          }));
        return MapCommands.of({
          snapshot: input => use(service => service.snapshot(input)),
          present: (presentation, fromHistory, retainCamera) =>
            use(service => service.present(presentation, fromHistory, retainCamera)),
          fly: (view, follow) => use(service => service.fly(view, follow)),
          followTarget: readTarget => use(service => service.followTarget(readTarget)),
          rotate: direction => use(service => service.rotate(direction)),
          inspect: () => Ref.getUnsafe(current),
          mount,
        });
      }),
    );
  static readonly layer = MapCommands.makeLayer();
}
export const makeMountMap = (commands: MapCommands["Service"]) =>
  Mount.defineStream("MountMap", {
    args: { initialPresentation: Presentation, initialDesks: Schema.Int },
    messages: [
      Message.SucceededMountMap,
      Message.FailedMap,
      Message.AppliedFrame,
      Message.SelectedEntity,
      Message.RestedCamera,
    ],
    execute: ({ element, initialPresentation, initialDesks, viewStateChanges }) =>
      Stream.callback<MountMessage>(queue =>
        Effect.gen(function*() {
          if (!(element instanceof HTMLElement)) return yield* fault("host", "Expected an HTMLElement");
          yield* commands.mount({
            element,
            desks: initialDesks,
            initial: initialPresentation,
            queue,
            viewStateChanges,
          });
          return yield* Effect.void;
        }).pipe(Effect.catch(error => report(queue, error))), { bufferSize: 32, strategy: "sliding" }),
  });
