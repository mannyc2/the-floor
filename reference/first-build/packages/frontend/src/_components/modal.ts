import * as Dialog from "@foldkit/ui/dialog";
import { Array } from "effect";
import type { Html } from "foldkit/html";
import { Message } from "../message";
import type { FormField, ViewState } from "../state";
import { icon } from "./icons";
import { button, type H, iconButton, owned } from "./ui";

const field = (model: ViewState, h: H, name: FormField, label: string, type = "text", placeholder = "") =>
  h.label([h.Class("field")], [
    h.span([h.Id(`field-${name}-label`)], [label]),
    h.input([
      h.AriaLabelledBy(`field-${name}-label`),
      h.Type(type),
      h.Name(name),
      h.Value(model.form[name]),
      h.Placeholder(placeholder),
      h.OnInput(value => Message.UpdatedField({ name, value })),
      ...(type === "number" ? [h.Min("0"), h.Step("any")] : []),
    ]),
  ]);
const area = (model: ViewState, h: H, name: FormField, label: string, rows = 4) =>
  h.label([h.Class("field")], [
    h.span([h.Id(`field-${name}-label`)], [label]),
    h.textarea([
      h.AriaLabelledBy(`field-${name}-label`),
      h.Name(name),
      h.Value(model.form[name]),
      h.Rows(rows),
      h.OnInput(value => Message.UpdatedField({ name, value })),
    ]),
  ]);
const choice = (
  model: ViewState,
  h: H,
  name: FormField,
  label: string,
  options: readonly (readonly [string, string])[],
) =>
  h.label([h.Class("field")], [
    h.span([h.Id(`field-${name}-label`)], [label]),
    h.select(
      [
        h.AriaLabelledBy(`field-${name}-label`),
        h.Name(name),
        h.Value(model.form[name]),
        h.OnChange(value => Message.UpdatedField({ name, value })),
      ],
      Array.map(options, ([value, text]) => h.keyed("option")(value, [h.Value(value)], [text])),
    ),
  ]);
