import type { AtlasSnapshot } from "@floor/surfaces";
import * as Dialog from "@foldkit/ui/dialog";
import { Array, Option, Result } from "effect";
import { Update } from "foldkit";
import { workspaceEvidence } from "./_lib/market-evidence";
import {
  Bootstrap,
  ConnectWallet,
  LoadSnapshot,
  MoveCamera,
  ReloadWorkspace,
  RenderScene,
  SaveTheme,
  type Services,
  SetSound,
  SubmitAction,
} from "./commands";
import { formAction, openForm } from "./forms";
import { Message } from "./message";
import { type Flags, makeInitialModel, type Model } from "./state";

export { Message } from "./message";
export { Flags, Model } from "./state";
type Transition = Update.Return<Model, Message, Services>;
const dialogFields = {
  read: (model: Model) => Option.some(model.dialog),
  write: (model: Model, dialog: Dialog.Model): Model => ({ ...model, dialog }),
  toParentMessage: (message: Dialog.Message) => Message.GotDialogMessage({ message }),
  foldOutMessage: (outMessage: Dialog.OutMessage): Update.Step<Model, Message> =>
    Dialog.OutMessage.match<Update.Step<Model, Message>>(outMessage, {
      Opened: () => (model: Model) => ({ model }),
      Closed: () => (model: Model) => ({ model: { ...model, modal: "none", error: "" } }),
    }),
};
const foldDialog = Update.foldChild({ ...dialogFields, update: Dialog.update });
const openDialog = Update.foldChildStep({ ...dialogFields, update: Dialog.open });
const closeDialog = Update.foldChildStep({ ...dialogFields, update: Dialog.close });
const defaultMarket = (atlas: AtlasSnapshot): string =>
  Option.fromNullOr(atlas.activeMarketId).pipe(
    Option.orElse(() => Array.head(atlas.market.markets).pipe(Option.map(market => market.id))),
    Option.getOrElse(() => ""),
  );
const draw = (model: Model) =>
  RenderScene({
    state: {
      atlas: model.atlas,
      evidence: Option.flatMap(model.atlas, atlas =>
        Option.map(model.workspace, workspace => workspaceEvidence(workspace, atlas))),
      selected: model.selectedMarket,
      theme: model.theme,
      lens: model.lens,
      exploded: model.exploded,
      moorings: Option.match(model.workspace, {
        onNone: () =>
          Array.empty<string>(),
        onSome: workspace => workspace.moorings,
      }),
    },
  });
const redraw = (model: Model): Transition => model.sceneReady ? { model, commands: [draw(model)] } : { model };
const camera = (model: Model, action: "in" | "out" | "reset" | "capture" | "focus") =>
  MoveCamera({ action, selected: model.selectedMarket });
/** @stability unstable */
export const init = (flags: Flags): Transition => ({
  model: makeInitialModel(flags),
  commands: [Bootstrap({ embedded: flags.embedded })],
});

