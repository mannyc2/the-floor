import { Action } from "@floor/surfaces";
import { Effect, Option, Schema } from "effect";
import { Command } from "foldkit";
import { AmbientSound } from "./_lib/sound";
import { OwnerWallet } from "./_lib/wallet";
import { ApiClient } from "./api";
import { CameraAction, Message, SceneState } from "./message";
import { Preferences } from "./preferences";
import { Scene } from "./scene";
import { Theme } from "./state";

/** @stability unstable */
export type Services = ApiClient | Preferences | Scene | OwnerWallet | AmbientSound;
const failed = (error: { readonly message: string }) => Effect.succeed(Message.Failed({ error: error.message }));

/** @stability unstable */
export const Bootstrap = Command.define("Bootstrap", {
  args: { embedded: Schema.Boolean },
  messages: [Message.Booted, Message.Failed],
  execute: ({ embedded }) =>
    Effect.gen(function*() {
      const api = yield* ApiClient;
      if (embedded) {
        return Message.Booted({ atlas: yield* api.http.atlas.snapshot({ query: {} }), workspace: Option.none() });
      }
      yield* api.http.session.start();
      const loaded = yield* Effect.all({
        atlas: api.http.atlas.snapshot({ query: {} }),
        workspace: api.http.workspace.get(),
      }, { concurrency: "unbounded" });
      return Message.Booted({ atlas: loaded.atlas, workspace: Option.some(loaded.workspace) });
    }).pipe(Effect.catch(failed)),
});

/** @stability unstable */
export const SubmitAction = Command.define("SubmitAction", {
  args: { action: Action },
  messages: [Message.CompletedAction, Message.Failed],
  execute: ({ action }) =>
    Effect.gen(function*() {
      const api = yield* ApiClient;
      const result = yield* api.http.workspace.act({ payload: { action } });
      const workspace = yield* api.http.workspace.get();
      return Message.CompletedAction({ result, workspace });
    }).pipe(Effect.catch(failed)),
});

/** @stability unstable */
export const ReloadWorkspace = Command.define("ReloadWorkspace", {
  messages: [Message.ReceivedWorkspace, Message.Failed],
  execute: Effect.gen(function*() {
    const api = yield* ApiClient;
    return Message.ReceivedWorkspace({ workspace: yield* api.http.workspace.get() });
  }).pipe(Effect.catch(failed)),
});

/** @stability unstable */
export const LoadSnapshot = Command.define("LoadSnapshot", {
  args: { block: Schema.Finite },
  messages: [Message.ReceivedAtlas, Message.Failed],
  execute: ({ block }) =>
    Effect.gen(function*() {
      const api = yield* ApiClient;
      return Message.ReceivedAtlas({
        atlas: yield* api.http.atlas.snapshot({ query: block > 0 ? { block: String(block) } : {} }),
        realtime: false,
      });
    }).pipe(Effect.catch(failed)),
});

export const RenderScene = Command.define("RenderScene", {
  args: { state: SceneState },
  messages: [Message.SceneUpdated, Message.Failed],
  execute: ({ state }) =>
    Effect.gen(function*() {
      const scene = yield* Scene;
      yield* scene.update(state);
      return Message.SceneUpdated();
    }).pipe(Effect.catch(failed)),
});

export const MoveCamera = Command.define("MoveCamera", {
  args: { action: CameraAction, selected: Schema.String },
  messages: [Message.CameraMoved, Message.PlateCaptured, Message.Failed],
  execute: ({ action, selected }) =>
    Effect.gen(function*() {
      const scene = yield* Scene;
      return yield* scene.camera(action, selected);
    }).pipe(Effect.catch(failed)),
});

/** @stability unstable */
export const SaveTheme = Command.define("SaveTheme", {
  args: { theme: Theme },
  messages: [Message.PreferenceSaved, Message.Failed],
  execute: ({ theme }) =>
    Effect.gen(function*() {
      const preferences = yield* Preferences;
      yield* preferences.saveTheme(theme);
      return Message.PreferenceSaved();
    }).pipe(Effect.catch(failed)),
});

/** @stability unstable */
export const ConnectWallet = Command.define("ConnectWallet", {
  messages: [Message.WalletConnected, Message.Failed],
  execute: Effect.gen(function*() {
    const api = yield* ApiClient;
    const wallet = yield* OwnerWallet;
    const challenge = yield* api.http.session.challenge();
    yield* api.http.session.verify({ payload: yield* wallet.signChallenge(challenge.nonce, challenge.message) });
    return Message.WalletConnected({ workspace: yield* api.http.workspace.get() });
  }).pipe(Effect.catch(failed)),
});

export const SetSound = Command.define("SetSound", {
  args: { enabled: Schema.Boolean },
  messages: [Message.SoundChanged, Message.Failed],
  execute: ({ enabled }) =>
    Effect.gen(function*() {
      const sound = yield* AmbientSound;
      yield* sound.setEnabled(enabled);
      return Message.SoundChanged({ enabled });
    }).pipe(Effect.catch(failed)),
});
