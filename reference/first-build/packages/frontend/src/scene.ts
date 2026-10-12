import type { AtlasRenderer } from "@floor/renderer";
import { Array, Context, Effect, Layer, Option, Queue, Ref, Semaphore, Stream } from "effect";
import { Mount } from "foldkit";
import { atlasMarket } from "./_lib/atlas-view";
import { FrontendError } from "./_lib/errors";
import { makeLabels } from "./_lib/scene-labels";
import { CameraAction, Message, type SceneState } from "./message";

type CameraMessage = ReturnType<typeof Message.PlateCaptured> | ReturnType<typeof Message.CameraMoved>;
type MountedMessage =
  | ReturnType<typeof Message.SceneMounted>
  | ReturnType<typeof Message.SelectedMarket>
  | ReturnType<typeof Message.SceneChanged>
  | ReturnType<typeof Message.Failed>;
const loadRenderer = () => import("@floor/renderer");
const rendererError = (error: { readonly message: string }) => new FrontendError({ message: error.message });

export class Scene extends Context.Service<Scene, {
  readonly mount: Mount.MountDefinitionNoArgs<"MountAtlas", MountedMessage>;
  readonly update: (state: SceneState) => Effect.Effect<void, FrontendError>;
  readonly camera: (action: typeof CameraAction.Type, selected: string) => Effect.Effect<CameraMessage, FrontendError>;
}>()("@floor/frontend/Scene") {
  static readonly layer = Layer.effect(
    Scene,
    Effect.gen(function*() {
      const frame = yield* Ref.make(
        Option.none<{ readonly blockNumber: number; readonly marketId: string; readonly title: string }>(),
      );
      const lock = yield* Semaphore.make(1);
      const current = yield* Ref.make(Option.none<AtlasRenderer>());
      const renderer = Ref.get(current).pipe(Effect.flatMap(Option.match({
        onNone: () => Effect.fail(new FrontendError({ message: "The drawing surface is still opening." })),
        onSome: Effect.succeed,
      })));
      const MountAtlas = Mount.defineStream("MountAtlas", {
        messages: [Message.SceneMounted, Message.SelectedMarket, Message.SceneChanged, Message.Failed],
        execute: ({ element, viewStateChanges }) =>
          Stream.callback<MountedMessage>(queue =>
            Effect.gen(function*() {
              if (!(element instanceof HTMLElement)) {
                yield* Queue.offer(queue, Message.Failed({ error: "The map needs an HTML drawing surface." }));
                return;
              }
              const { createAtlasRenderer } = yield* Effect.tryPromise({
                try: loadRenderer,
                catch: () => new FrontendError({ message: "The drawing module could not be loaded." }),
              });
              const labels = yield* Effect.acquireRelease(
                Effect.sync(() => makeLabels(element)),
                overlay => Effect.sync(() => overlay.destroy()),
              );
              // The element scope owns third-party handles; callbacks enter Foldkit through a bounded native queue.
              const mounted = yield* Effect.acquireRelease(
                Effect.try({
                  try: () =>
                    createAtlasRenderer(element, {
                      onSelect: id => {
                        Queue.offerUnsafe(queue, Message.SelectedMarket({ id }));
                      },
                      onViewChange: view => {
                        Queue.offerUnsafe(queue, Message.SceneChanged({ zoom: view.level }));
                      },
                      onError: error => {
                        Queue.offerUnsafe(queue, Message.Failed({ error: error.message }));
                      },
                      onLabels: labels.update,
                    }),
                  catch: () =>
                    new FrontendError({ message: "WebGL is unavailable. Market readings remain accessible." }),
                }),
                handle =>
                  Ref.update(current, value => Option.filter(value, active => active !== handle)).pipe(
                    Effect.andThen(Effect.sync(() => handle.destroy())),
                  ),
              );
              yield* Ref.set(current, Option.some(mounted));
              yield* Stream.runForEach(
                viewStateChanges,
                state => Effect.sync(() => element.toggleAttribute("inert", state === "Paused")),
              ).pipe(Effect.forkScoped);
              yield* Queue.offer(queue, Message.SceneMounted());
            }).pipe(Effect.catch(error => Queue.offer(queue, Message.Failed({ error: error.message })))), {
            bufferSize: 32,
            strategy: "sliding",
          }),
      });
      return Scene.of({
        mount: MountAtlas,
        update: Effect.fn("Scene.update")(function*(state: SceneState) {
          const handle = yield* renderer;
          if (Option.isSome(state.atlas)) {
            yield* Effect.fromResult(
              handle.setData({
                markets: Array.map(state.atlas.value.market.markets, atlasMarket),
                activeMarketId: state.atlas.value.activeMarketId,
                slots: state.atlas.value.slots,
                tiers: state.atlas.value.tiers,
                adoptedDesigns: state.atlas.value.adoptedDesigns,
                ...Option.match(state.evidence, { onNone: () => ({}), onSome: evidence => ({ evidence }) }),
              }),
            ).pipe(Effect.mapError(rendererError));
          }
          yield* Effect.sync(() => {
            handle.setSelected(state.selected);
            handle.setTheme(state.theme);
            handle.setLens(state.lens);
            handle.setExploded(state.exploded);
            handle.setMoorings(state.moorings);
          });
          yield* Ref.set(
            frame,
            state.atlas.pipe(
              Option.flatMap(atlas =>
                Array.findFirst(atlas.market.markets, market => market.id === state.selected).pipe(
                  Option.map(market => ({
                    blockNumber: atlas.market.blockNumber,
                    marketId: market.id,
                    title: `${market.name} at the tide`,
                  })),
                )
              ),
            ),
          );
        }, operation => lock.withPermit(operation)),
        camera: Effect.fn("Scene.camera")(function*(action, selected) {
          const handle = yield* renderer;
          if (action === "capture") {
            const observed = yield* Ref.get(frame);
            if (Option.isNone(observed)) {
              return yield* new FrontendError({
                message: "Choose a market with an observed source block before capturing a plate.",
              });
            }
            return Message.PlateCaptured({ ...observed.value, view: handle.getView().level });
          }
          yield* Effect.sync(() => {
            if (action === "in") handle.zoomIn();
            if (action === "out") handle.zoomOut();
            if (action === "reset") handle.resetView();
            if (action === "focus") handle.focus(selected);
          });
          return Message.CameraMoved();
        }, operation => lock.withPermit(operation)),
      });
    }),
  );
}
