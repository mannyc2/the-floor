import { icon } from "@/_components/icons";
import { button, empty, type H, title } from "@/_components/ui";
import { date, number } from "@/_lib/format";
import { Message } from "@/message";
import type { ViewState } from "@/state";
import { Array } from "effect";

export const plates = (model: ViewState, h: H) => {
  const items = model.workspace?.plates ?? [];
  return h.section([h.Class("page")], [
    h.div([h.Class("page-heading-row")], [
      title(h, "THE PERMANENT RECORD", "Numbered plates", "A view, a source block, and the receipts behind it."),
      button(h, "Return to the atlas", Message.Navigate({ section: "atlas" }), { icon: "atlas" }),
    ]),
    items.length === 0
      ? empty(h, "A moment worth keeping", "Capture an instrument from the atlas. Its plate number is permanent.")
      : h.div(
        [h.Class("plate-grid")],
        Array.map(items, plate =>
          h.keyed("article")(String(plate.number), [h.Class("plate-card")], [
            h.img([h.Src(`/api/plates/${plate.number}/image`), h.Alt(plate.title)]),
            h.h3([], [`Plate ${plate.number}: ${plate.title}`]),
            h.p([h.Class("mono fine")], [`${date(plate.createdAt)} · block ${number(plate.blockNumber, 0)}`]),
            h.a([
              h.Href(`/plates/${plate.number}`),
              h.Target("_blank"),
              h.Rel("noopener noreferrer"),
              h.Class("text-button"),
            ], ["Open permanent record", icon(h, "arrow", 14)]),
            h.a([
              h.Href(`/api/plates/${plate.number}/image`),
              h.Download(`floor-plate-${plate.number}.png`),
              h.Class("text-button"),
            ], ["Download plate", icon(h, "download", 14)]),
          ])),
      ),
  ]);
};