const agentFields = (model: ViewState, h: H): Html[] => [
  field(model, h, "name", "Agent name", "text", "e.g. Wren"),
  area(model, h, "mandate", "Its mandate"),
  h.div([h.Class("form-two")], [
    choice(model, h, "visibility", "Who can see the desk", [["public", "Public research"], [
      "private",
      "Private to me",
    ]]),
    model.modal === "agent"
      ? choice(model, h, "emblem", "Emblem", [
        ["circle", "Circle"],
        ["triangle", "Triangle"],
        ["square", "Square"],
        ["diamond", "Diamond"],
        ["hexagon", "Hexagon"],
        ["cross", "Cross"],
        ["crescent", "Crescent"],
        ["star", "Star"],
      ])
      : choice(model, h, "publishMandate", "Publish the mandate", [["false", "Keep private"], ["true", "Publish it"]]),
  ]),
  h.div([h.Class("form-rule")], [
    h.h3([], ["Hard limits, confirmed by you"]),
    h.p([h.Class("fine muted")], [
      "Limits are enforced outside the model. Trading requires a connected scoped testnet account.",
    ]),
  ]),
  ...(model.modal === "agent"
    ? [
      h.p([h.Class("fine muted")], [
        "If this shape is in use, a small mark makes your emblem distinct within the district.",
      ]),
    ]
    : []),
  h.div([h.Class("form-two")], [
    field(model, h, "budget", "Inference budget / day ($)", "number"),
    field(model, h, "maxTrade", "Maximum trade ($)", "number"),
    field(model, h, "maxPosition", "Maximum position (%)", "number"),
    field(model, h, "threshold", "Ask before trades above ($)", "number"),
    field(model, h, "lossLimit", "Daily loss limit ($)", "number"),
    field(model, h, "slippage", "Slippage cap (basis points)", "number"),
  ]),
  h.details([h.Class("advanced-policy")], [
    h.summary([], ["Allowed protocols & launch policy"]),
    field(model, h, "protocols", "Allowed protocols", "text", "Comma-separated names"),
    field(model, h, "contracts", "Allowed contract addresses", "text", "0x…"),
    field(model, h, "methods", "Allowed methods", "text", "Exact allowed method names"),
    h.div([h.Class("form-two")], [
      choice(model, h, "launchAllowed", "May launch tokens", [["false", "No"], ["true", "Yes, on testnet"]]),
      field(model, h, "launchBudget", "Launch budget ($)", "number"),
    ]),
  ]),
];
const modalNames = {
  none: "",
  agent: "Give an agent a desk",
  policy: "Mandate & confirmed limits",
  alert: "Scribe a price line",
  design: "A design at the gate",
  launch: "Prepare a cast",
  withdraw: "Return ETH to your wallet",
} as const;
const submitLabels = {
  none: "Save",
  agent: "Confirm & create desk",
  policy: "Confirm limits",
  alert: "Scribe the line",
  design: "Run the gate",
  launch: "Save launch draft",
  withdraw: "Prepare withdrawal receipt",
} as const;
const fields = (model: ViewState, h: H): Html[] => {
  switch (model.modal) {
    case "withdraw":
      return [
        h.p([h.Class("muted")], [
          "Base Sepolia testnet ETH returns only to your verified owner wallet. You will review and approve the exact receipt before anything is sent.",
        ]),
        field(model, h, "amount", "ETH amount", "text", "0.001"),
        h.dl([h.Class("readings small")], [
          h.div([h.Class("reading-row")], [
            h.dt([], ["Fixed recipient"]),
            h.dd([h.Class("mono fine")], [model.workspace?.owner.walletAddress ?? "Connect your owner wallet first"]),
          ]),
        ]),
        h.p([h.Class("fine muted")], [
          "An owner withdrawal remains available while the agent is paused. The amount is entered exactly; it is not rounded to a dollar estimate.",
        ]),
      ];
    case "agent":
    case "policy":
      return agentFields(model, h);
    case "alert":
      return [
        h.p([h.Class("muted")], ["The flag rises when a new chain reading crosses your price."]),
        field(model, h, "price", "Price in USD", "number"),
        choice(model, h, "direction", "Raise the flag when price is", [["above", "At or above this line"], [
          "below",
          "At or below this line",
        ]]),
      ];
    case "design":
      return [
        h.p([h.Class("muted")], [
          "Use kit parts, instruments, and driver expressions tied to the submitted token. Every check is recorded; unavailable visual or location evidence remains pending review.",
        ]),
        area(model, h, "design", "Design submission (JSON)", 20),
      ];
    case "launch":
      return [
        choice(
          model,
          h,
          "agentId",
          "Launching agent",
          Array.map(owned(model), agent => [agent.id, agent.name] as const),
        ),
        h.div([h.Class("form-two")], [
          field(model, h, "name", "Token name"),
          field(model, h, "symbol", "Token symbol"),
        ]),
        area(model, h, "thesis", "Why this token, for whom, and on what sources?", 5),
        field(model, h, "allocation", "Agent allocation (%)", "number"),
        h.p([h.Class("service-note")], [
          "This saves a draft. Casting requires a connected testnet foundry. The allocation stays locked for seven days.",
        ]),
      ];
    case "none":
      return [];
  }
  return model.modal satisfies never;
};
export const modal = (model: ViewState, h: H) =>
  h.submodel({
    slotId: "owner-form",
    model: model.dialog,
    view: Dialog.view,
    toParentMessage: message => Message.GotDialogMessage({ message }),
    viewInputs: {
      toView: render =>
        h.dialog(
          [...render.dialog, h.Class("dialog-shell")],
          render.isVisible
            ? [
              h.div([...render.backdrop, h.Class("modal-backdrop")]),
              h.div([h.Class("modal-position")], [
                h.section([
                  ...render.panel,
                  h.Class(`modal${model.modal === "design" ? " wide-modal" : ""}`),
                ], [
                  h.div([h.Class("modal-heading")], [
                    h.div([], [
                      h.p([h.Class("eyebrow")], ["THE FLOOR / OWNER’S BOOK"]),
                      h.h2([...render.title], [modalNames[model.modal]]),
                    ]),
                    iconButton(h, "Close dialog", "close", Message.CloseModal()),
                  ]),
                  h.form([h.OnSubmit(Message.SubmitForm())], [
                    h.div([h.Class("modal-body")], [
                      ...fields(model, h),
                      ...(model.error.length === 0
                        ? []
                        : [h.p([h.Class("form-error"), h.Role("alert")], [model.error])]),
                    ]),
                    h.div([h.Class("modal-footer")], [
                      h.p([h.Class("fine muted")], ["Changes are saved in this workspace."]),
                      button(h, "Cancel", Message.CloseModal(), { class: "text-button" }),
                      h.button([h.Type("submit"), h.Class("button primary"), h.Disabled(model.busy)], [
                        model.busy ? "Saving…" : submitLabels[model.modal],
                        icon(h, "arrow"),
                      ]),
                    ]),
                  ]),
                ]),
              ]),
            ]
            : [],
        ),
    },
  });
