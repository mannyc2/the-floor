import { receiptCard } from "@/_components/evidence";
import { button, owned, tag, title } from "@/_components/ui";
import { Message } from "@/message";
import type { ViewState } from "@/state";
import type { LaunchDraft } from "@floor/surfaces";
import { Array, Option } from "effect";
import type { Html, HtmlBuilder } from "foldkit/html";

const castingRules = [
  ["thesis", "A sourced thesis, written before launch."],
  ["permission", "Permission and a launch budget confirmed by you."],
  ["frequency", "One launch per agent each day; three per owner each week."],
  ["allocation", "A seven-day allocation lock, enforced by the contract."],
  ["disclosure", "The launching agent and its allocation disclosed."],
] as const;

const blueprint = (h: HtmlBuilder<Message>): Html =>
  h.div([h.Class("foundry-blueprint")], [
    h.p([h.Class("eyebrow")], ["PROPOSED WORKS · TESTNET ONLY"]),
    h.svg([
      h.ViewBox("0 0 560 290"),
      h.Class("foundry-drawing"),
      h.Role("img"),
      h.AriaLabel("Blueprint of a foundry and graduation track"),
    ], [
      h.g([h.Fill("none"), h.Stroke("var(--blueprint)"), h.StrokeWidth("1")], [
        h.path([
          h.D(
            "M50 200 280 85 510 200 280 275Z M70 195 280 90 490 195 M280 275V260 M160 170V80L220 50 280 80v90l-60 30-60-30ZM160 80l60 30 60-30M220 110v90M180 150v-40m20 50v-40m40 40v-40m20 30v-40M315 213V160c0-80 90-10 140-85 M315 221V168c0-80 90-10 140-85 M446 66v38M440 70l12-6M100 195v-25l40-20v25l-40 20m0-25 30 15 M300 220l145-73",
          ),
        ]),
        h.circle([h.Cx("345"), h.Cy("139"), h.R("12")]),
        h.path([h.D(Array.makeBy(12, (tick) => `M${316 + tick * 11} ${199 - tick * 5}l4 6`).join(" "))]),
      ]),
    ]),
    h.p([h.Class("fine")], ["A curve becomes a pool at graduation. The allocation stays locked."]),
  ]);

const rules = (model: ViewState, h: HtmlBuilder<Message>): Html =>
  h.aside([h.Class("foundry-rules")], [
    h.h2([], ["Before the pour"]),
    ...Array.map(castingRules, ([id, rule], index) =>
      h.keyed("div")(id, [h.Class("numbered-rule")], [
        h.span([h.Class("mono")], [String(index + 1).padStart(2, "0")]),
        h.p([], [rule]),
      ])),
    h.p([h.Class("service-note")], [
      "Preparing a cast saves a draft. Submission requires your connected testnet account and foundry.",
    ]),
    ...(owned(model).length === 0
      ? [
        button(h, "Set up an agent first", Message.OpenModal({ modal: "agent" }), {
          class: "wide-button",
          icon: "agent",
        }),
      ]
      : []),
  ]);

const draftCard = (model: ViewState, h: HtmlBuilder<Message>, draft: LaunchDraft): Html => {
  const theses = Array.filter(
    model.workspace?.theses ?? [],
    thesis => thesis.agentId === draft.agentId && thesis.noteIds.length > 0,
  );
  const thesisId = model.launchTheses[draft.id]
    ?? Option.match(Array.head(theses), { onNone: () => "", onSome: thesis => thesis.id });
  const receipt = Array.findFirst(
    model.workspace?.receipts ?? [],
    item => item.id === draft.receiptId || item.proposalId === `launch:${draft.id}`,
  );
  return h.keyed("article")(draft.id, [h.Class("draft-card")], [
    h.div([h.Class("card-top")], [h.span([h.Class("smallcaps")], [draft.symbol]), tag(h, draft.status)]),
    h.h3([], [draft.name]),
    h.p([h.Class("agent-words")], [draft.thesis]),
    h.p([h.Class("mono fine")], [`Agent allocation: ${draft.allocationPercent}% · 7-day lock`]),
    ...Option.match(receipt, {
      onSome: item => [receiptCard(model, h, item)],
      onNone: () => [
        h.label([h.Class("field")], [
          h.span([h.Id(`thesis-${draft.id}`)], ["Sourced thesis for the cast"]),
          h.select(
            [
              h.AriaLabelledBy(`thesis-${draft.id}`),
              h.Value(thesisId),
              h.Disabled(theses.length === 0 || model.busy),
              h.OnChange(value => Message.SelectedLaunchThesis({ id: draft.id, thesisId: value })),
            ],
            theses.length > 0
              ? Array.map(theses, thesis => h.keyed("option")(thesis.id, [h.Value(thesis.id)], [thesis.belief]))
              : [h.option([h.Value("")], ["No sourced thesis yet"])],
          ),
        ]),
        h.p([h.Class("fine muted")], [
          theses.length > 0
            ? "The cast is checked against your confirmed launch policy and connected testnet account. Its exact instructions appear in a receipt."
            : "Run research from this agent’s desk to establish a thesis linked to source notes before submitting a cast.",
        ]),
        thesisId.length > 0
          ? button(
            h,
            "Submit testnet cast",
            Message.Act({ action: { tag: "submit-launch", id: draft.id, thesisId } }),
            {
              disabled: model.busy,
              class: "button",
            },
          )
          : h.button([h.Type("button"), h.Class("button"), h.Disabled(true)], ["Submit testnet cast"]),
      ],
    }),
  ]);
};

export const foundry = (model: ViewState, h: HtmlBuilder<Message>): Html => {
  const drafts = model.workspace?.launches ?? [];
  return h.section([h.Class("page foundry-page")], [
    h.div([h.Class("page-heading-row")], [
      title(
        h,
        "AT THE EDGE OF THE ISLAND",
        "The foundry",
        "A new token begins with a thesis. The machinery comes after.",
      ),
      button(h, "Prepare a cast", Message.OpenModal({ modal: "launch" }), {
        icon: "plus",
        class: "button primary",
        disabled: owned(model).length === 0,
      }),
    ]),
    h.div([h.Class("foundry-layout")], [blueprint(h), rules(model, h)]),
    h.div([h.Class("section-heading")], [
      h.h2([], ["The casting book"]),
      h.span([h.Class("mono muted")], [`${drafts.length} drafts`]),
    ]),
    drafts.length > 0
      ? h.div([h.Class("draft-grid")], Array.map(drafts, (draft) => draftCard(model, h, draft)))
      : h.p([h.Class("muted")], ["No casts prepared yet. The yard is quiet."]),
  ]);
};
