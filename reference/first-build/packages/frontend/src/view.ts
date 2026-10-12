import { Array, Option } from "effect";
import type { Document } from "foldkit/html";
import type { MountAction } from "foldkit/mount";
import { emblem, icon, type IconName } from "./_components/icons";
import { modal } from "./_components/modal";
import { button, type H, iconButton, selected } from "./_components/ui";
import { number } from "./_lib/format";
import { atlas, marketPanel } from "./atlas/view";
import { community } from "./community/view";
import { desk } from "./desk/view";
import { foundry } from "./foundry/view";
import { Message } from "./message";
import { plates } from "./plates/view";
import { research } from "./research/view";
import { settings } from "./settings/view";
import { type Model, projectView, type Section, type ViewState } from "./state";
import { tide } from "./tide/view";

const header = (model: ViewState, h: H) =>
  h.header([h.Class("masthead")], [
    h.button([h.Class("wordmark"), h.OnClick(Message.Navigate({ section: "atlas" })), h.AriaLabel("The Floor home")], [
      h.span([h.Class("brand-mark")], [icon(h, "atlas", 25)]),
      "The Floor",
      h.span([h.Class("wordmark-rule")]),
      h.span([h.Class("brand-caption")], ["An atlas of working markets"]),
    ]),
    h.div([h.Class("masthead-right")], [
      h.span([h.Class("edition")], ["BASE EDITION", h.small([], ["A living record"])]),
      iconButton(
        h,
        model.theme === "day" ? "Switch to night" : "Switch to day",
        model.theme === "day" ? "moon" : "sun",
        Message.ToggleTheme(),
      ),
      button(h, "Your agents", Message.Navigate({ section: "desk" }), {
        icon: "agent",
        class: "button compact-button",
      }),
      h.button([
        h.Class("owner-mark"),
        h.Title("Workspace settings"),
        h.AriaLabel("Workspace settings"),
        h.OnClick(Message.Navigate({ section: "settings" })),
      ], [emblem(h, "diamond", 17)]),
    ]),
  ]);
const navigationItems: readonly (readonly [Section, string, IconName])[] = [
  ["atlas", "The atlas", "atlas"],
  ["harbour", "My harbour", "harbour"],
  ["research", "Research", "research"],
  ["foundry", "Foundry", "foundry"],
  ["tide", "Tide table", "tide"],
];
const navigation = (model: ViewState, h: H) =>
  h.div([h.Class("navigation-row")], [
    h.nav(
      [h.AriaLabel("Main navigation")],
      Array.map(navigationItems, ([section, label, name]) =>
        h.keyed("button")(section, [
          h.Class(`nav-item${model.section === section ? " active" : ""}`),
          h.OnClick(Message.Navigate({ section })),
          h.AriaPressed(String(model.section === section)),
        ], [icon(h, name, 16), label])),
    ),
    h.div([h.Class("search")], [
      icon(h, "search", 15),
      h.input([
        h.Type("search"),
        h.AriaLabel("Find a market"),
        h.Placeholder("Find a market…"),
        h.Value(model.search),
        h.OnInput(value => Message.ChangedSearch({ value })),
      ]),
    ]),
    button(h, "Make a plate", Message.CapturePlate(), {
      class: "text-button plate-button",
      icon: "download",
      disabled: Option.isNone(selected(model)) || model.busy || !model.sceneReady,
    }),
  ]);
const page = (model: ViewState, h: H) => {
  switch (model.section) {
    case "desk":
      return desk(model, h);
    case "research":
      return research(model, h);
    case "foundry":
      return foundry(model, h);
    case "tide":
      return tide(model, h);
    case "settings":
      return settings(model, h);
    case "community":
      return community(model, h);
    case "plates":
      return plates(model, h);
    case "atlas":
    case "harbour":
      return h.empty;
  }
  return model.section satisfies never;
};
export const view = (state: Model, h: H, mount: MountAction<Message>): Document => {
  const model = projectView(state);
  const onMap = model.section === "atlas" || model.section === "harbour";
  const mode = model.atlas?.market.status.mode;
  return {
    title: "The Floor — a working atlas",
    body: h.div([
      h.Class(`app ${model.theme}${model.embedded ? " embedded" : ""}`),
      h.DataAttribute("theme", model.theme),
    ], [
      header(model, h),
      navigation(model, h),
      h.main([h.Class("main")], [
        onMap
          ? h.keyed("div")("atlas-layout", [h.Class("atlas-layout")], [atlas(model, h, mount), marketPanel(model, h)])
          : page(model, h),
      ]),
      h.footer([h.Class("app-footer")], [
        h.span([], [
          h.span([h.Class(`connection-dot${mode === "live" ? " live" : ""}`)]),
          mode === "live" ? "Reading Base" : mode === "recording" ? "Recorded chain data" : "Connecting to Base",
        ]),
        h.span([h.Class("mono")], [
          Option.isNone(state.atlas) ? "WAITING FOR A BLOCK" : `BLOCK ${number(model.atlas?.market.blockNumber, 0)}`,
        ]),
        h.span([h.Class("footer-motto")], ["Every movement has a source."]),
        button(h, "Connections", Message.Navigate({ section: "settings" }), { class: "text-button", icon: "settings" }),
      ]),
      ...(model.notice.length > 0 && model.modal === "none"
        ? [
          h.div([h.Class("toast"), h.Role("status")], [
            icon(h, "check"),
            h.p([], [model.notice]),
            iconButton(h, "Dismiss notice", "close", Message.DismissNotice()),
          ]),
        ]
        : []),
      ...(model.error.length > 0 && model.modal === "none"
        ? [
          h.div([h.Class("toast error"), h.Role("alert")], [
            h.p([], [model.error]),
            iconButton(h, "Dismiss error", "close", Message.CloseModal()),
          ]),
        ]
        : []),
      modal(model, h),
    ]),
  };
};