/** @stability unstable */
export const update = (model: Model, message: Message): Transition =>
  Message.match<Transition>(message, {
    Booted: ({ atlas, workspace }) =>
      redraw({
        ...model,
        atlas: Option.some(atlas),
        workspace,
        selectedMarket: model.selectedMarket || defaultMarket(atlas),
        error: "",
      }),
    Failed: ({ error }) => ({ model: { ...model, busy: false, error } }),
    ReceivedAtlas: ({ atlas, realtime }) => {
      // Replay response identity also rejects a slower request after a newer slider selection.
      if (model.replayBlock > 0 && (realtime || atlas.market.blockNumber !== model.replayBlock)) return { model };
      if (model.replayBlock === 0 && atlas.replay) return { model };
      return redraw({
        ...model,
        atlas: Option.some(atlas),
        busy: false,
        connected: realtime || model.connected,
        selectedMarket: model.selectedMarket || defaultMarket(atlas),
      });
    },
    ReceivedWorkspace: ({ workspace }) => redraw({ ...model, workspace: Option.some(workspace) }),
    Navigate: ({ section }) =>
      redraw({
        ...model,
        section,
        search: "",
        error: "",
        sceneReady: model.sceneReady && (section === "atlas" || section === "harbour"),
        channel: model.channel && (section === "atlas" || section === "harbour"),
        lens: section === "harbour" ? "mine" : model.lens,
      }),
    SelectedMarket: ({ id }) =>
      redraw({
        ...model,
        selectedMarket: id,
        section: model.section === "harbour" ? "harbour" : "atlas",
        exploded: false,
        tab: "overview",
      }),
    SelectedAgent: ({ id }) => ({
      model: { ...model, selectedAgent: id, section: "desk", sceneReady: false, channel: false, error: "" },
    }),
    SelectedLaunchThesis: ({ id, thesisId }) => ({
      model: { ...model, launchTheses: { ...model.launchTheses, [id]: thesisId } },
    }),
    ChangedLens: ({ lens }) => redraw({ ...model, lens }),
    ChangedSearch: ({ value }) => ({ model: { ...model, search: value } }),
    ChangedTab: ({ tab }) => ({ model: { ...model, tab } }),
    ToggleTheme: () => {
      const next: Model = { ...model, theme: model.theme === "day" ? "night" : "day" };
      return { model: next, commands: [SaveTheme({ theme: next.theme }), ...(next.sceneReady ? [draw(next)] : [])] };
    },
    ToggleExploded: () => redraw({ ...model, exploded: !model.exploded }),
    ToggleChannel: () => ({ model: { ...model, channel: !model.channel } }),
    ToggleSound: () => ({ model, commands: [SetSound({ enabled: !model.sound })] }),
    OpenModal: ({ modal }) => {
      const selectedAgent = model.selectedAgent || model.workspace.pipe(
        Option.flatMap(workspace => Array.findFirst(workspace.agents, agent => agent.owner === workspace.owner.id)),
        Option.map(agent => agent.id),
        Option.getOrElse(() => ""),
      );
      const next = { ...model, selectedAgent };
      return Result.match(openForm(next, modal), {
        onFailure: error => ({ model: { ...model, error: error.message } }),
        onSuccess: form => openDialog({ ...next, modal, form, error: "", notice: "" }),
      });
    },
    CloseModal: () => closeDialog({ ...model, error: "" }),
    GotDialogMessage: ({ message: childMessage }) => foldDialog(model, childMessage),
    UpdatedField: ({ name, value }) => ({ model: { ...model, form: { ...model.form, [name]: value } } }),
    SubmitForm: () =>
      Result.match(formAction(model), {
        onFailure: error => ({ model: { ...model, error: error.message } }),
        onSuccess: action => ({ model: { ...model, busy: true, error: "" }, commands: [SubmitAction({ action })] }),
      }),
    Act: ({ action }) => ({
      model: { ...model, busy: true, error: "", notice: "" },
      commands: [SubmitAction({ action })],
    }),
    CompletedAction: ({ result, workspace }) => {
      const wasAgent = model.modal === "agent";
      const next: Model = {
        ...model,
        workspace: Option.some(workspace),
        busy: false,
        notice: result.message,
        error: "",
        selectedAgent: wasAgent
          ? Option.getOrElse(Option.fromNullOr(result.id), () => model.selectedAgent)
          : model.selectedAgent,
        section: wasAgent ? "desk" : model.section,
        sceneReady: model.sceneReady && !wasAgent,
        channel: model.channel && !wasAgent,
        selectedMarket: Option.getOrElse(Option.fromNullOr(result.focusMarketId), () => model.selectedMarket),
        answer: model.question.length > 0 && Option.isSome(Option.fromNullOr(result.focusMarketId))
          ? result.message
          : model.answer,
      };
      return Update.combine(next, [
        closeDialog,
        current =>
          current.sceneReady
            ? {
              model: current,
              commands: [
                draw(current),
                ...(Option.isSome(Option.fromNullOr(result.focusMarketId)) ? [camera(current, "focus")] : []),
              ],
            }
            : { model: current },
      ]);
    },
    SetReplay: ({ block }) => ({
      model: { ...model, replayBlock: block, busy: true, channel: false },
      commands: [LoadSnapshot({ block })],
    }),
    Zoom: ({ direction }) => ({ model, commands: [camera(model, direction)] }),
    SceneChanged: ({ zoom }) => ({ model: { ...model, zoom } }),
    SceneMounted: () =>
      model.section === "atlas" || model.section === "harbour" ? redraw({ ...model, sceneReady: true }) : { model },
    SceneUpdated: () => ({ model }),
    CameraMoved: () => ({ model }),
    PreferenceSaved: () => ({ model }),
    SoundChanged: ({ enabled }) => ({ model: { ...model, sound: enabled } }),
    SetQuestion: ({ value }) => ({ model: { ...model, question: value } }),
    Ask: () =>
      model.question.trim().length > 0
        ? {
          model: { ...model, busy: true, error: "" },
          commands: [SubmitAction({ action: { tag: "ask", question: model.question } })],
        }
        : { model },
    CapturePlate: () => ({ model: { ...model, busy: true }, commands: [camera(model, "capture")] }),
    PlateCaptured: ({ blockNumber, marketId, title, view }) => ({
      model,
      commands: [SubmitAction({ action: { tag: "plate", blockNumber, title, marketId, view } })],
    }),
    Connected: ({ value }) => ({ model: { ...model, connected: value } }),
    Tick: () => {
      if (Option.isNone(model.workspace)) return { model };
      const active = model.channel
        ? model.atlas.pipe(Option.flatMap(atlas => Option.fromNullOr(atlas.activeMarketId)))
        : Option.none();
      return Option.match(active, {
        onNone: () => ({ model, commands: [ReloadWorkspace()] }),
        onSome: selectedMarket => {
          const next = { ...model, selectedMarket };
          return { model: next, commands: [ReloadWorkspace(), draw(next), camera(next, "focus")] };
        },
      });
    },
    ConnectWallet: () => ({ model: { ...model, busy: true, error: "" }, commands: [ConnectWallet()] }),
    WalletConnected: ({ workspace }) =>
      redraw({
        ...model,
        workspace: Option.some(workspace),
        busy: false,
        notice: "Owner address verified. This signature authorized no transaction.",
      }),
    DismissNotice: () => ({ model: { ...model, notice: "" } }),
  });
