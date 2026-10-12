import { AtlasEvidence } from "@floor/renderer/evidence";
import { Action, ActionResult, AtlasSnapshot, Workspace } from "@floor/surfaces";
import * as Dialog from "@foldkit/ui/dialog";
import { Record, Schema } from "effect";
import { defineMessageUnion } from "foldkit/message";
import { Form, Lens, Model, Section, Theme } from "./state";
export const Message = defineMessageUnion({
  Booted: { atlas: AtlasSnapshot, workspace: Schema.Option(Workspace) },
  Failed: { error: Schema.String },
  ReceivedAtlas: { atlas: AtlasSnapshot, realtime: Schema.Boolean },
  ReceivedWorkspace: { workspace: Workspace },
  Navigate: { section: Section },
  SelectedMarket: { id: Schema.String },
  SelectedAgent: { id: Schema.String },
  SelectedLaunchThesis: { id: Schema.String, thesisId: Schema.String },
  ChangedLens: { lens: Lens },
  ChangedSearch: { value: Schema.String },
  ToggleTheme: {},
  ToggleExploded: {},
  ToggleChannel: {},
  ToggleSound: {},
  ChangedTab: { tab: Model.fields.tab },
  OpenModal: { modal: Model.fields.modal },
  CloseModal: {},
  GotDialogMessage: { message: Dialog.Message },
  UpdatedField: { name: Schema.Literals(Record.keys(Form.fields)), value: Schema.String },
  SubmitForm: {},
  Act: { action: Action },
  CompletedAction: { result: ActionResult, workspace: Workspace },
  SetReplay: { block: Schema.Finite },
  Zoom: { direction: Schema.Literals(["in", "out", "reset"]) },
  SceneChanged: { zoom: Schema.String },
  SetQuestion: { value: Schema.String },
  Ask: {},
  CapturePlate: {},
  PlateCaptured: {
    blockNumber: Schema.Int,
    marketId: Schema.String,
    title: Schema.String,
    view: Schema.Literals(["archipelago", "island", "district", "works", "machine"]),
  },
  Connected: { value: Schema.Boolean },
  Tick: {},
  SceneMounted: {},
  SceneUpdated: {},
  CameraMoved: {},
  PreferenceSaved: {},
  SoundChanged: { enabled: Schema.Boolean },
  ConnectWallet: {},
  WalletConnected: { workspace: Workspace },
  DismissNotice: {},
});
export type Message = typeof Message.Type;
export const SceneState = Schema.Struct({
  atlas: Schema.Option(AtlasSnapshot),
  evidence: Schema.Option(AtlasEvidence),
  selected: Schema.String,
  theme: Theme,
  lens: Lens,
  exploded: Schema.Boolean,
  moorings: Schema.Array(Schema.String),
});
export type SceneState = typeof SceneState.Type;
export const CameraAction = Schema.Literals(["in", "out", "reset", "capture", "focus"]);
