import { AtlasSnapshot, Workspace } from "@floor/surfaces";
import * as Dialog from "@foldkit/ui/dialog";
import { Option, Schema } from "effect";
export const Section = Schema.Literals([
  "atlas",
  "harbour",
  "research",
  "foundry",
  "tide",
  "settings",
  "desk",
  "community",
  "plates",
]);
export type Section = typeof Section.Type;
export const Lens = Schema.Literals(["flow", "liquidity", "attention", "risk", "mine"]);
export type Lens = typeof Lens.Type;
export const Theme = Schema.Literals(["day", "night"]);
export const Modal = Schema.Literals(["none", "agent", "alert", "policy", "design", "launch", "withdraw"]);
export const Form = Schema.Struct({
  name: Schema.String,
  mandate: Schema.String,
  emblem: Schema.String,
  visibility: Schema.String,
  publishMandate: Schema.String,
  budget: Schema.String,
  maxTrade: Schema.String,
  maxPosition: Schema.String,
  lossLimit: Schema.String,
  threshold: Schema.String,
  slippage: Schema.String,
  launchAllowed: Schema.String,
  launchBudget: Schema.String,
  protocols: Schema.String,
  contracts: Schema.String,
  methods: Schema.String,
  price: Schema.String,
  direction: Schema.String,
  agentId: Schema.String,
  allocation: Schema.String,
  design: Schema.String,
  symbol: Schema.String,
  thesis: Schema.String,
  amount: Schema.String,
});
export type Form = typeof Form.Type;
export type FormField = keyof Form;
export const emptyForm: Form = {
  name: "",
  mandate: "Watch Base markets. Check the source of every claim. Ask before trading.",
  emblem: "circle",
  visibility: "public",
  publishMandate: "false",
  budget: "2",
  maxTrade: "100",
  maxPosition: "5",
  lossLimit: "25",
  threshold: "50",
  slippage: "100",
  launchAllowed: "false",
  launchBudget: "0",
  protocols: "",
  contracts: "",
  methods: "",
  price: "0",
  direction: "above",
  agentId: "",
  allocation: "5",
  design: "",
  symbol: "",
  thesis: "",
  amount: "",
};
export const Flags = Schema.Struct({
  theme: Theme,
  selectedMarket: Schema.String,
  embedded: Schema.Boolean,
  origin: Schema.String,
  date: Schema.String,
});
export type Flags = typeof Flags.Type;
export const Model = Schema.Struct({
  atlas: Schema.Option(AtlasSnapshot),
  workspace: Schema.Option(Workspace),
  section: Section,
  lens: Lens,
  selectedMarket: Schema.String,
  selectedAgent: Schema.String,
  launchTheses: Schema.Record(Schema.String, Schema.String),
  search: Schema.String,
  theme: Theme,
  tab: Schema.Literals(["overview", "notes", "receipts"]),
  modal: Modal,
  dialog: Dialog.Model,
  form: Form,
  busy: Schema.Boolean,
  notice: Schema.String,
  error: Schema.String,
  replayBlock: Schema.Finite,
  exploded: Schema.Boolean,
  channel: Schema.Boolean,
  sound: Schema.Boolean,
  question: Schema.String,
  answer: Schema.String,
  zoom: Schema.String,
  connected: Schema.Boolean,
  embedded: Schema.Boolean,
  origin: Schema.String,
  date: Schema.String,
  sceneReady: Schema.Boolean,
});
export type Model = typeof Model.Type;
export const makeInitialModel = (flags: Flags): Model => ({
  atlas: Option.none(),
  workspace: Option.none(),
  section: "atlas",
  lens: "flow",
  selectedMarket: flags.selectedMarket,
  selectedAgent: "",
  launchTheses: {},
  search: "",
  theme: flags.theme,
  tab: "overview",
  modal: "none",
  dialog: Dialog.init({ id: "owner-form", focusSelector: "input, textarea, select" }),
  form: emptyForm,
  busy: false,
  notice: "",
  error: "",
  replayBlock: 0,
  exploded: false,
  channel: false,
  sound: false,
  question: "",
  answer: "",
  zoom: "island",
  connected: false,
  embedded: flags.embedded,
  origin: flags.origin,
  date: flags.date,
  sceneReady: false,
});
/** Nullable fields belong only to this read-only projection of decoded transport data. */
export interface ViewState extends Omit<Model, "atlas" | "workspace"> {
  // oxlint-disable-next-line effect/noNullish -- Read-only HTML projection; application state above retains Option.
  readonly atlas: AtlasSnapshot | null;
  // oxlint-disable-next-line effect/noNullish -- Read-only HTML projection; application state above retains Option.
  readonly workspace: Workspace | null;
}
export const projectView = (model: Model): ViewState => ({
  ...model,
  atlas: Option.getOrNull(model.atlas),
  workspace: Option.getOrNull(model.workspace),
});
