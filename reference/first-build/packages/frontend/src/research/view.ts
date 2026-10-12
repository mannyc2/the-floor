import { noteCard } from "@/_components/evidence";
import { icon } from "@/_components/icons";
import { button, empty, type H, stat, title } from "@/_components/ui";
import { Message } from "@/message";
import type { ViewState } from "@/state";
import { Array } from "effect";

export const research = (model: ViewState, h: H) => {
  const notes = model.workspace?.notes ?? [];
  return h.section([h.Class("page")], [
    h.div([h.Class("page-heading-row")], [
      title(
        h,
        "THE DISTRICT LIBRARY",
        "Research, with its sources",
        "Claims are checked. Positions are disclosed. Curiosity leaves a paper trail.",
      ),
      button(h, "Visit the desks", Message.Navigate({ section: "desk" }), { icon: "agent" }),
    ]),
    h.div([h.Class("research-summary")], [
      stat(h, "PUBLIC & YOUR NOTES", String(notes.length)),
      stat(h, "VERIFIED ON CHAIN", String(Array.filter(notes, note => note.status === "verified").length)),
      stat(h, "CONTRADICTED", String(Array.filter(notes, note => note.status === "contradicted").length)),
    ]),
    notes.length > 0
      ? h.div([h.Class("note-grid")], Array.map(notes, note => noteCard(model, h, note)))
      : empty(
        h,
        "The library begins with a question",
        "Create an agent to investigate a market. Each note carries its sources and a position disclosure.",
        button(h, "Set up an agent", Message.OpenModal({ modal: "agent" }), { icon: "plus" }),
      ),
    h.div([h.Class("harbourmaster-box")], [
      h.div([], [
        h.p([h.Class("eyebrow")], ["ASK THE HARBOURMASTER"]),
        h.h2([], ["Where did the current go?"]),
        h.p([h.Class("muted")], [
          "Ask which indexed pools are busiest or thinnest. The answer leads back to a source block.",
        ]),
      ]),
      h.form([h.OnSubmit(Message.Ask()), h.Class("question-form")], [
        h.input([
          h.AriaLabel("Ask the harbourmaster"),
          h.Placeholder("Which pools are thinnest?"),
          h.Value(model.question),
          h.OnInput(value => Message.SetQuestion({ value })),
        ]),
        h.button([h.Type("submit"), h.Class("button"), h.Disabled(model.busy)], ["Ask", icon(h, "arrow")]),
      ]),
      ...(model.answer.length === 0 ? [] : [h.p([h.Class("harbourmaster-answer")], [model.answer])]),
      ...(model.answer.length === 0
        ? []
        : [
          button(h, "Show the referenced works", Message.SelectedMarket({ id: model.selectedMarket }), {
            class: "text-button",
            icon: "atlas",
          }),
        ]),
    ]),
  ]);
};
