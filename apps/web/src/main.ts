import { FloorRpcs } from "@floor/api/rpc";
import { Health } from "@floor/contract/health";
import { Effect, Layer, Option, Schema } from "effect";
import { RpcClient, RpcSerialization } from "effect/rpc";
import { Command, Http, Runtime, Subscription, Update } from "foldkit";
import type { Document, HtmlBuilder } from "foldkit/html";
import { defineMessageUnion } from "foldkit/message";
import { modifyFields } from "foldkit/struct";
import type { MapCommands } from "./map/_lib/renderer/service";
import * as Map from "./map/main";
import { Message as MapMessage } from "./map/message";

export const Model = Schema.Struct({
  connection: Schema.Literals(["idle", "checking", "connected", "unavailable"]),
  map: Map.Model,
});
export type Model = typeof Model.Type;
export const Message = defineMessageUnion({
  GotMapMessage: { message: MapMessage },
  ClickedCheckConnection: {},
  SucceededCheckConnection: { health: Health },
  FailedCheckConnection: {},
});
export type Message = typeof Message.Type;

const RpcProtocol = RpcClient.layerProtocolHttp({ url: "/api/rpc" }).pipe(
  Layer.provide([Http.layer, RpcSerialization.layerJson]),
);

const CheckConnection = Command.define("CheckConnection", {
  messages: [Message.SucceededCheckConnection, Message.FailedCheckConnection],
  execute: Effect.gen(function*() {
    const client = yield* RpcClient.make(FloorRpcs);
    const health = yield* client.health({});
    return Message.SucceededCheckConnection({ health });
  }).pipe(
    Effect.scoped,
    Effect.timeout("10 seconds"),
    Effect.catch(error =>
      Effect.logWarning("Floor connection check failed", error).pipe(Effect.as(Message.FailedCheckConnection()))
    ),
    // Each check owns its RPC fibers; finishing or cancelling the command releases them.
    // oxlint-disable-next-line effecttsgo/strict-effect-provide -- The browser command is the fetch composition boundary.
    Effect.provide(RpcProtocol),
  ),
});

export const makeInit = (map: Map.Model): Runtime.ApplicationInit<Model, Message, void, MapCommands> => () => ({
  model: { connection: "idle", map },
});

const toGotMapMessage = (message: MapMessage): Message => Message.GotMapMessage({ message });
export const subscriptions = Subscription.lift(Map.subscriptions)({
  read: (model: Model) => Option.some(model.map),
  toParentMessage: toGotMapMessage,
});
const foldMap = Update.foldChild({
  update: Map.update,
  read: (model: Model) => Option.some(model.map),
  write: (model: Model, map: Map.Model) => modifyFields(model, { map: () => map }),
  toParentMessage: toGotMapMessage,
});
export const update = (model: Model, message: Message): Update.Return<Model, Message, MapCommands> =>
  Message.match(message, {
    GotMapMessage: ({ message: child }) => foldMap(model, child),
    ClickedCheckConnection: () =>
      model.connection === "checking"
        ? { model }
        : { model: modifyFields(model, { connection: () => "checking" }), commands: [CheckConnection()] },
    SucceededCheckConnection: () => ({ model: modifyFields(model, { connection: () => "connected" }) }),
    FailedCheckConnection: () => ({ model: modifyFields(model, { connection: () => "unavailable" }) }),
  });

const connectionText = {
  idle: "Not checked",
  checking: "Connecting…",
  connected: "Connected",
  unavailable: "Connection unavailable. Try again.",
};

export const makeView = (commands: MapCommands["Service"]) => {
  const mapView = Map.makeView(commands);
  return (model: Model, h: HtmlBuilder<Message>): Document => ({
    title: "The Floor",
    body: h.main([h.Class("floor-shell"), h.DataAttribute("theme", model.map.presentation.theme)], [
      h.header([h.Class("floor-heading")], [
        h.h1([], ["The Floor"]),
        // The look is provisional until the owner picks the kit's assets.
        h.p([h.Class("floor-note")], [
          Option.isSome(model.map.selection)
            ? "Provisional look · kit posts, stations and figures unpicked"
            : "Synthetic renderer test scene · no world selected",
        ]),
      ]),
      h.div([h.Id("floor-map")], [h.submodel({
        slotId: "map",
        view: mapView,
        model: model.map,
        toParentMessage: toGotMapMessage,
      })]),
      h.section([h.AriaLabel("Connection"), h.Class("floor-connection")], [
        h.p([h.Role("status"), h.AriaLive("polite")], [connectionText[model.connection]]),
        h.button([
          h.Class("chrome-link"),
          h.OnClick(Message.ClickedCheckConnection()),
          h.Disabled(model.connection === "checking"),
        ], ["Check connection"]),
      ]),
    ]),
  });
};
