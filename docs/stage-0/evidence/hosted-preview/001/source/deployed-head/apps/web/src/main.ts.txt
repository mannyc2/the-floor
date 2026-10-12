import { FloorHttpApi } from "@floor/api/http";
import { Health } from "@floor/contract/health";
import { Effect, Schema } from "effect";
import { HttpApiClient } from "effect/http-api";
import { Command, Http, Runtime, Update } from "foldkit";
import type { Document, HtmlBuilder } from "foldkit/html";
import { defineMessageUnion } from "foldkit/message";
import { modifyFields } from "foldkit/struct";

export const Model = Schema.Struct({ connection: Schema.Literals(["idle", "checking", "connected", "unavailable"]) });
export type Model = typeof Model.Type;
export const Message = defineMessageUnion({
  ClickedCheckConnection: {},
  SucceededCheckConnection: { health: Health },
  FailedCheckConnection: {},
});
export type Message = typeof Message.Type;

const CheckConnection = Command.define("CheckConnection", {
  messages: [Message.SucceededCheckConnection, Message.FailedCheckConnection],
  execute: Effect.gen(function*() {
    const client = yield* HttpApiClient.make(FloorHttpApi);
    const health = yield* client.health.get();
    return Message.SucceededCheckConnection({ health });
  }).pipe(
    Effect.timeout("10 seconds"),
    Effect.catch(error =>
      Effect.logWarning("Floor connection check failed", error).pipe(Effect.as(Message.FailedCheckConnection()))
    ),
    // Foldkit owns the command lifecycle; this stateless fetch adapter needs no application-wide resource.
    // oxlint-disable-next-line effecttsgo/strict-effect-provide -- The browser command is the fetch composition boundary.
    Effect.provide(Http.layer),
  ),
});

export const init: Runtime.ApplicationInit<Model, Message> = () => ({ model: { connection: "idle" } });
export const update = (model: Model, message: Message): Update.Return<Model, Message> =>
  Message.match(message, {
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

export const view = (model: Model, h: HtmlBuilder<Message>): Document => ({
  title: "The Floor",
  body: h.main([], [
    h.header([], [h.h1([], ["The Floor"])]),
    // The external Foldkit renderer owns this slot's eventual scoped mount and disposal.
    // No stand-in geometry or unapproved Atlas values enter the product shell.
    h.section([h.Id("floor-map"), h.AriaLabel("District map")], [h.p([], ["The district is being prepared."])]),
    h.section([h.AriaLabel("Connection")], [
      h.p([h.Role("status"), h.AriaLive("polite")], [connectionText[model.connection]]),
      h.button([h.OnClick(Message.ClickedCheckConnection()), h.Disabled(model.connection === "checking")], [
        "Check connection",
      ]),
    ]),
  ]),
});
