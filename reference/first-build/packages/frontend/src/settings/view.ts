import { button, type H, tag, title } from "@/_components/ui";
import { shortAddress } from "@/_lib/format";
import { Message } from "@/message";
import type { ViewState } from "@/state";
import { Array, Option } from "effect";

export const settings = (model: ViewState, h: H) => {
  const wallet = Option.fromNullishOr(model.workspace?.owner.walletAddress);
  return h.section([h.Class("page settings-page")], [
    title(
      h,
      "YOUR WORKSPACE",
      "Connections & preferences",
      "Bring your services when you are ready. The map reads the chain independently.",
    ),
    h.div([h.Class("settings-grid")], [
      h.section([h.Class("settings-card")], [
        h.h2([], ["Owner identity"]),
        h.p([h.Class("muted")], [
          Option.isSome(wallet)
            ? "Your wallet has signed the workspace challenge."
            : "A wallet signature connects your owner address to this local workspace.",
        ]),
        h.p([h.Class("mono")], [
          Option.isSome(wallet) ? shortAddress(wallet.value) : "Local owner · no wallet connected",
        ]),
        button(h, Option.isSome(wallet) ? "Verify another wallet" : "Connect owner wallet", Message.ConnectWallet(), {
          disabled: model.busy,
        }),
        h.hr([]),
        h.h3([], ["The drawing"]),
        h.div([h.Class("settings-row")], [
          h.span([], ["Colour theme"]),
          button(h, model.theme === "day" ? "Day" : "Night", Message.ToggleTheme(), {
            icon: model.theme === "day" ? "sun" : "moon",
          }),
        ]),
        h.div([h.Class("settings-row")], [
          h.span([], ["Ambient sound"]),
          button(h, model.sound ? "On" : "Off", Message.ToggleSound()),
        ]),
        h.p([h.Class("fine muted")], ["Sound is off by default. Reduced-motion preferences are respected."]),
      ]),
      h.section([h.Class("settings-card")], [
        h.h2([], ["Service ledger"]),
        ...Array.map(
          model.workspace?.services ?? [],
          service =>
            h.keyed("div")(service.name, [h.Class("service-row")], [
              h.div([h.Class("service-name")], [
                h.span([h.Class(`connection-dot${service.configured ? " live" : ""}`)]),
                h.strong([], [service.name]),
                tag(h, service.configured ? "Configured" : "Not configured"),
              ]),
              h.p([h.Class("muted")], [service.detail]),
            ]),
        ),
        h.p([h.Class("fine muted")], [
          "Provider credentials stay on the local server. Configured services are checked when used. See the setup guide included with this application.",
        ]),
      ]),
    ]),
    h.section([h.Class("settings-card integrations")], [
      h.h2([], ["For other agents & sites"]),
      h.p([h.Class("muted")], ["The read-only MCP endpoint serves the same market record and public research."]),
      h.code([], [`${model.origin}/mcp`]),
      h.p([h.Class("muted")], ["Embed a works with the custom element. Every embed links back to its source."]),
      h.code([], [
        `<script src="${model.origin}/embed.js"></script>\n<floor-works market="${model.selectedMarket}"></floor-works>`,
      ]),
    ]),
  ]);
};
