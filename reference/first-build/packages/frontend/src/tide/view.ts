import { icon } from "@/_components/icons";
import { button, type H, humanKind, title } from "@/_components/ui";
import { compact, date, money, number } from "@/_lib/format";
import { Message } from "@/message";
import type { ViewState } from "@/state";
import { Array, Option } from "effect";

export const tide = (model: ViewState, h: H) => {
  const markets = model.atlas?.market.markets ?? [];
  const when = model.atlas?.market.blockTimestamp ?? model.date;
  return h.section([h.Class("page tide-page")], [
    h.div([h.Class("page-heading-row")], [
      title(h, "THE DAILY ALMANAC", "The tide table", `${date(when)} · Base harbour`),
      h.a([h.Href("/api/tide-table"), h.Target("_blank"), h.Rel("noopener noreferrer"), h.Class("button")], [
        icon(h, "download"),
        "Print / save PDF",
      ]),
    ]),
    h.div([h.Class("tide-intro")], [
      h.p([h.Class("editorial")], ["The shape of the market, set down in ink."]),
      h.p([h.Class("muted")], [
        `${markets.length} indexed works. Prices and reserves read at block ${
          number(model.atlas?.market.blockNumber, 0)
        }. These are observed readings.`,
      ]),
    ]),
    h.div([h.Class("table-scroll")], [h.table([h.Class("market-table")], [
      h.thead([], [
        h.tr(
          [],
          Array.map(
            ["The works", "Mechanism", "Price", "Observed change", "Liquidity", "Value moving"],
            heading => h.keyed("th")(heading, [], [heading]),
          ),
        ),
      ]),
      h.tbody(
        [],
        Array.map(markets, market =>
          h.keyed("tr")(market.id, [], [
            h.td([], [
              button(h, `${market.symbol} · ${market.name}`, Message.SelectedMarket({ id: market.id }), {
                class: "table-market",
              }),
            ]),
            h.td([], [humanKind(market)]),
            h.td([h.Class("mono")], [money(market.priceUsd)]),
            h.td([h.Class("mono")], [
              Option.match(Option.fromNullOr(market.change24h), {
                onNone: () => "—",
                onSome: value => `${number(value)}%`,
              }),
            ]),
            h.td([h.Class("mono")], [money(market.liquidityUsd)]),
            h.td([h.Class("mono")], [
              Option.match(Option.fromNullOr(market.valueMovingUsd), {
                onNone: () => "—",
                onSome: value => `$${compact(value)}`,
              }),
            ]),
          ])),
      ),
    ])]),
    h.div([h.Class("tide-bottom")], [
      h.p([h.Class("fine muted")], [
        "Value moving covers each pool’s sampled swap window. A dash means the source did not provide a reading.",
      ]),
      button(h, "Browse the plates", Message.Navigate({ section: "plates" }), { class: "text-button", icon: "atlas" }),
    ]),
  ]);
};
