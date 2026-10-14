import { Clock, Context, Effect, Exit, Layer, Option, Queue, Result, Schema, Scope, Stream } from "effect";
import { Mount } from "foldkit";
import { Message } from "../../message";
import { type Camera, fault, type MapFault, Presentation, type Turn } from "../../model";
import { makeDisplayGate } from "../display-gate";
import { makeSerialOwner } from "../serial-owner";
import type { openCamera } from "./camera";
import type { Engine, Ledger } from "./engine";

type MountMessage =
  | typeof Message.SucceededMountMap.Type
  | typeof Message.FailedMap.Type
  | typeof Message.AppliedFrame.Type
  | typeof Message.SelectedEntity.Type
  | typeof Message.RestedCamera.Type;
interface RendererService {
  readonly snapshot: (input: Schema.Json) => Effect.Effect<Effect.Success<ReturnType<Engine["snapshot"]>>, MapFault>;
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
  readonly observeFrames: (observe: (sample: RendererFrame) => void) => () => void;
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
interface OwnedMount extends Mounted {
  readonly scope: Scope.Closeable;
}
interface MountOptions {
  readonly element: HTMLElement;
  readonly desks: number;
  readonly initial: Presentation;
  readonly queue: Queue.Enqueue<MountMessage>;
  readonly viewStateChanges: Stream.Stream<Mount.ViewState>;
}
interface RendererOptions extends MountOptions {
  readonly generation: number;
  readonly ledger: Ledger;
}
const nativeCall = <A>(phase: string, run: () => A) => Effect.try({ try: run, catch: cause => fault(phase, cause) });
const report = (queue: Queue.Enqueue<MountMessage>, error: MapFault) =>
  Effect.sync(() => {
    Queue.offerUnsafe(queue, Message.FailedMap({ reason: error.message }));
  });
const nextFrame = Effect.callback<void>(resume => {
  const id = requestAnimationFrame(() => resume(Effect.void));
  return Effect.sync(() => cancelAnimationFrame(id));
});
const loadEngine = Effect.tryPromise({
  // oxlint-disable-next-line effect/noDynamicImports -- The renderer is a measured deferred browser entry; a static import would put three.js into the shell budget.
  try: () => import("./engine"),
  catch: cause => fault("renderer-import", cause),
});
const loadCamera = Effect.tryPromise({
  // oxlint-disable-next-line effect/noDynamicImports -- Camera code shares the renderer's deferred acquisition boundary.
  try: () => import("./camera"),
  catch: cause => fault("camera-import", cause),
});

export class Renderer extends Context.Service<Renderer, Mounted>()("floor/web/map/Renderer") {
  static readonly layer = (options: RendererOptions) =>
    Layer.effect(
      Renderer,
      Effect.gen(function*() {
        const { element, initial, generation, queue } = options;
        const engineModule = yield* loadEngine;
        const cameraModule = yield* loadCamera;
        const clock = yield* Clock.Clock;
        const now = () => Number(clock.monotonicTimeNanosUnsafe()) / 1e6;
        const engine = yield* Effect.acquireRelease(
          nativeCall("webgl-open", () => engineModule.openEngine(element, options.desks, initial, now, options.ledger)),
          resource => nativeCall("webgl-close", () => resource.dispose()).pipe(Effect.orDie),
        );
        const gate = yield* makeDisplayGate;
        yield* gate.begin(generation);
        const frame = {
          sequence: 0,
          applied: -1,
          paused: false,
          poisoned: false,
          snapshotCpuMs: 0,
          snapshots: 0,
          maybePending: Option.none<
            { readonly presentation: Presentation; readonly cameraCommits: number; readonly retainCamera: boolean }
          >(),
        };
        const frameObservers = new Set<(sample: RendererFrame) => void>();
        let previousFrame = engine.inspect();
        const camera = yield* Effect.acquireRelease(
          nativeCall("camera-open", () =>
            cameraModule.openCamera(engine, now, (view, history) => {
              if (!frame.poisoned && !frame.paused) {
                Queue.offerUnsafe(queue, Message.RestedCamera({ camera: view, history }));
              }
            }, (x, y) => {
              // Native input cannot await an Effect. These fields mirror the exact
              // receipt acknowledged below, so a queued or historical frame is inert.
              if (!frame.paused && !frame.poisoned && !engine.inspect().lost && frame.applied === frame.sequence) {
                const picked = Result.try({ try: () => engine.pick(x, y), catch: cause => fault("pick", cause) });
                if (Result.isFailure(picked)) {
                  failedNative(picked.failure);
                } else {
                  Queue.offerUnsafe(
                    queue,
                    Message.SelectedEntity({
                      entity: picked.success > 0 ? Option.some(picked.success) : Option.none(),
                    }),
                  );
                }
              }
            }, error => failedNative(fault("camera-input", error)))),
          resource => nativeCall("camera-close", () => resource.dispose()).pipe(Effect.orDie),
        );
        const failedNative = (error: MapFault) => {
          if (frame.poisoned) return;
          frame.poisoned = true;
          frame.maybePending = Option.none();
          camera.pause(true);
          Queue.offerUnsafe(queue, Message.FailedMap({ reason: error.message }));
        };
        engine.onFailure(error => {
          failedNative(fault("renderer-callback", error));
        });
        const present = Effect.fn("Renderer.present")(
          function*(presentation: Presentation, fromHistory: boolean = false, retainCamera: boolean = false) {
            if (frame.poisoned) return yield* fault("poisoned-display", "A failed frame requires a new Mount");
            if (frame.paused && !fromHistory) return yield* Effect.void;
            const sequence = ++frame.sequence;
            const cameraCommits = camera.inspect().restCommits;
            const accepted = yield* gate.accept({
              generation,
              sequence,
              mode: frame.paused ? "Paused" : "Live",
              presentation,
            });
            // Schema decoding owns the accepted value. Retaining the caller's
            // object would let later mutations change the next drawn frame.
            if (accepted) {
              frame.maybePending = Option.map(
                (yield* gate.read).maybePending,
                value => ({ presentation: value.presentation, cameraCommits, retainCamera }),
              );
            }
            return yield* Effect.void;
          },
        );
        const pump = Effect.fnUntraced(function*() {
          if (frame.poisoned) return yield* Effect.void;
          if (Option.isSome(frame.maybePending) && !engine.inspect().lost) {
            const pending = frame.maybePending.value;
            const result = yield* nativeCall("draw", () => {
              // An accepted frame may precede a settled input. Apply its data,
              // but only a camera accepted after that input may replace the view.
              // Historical replay deliberately restores both regardless of input.
              engine.apply(
                pending.presentation,
                frame.paused
                  || (!pending.retainCamera && !camera.busy()
                    && pending.cameraCommits === camera.inspect().restCommits),
              );
              return engine.draw();
            });
            if (frame.poisoned || !result.drawn) return yield* Effect.void;
            frame.maybePending = Option.none();
            const acknowledged = yield* gate.acknowledge({ generation, sequence: frame.sequence });
            if (acknowledged && !frame.poisoned) {
              frame.applied = frame.sequence;
              Queue.offerUnsafe(queue, Message.AppliedFrame({ generation, sequence: frame.sequence }));
            }
          }
          yield* nativeCall("advance", () => {
            if (frame.poisoned) return;
            if (!frame.paused) engine.advance();
            camera.tick();
          });
          return yield* Effect.void;
        });
        const readRendered = Effect.fn("Renderer.readRendered")(function*() {
          const encoded = Option.fromUndefinedOr(element.dataset["frame"]);
          if (Option.isNone(encoded)) return;
          const presentation = yield* Schema.decodeEffect(Schema.fromJsonString(Presentation))(encoded.value)
            .pipe(Effect.mapError(cause => fault("rendered-schema", cause)));
          yield* present(presentation, true);
        });
        const changes = yield* Queue.sliding<boolean>(1);
        yield* Effect.acquireRelease(
          nativeCall("replay-observer", () => {
            const observer = new MutationObserver(() => {
              if (frame.paused) Queue.offerUnsafe(changes, true);
            });
            observer.observe(element, { attributes: true, attributeFilter: ["data-frame"] });
            return observer;
          }),
          observer => Effect.sync(() => observer.disconnect()),
        );
        yield* Stream.runForEach(
          Stream.fromQueue(changes),
          () => readRendered().pipe(Effect.catch(error => report(queue, error))),
        )
          .pipe(Effect.forkScoped);
        const service: RendererService = {
          snapshot: input =>
            Effect.suspend(() => {
              if (frame.poisoned || frame.paused) {
                return Effect.fail(fault("inactive-snapshot", "Renderer is not live"));
              }
              const started = now();
              return engine.snapshot(input).pipe(
                Effect.mapError(cause => fault("instance-snapshot", cause)),
                Effect.tap(() =>
                  Effect.sync(() => {
                    frame.snapshots++;
                  })
                ),
                Effect.ensuring(Effect.sync(() => {
                  frame.snapshotCpuMs += now() - started;
                })),
              );
            }),
          present,
          rotate: direction =>
            frame.poisoned
              ? Effect.fail(fault("poisoned-display", "A failed frame requires a new Mount"))
              : nativeCall("camera-rotation", () => camera.rotate(direction)),
          fly: (view, follow) =>
            frame.poisoned
              ? Effect.fail(fault("poisoned-display", "A failed frame requires a new Mount"))
              : nativeCall("camera-flight", () => follow ? camera.follow(view) : camera.fly(view)),
          followTarget: readTarget =>
            frame.poisoned
              ? Effect.fail(fault("poisoned-display", "A failed frame requires a new Mount"))
              : nativeCall("camera-follow-target", () => camera.followTarget(readTarget)),
          pause: Effect.fn("Renderer.pause")(function*(paused: boolean) {
            frame.paused = paused;
            yield* nativeCall("camera-pause", () => camera.pause(paused || frame.poisoned));
            if (frame.poisoned) return;
            yield* readRendered();
          }),
        };
        yield* Stream.runForEach(options.viewStateChanges, state => service.pause(state === "Paused"))
          .pipe(Effect.catch(error => report(queue, error)), Effect.forkScoped);
        yield* present(initial);
        const measuredPump = Effect.suspend(() => {
          if (frameObservers.size === 0) {
            frame.snapshots = 0;
            frame.snapshotCpuMs = 0;
            return pump();
          }
          const before = engine.inspect();
          const start = now();
          return pump().pipe(Effect.tap(() =>
            Effect.sync(() => {
              const pumpCpuMs = now() - start;
              const after = engine.inspect();
              const betweenPumpDrawCpuMs = before.cumulativeDrawCpuMs - previousFrame.cumulativeDrawCpuMs;
              // Data arrival may occur between RAF callbacks. Attribute its entire
              // decode/diff cost to the next frame, including both draws if a
              // presentation and camera tick submit separately in that frame.
              const sample: RendererFrame = {
                atMs: start,
                cpuMs: pumpCpuMs + frame.snapshotCpuMs + betweenPumpDrawCpuMs,
                snapshotCpuMs: frame.snapshotCpuMs,
                pumpCpuMs,
                betweenPumpDrawCpuMs,
                snapshots: frame.snapshots,
                revision: after.snapshotRevision,
                draws: after.draws - previousFrame.draws,
                uploadCalls: after.bufferUploads.calls - previousFrame.bufferUploads.calls,
                uploadBytes: after.bufferUploads.bytes - previousFrame.bufferUploads.bytes,
              };
              previousFrame = after;
              frame.snapshots = 0;
              frame.snapshotCpuMs = 0;
              frameObservers.forEach(observe => observe(sample));
            })
          ));
        });
        yield* nextFrame.pipe(
          Effect.andThen(measuredPump),
          Effect.forever,
          Effect.catch(error => Effect.sync(() => failedNative(error))),
          Effect.forkScoped,
        );
        Queue.offerUnsafe(queue, Message.SucceededMountMap({ generation, renderer: engine.inspect().renderer }));
        return Renderer.of({
          generation,
          engine,
          camera,
          service,
          observeFrames: observe => {
            if (frameObservers.size === 0) previousFrame = engine.inspect();
            frameObservers.add(observe);
            return () => {
              frameObservers.delete(observe);
            };
          },
        });
      }),
    );
}

interface CommandService {
  readonly snapshot: RendererService["snapshot"];
  readonly present: RendererService["present"];
  readonly fly: RendererService["fly"];
  readonly followTarget: RendererService["followTarget"];
  readonly rotate: RendererService["rotate"];
  readonly inspect: () => Option.Option<Mounted>;
  readonly inspectLedger: () => Option.Option<Ledger>;
  readonly mount: (options: MountOptions) => Effect.Effect<void, MapFault, Scope.Scope>;
}

export class MapCommands extends Context.Service<MapCommands, CommandService>()("floor/web/map/MapCommands") {
  static readonly layer = Layer.effect(
    MapCommands,
    Effect.gen(function*() {
      const applicationScope = yield* Effect.scope;
      const state = { nextGeneration: 0, ledger: Option.none<Ledger>() };
      const owner = yield* makeSerialOwner<OwnedMount>(mounted =>
        Scope.close(mounted.scope, Exit.void).pipe(
          Effect.catchCause(cause => Effect.fail(fault("renderer-retire", cause))),
        )
      );
      yield* Effect.addFinalizer(() => owner.close().pipe(Effect.catch(error => Effect.logError(error))));
      const use = <A>(f: (service: RendererService) => Effect.Effect<A, MapFault>) =>
        Effect.suspend(() =>
          Option.match(owner.current(), {
            onNone: () => Effect.fail(fault("not-mounted", "Map is not mounted")),
            onSome: mounted => f(mounted.service),
          })
        );
      const acquire = Effect.fn("MapCommands.acquire")(function*(options: MountOptions) {
        const engineModule = yield* loadEngine;
        const ledger = Option.getOrElse(state.ledger, engineModule.createLedger);
        state.ledger = Option.some(ledger);
        const generation = ++state.nextGeneration;
        const scope = yield* Scope.fork(applicationScope, "sequential");
        const context = yield* Layer.buildWithScope(Renderer.layer({ ...options, generation, ledger }), scope).pipe(
          Effect.onExit(exit => Exit.isFailure(exit) ? Scope.close(scope, exit) : Effect.void),
        );
        return { ...Context.get(context, Renderer), scope };
      });
      const mount = Effect.fn("MapCommands.mount")(function*(options: MountOptions) {
        // Mount destruction and a replacement acquisition can race. The same
        // serial owner retires both; an uncertain retirement quarantines the app.
        yield* owner.replaceScoped(acquire(options), error => report(options.queue, error));
      });
      return MapCommands.of({
        snapshot: input => use(service => service.snapshot(input)),
        present: (presentation, fromHistory, retainCamera) =>
          use(service => service.present(presentation, fromHistory, retainCamera)),
        fly: (camera, follow) => use(service => service.fly(camera, follow)),
        followTarget: readTarget => use(service => service.followTarget(readTarget)),
        rotate: direction => use(service => service.rotate(direction)),
        inspect: owner.current,
        inspectLedger: () => state.ledger,
        mount,
      });
    }),
  );
}

export const makeMountMap = (commands: MapCommands["Service"]) =>
  Mount.defineStream("MountMap", {
    args: { initialPresentation: Presentation, initialDesks: Schema.Int, acquireDelay: Schema.Int },
    messages: [
      Message.SucceededMountMap,
      Message.FailedMap,
      Message.AppliedFrame,
      Message.SelectedEntity,
      Message.RestedCamera,
    ],
    execute: ({ element, initialPresentation, initialDesks, acquireDelay, viewStateChanges }) =>
      Stream.callback<MountMessage>(queue =>
        Effect.gen(function*() {
          if (!(element instanceof HTMLElement)) return yield* fault("host", "Expected an HTMLElement");
          // Delay is interruptible before any renderer resource exists.
          yield* Effect.sleep(acquireDelay);
          yield* commands.mount({
            element,
            desks: initialDesks,
            initial: initialPresentation,
            queue,
            viewStateChanges,
          });
          return yield* Effect.never;
        }).pipe(Effect.catch(error => report(queue, error))), { bufferSize: 32, strategy: "sliding" }),
  });
