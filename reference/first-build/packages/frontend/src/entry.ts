import { BrowserKeyValueStore, BrowserRuntime } from "@effect/platform-browser";
import { ConfigProvider, Context, DateTime, Effect, Layer, Option } from "effect";
import { FetchHttpClient, UrlParams } from "effect/http";
import { RpcClient, RpcSerialization } from "effect/rpc";
import { Socket } from "effect/socket";
import { Runtime } from "foldkit";
import { AmbientSound } from "./_lib/sound";
import { OwnerWallet } from "./_lib/wallet";
import { ApiClient } from "./api";
import { Message } from "./message";
import { init, update } from "./model";
import { Preferences } from "./preferences";
import { Scene } from "./scene";
import { Flags, Model } from "./state";
import { subscriptions } from "./subscriptions";
import { view } from "./view";
// oxlint-disable-next-line import/no-unassigned-import -- Vite owns stylesheet loading at this browser entry point.
import "./styles.css";

const program = Effect.gen(function*() {
  const websocket = new URL("/stream", window.location.href);
  websocket.protocol = websocket.protocol === "https:" ? "wss:" : "ws:";
  const protocol = RpcClient.layerProtocolSocket().pipe(
    Layer.provide(RpcSerialization.layerNdjson),
    Layer.provide(Socket.layerWebSocket(websocket.href).pipe(Layer.provide(Socket.layerWebSocketConstructorGlobal))),
  );
  const resources = Layer.mergeAll(
    ApiClient.layer.pipe(Layer.provide(protocol), Layer.provide(FetchHttpClient.layer)),
    Preferences.layer.pipe(Layer.provide(BrowserKeyValueStore.layerLocalStorage)),
    OwnerWallet.browser,
    Scene.layer,
    AmbientSound.layer,
  );
  const context = yield* Layer.build(resources);
  const scene = Context.get(context, Scene);
  const app = Runtime.makeApplication({
    Model,
    Flags,
    init,
    update,
    subscriptions,
    view: (model, html) => view(model, html, scene.mount()),
    container: document.getElementById("root"),
    resources: Layer.succeedContext(context),
    crash: {
      view: (_context, html) => ({
        title: "The Floor — reopen your workspace",
        body: html.main([html.Class("page empty-state")], [
          html.p([html.Class("eyebrow")], ["THE FLOOR"]),
          html.h1([], ["The workspace needs to reopen"]),
          html.p([], ["Something interrupted this view. Reopen the workspace to load its latest saved record."]),
          html.a([html.Href("/"), html.Class("button")], ["Reopen the workspace"]),
        ]),
      }),
    },
    devTools: {
      show: "Development",
      mode: "TimeTravel",
      maxEntries: 50,
      Message,
      excludeFromHistory: ["SceneChanged", "SceneUpdated", "CameraMoved"],
    },
  });
  const flags = Effect.gen(function*() {
    const params = UrlParams.fromInput(new URLSearchParams(window.location.search));
    const preferences = yield* Preferences;
    return Flags.make({
      theme: yield* preferences.theme,
      selectedMarket: UrlParams.getFirst(params, "market").pipe(
        Option.orElse(() => UrlParams.getFirst(params, "embed")),
        Option.getOrElse(() => ""),
      ),
      embedded: Option.isSome(UrlParams.getFirst(params, "embed")),
      origin: window.location.origin,
      date: DateTime.formatIso(yield* DateTime.now),
    });
  });
  yield* Effect.acquireRelease(
    Effect.sync(() => Runtime.embed(app, { flags })),
    handle => Effect.sync(() => handle.dispose()),
  );
  return yield* Effect.never;
});

program.pipe(
  Effect.scoped,
  // oxlint-disable-next-line effecttsgo/strict-effect-provide -- This browser entry point owns the application scope and its resource layers.
  Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({}))),
  BrowserRuntime.runMain,
);
