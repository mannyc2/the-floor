import { Effect, Schedule, Stream } from "effect";
import { Dom, Subscription } from "foldkit";
import { ApiClient } from "./api";
import { Message } from "./message";
import type { Model } from "./state";

/** RPC owns socket reconnection; restarting an interrupted streaming call is read-only. */
const changes = Stream.unwrap(Effect.map(ApiClient, api => api.rpc.watch())).pipe(
  Stream.map(atlas => Message.ReceivedAtlas({ atlas, realtime: true })),
  Stream.catch(() => Stream.succeed(Message.Connected({ value: false }))),
  Stream.repeat(Schedule.spaced("2 seconds")),
);

/** @stability unstable */
export const subscriptions = Subscription.make<Model, Message, ApiClient>()(() => ({
  marketChanges: Subscription.persistentEntry(changes),
  workspaceRefresh: Subscription.persistentEntry(Stream.tick("10 seconds").pipe(Stream.map(() => Message.Tick()))),
  keyboard: Subscription.persistentEntry(Dom.streamFromKeyBindings<Message>({
    bindings: [
      { keys: "E", mapEvent: () => Message.ToggleExploded() },
    ],
  })),
}));
