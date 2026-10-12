import { noteCard, receiptCard } from "@/_components/evidence";
import { icon } from "@/_components/icons";
import { button, empty, type H, humanKind, iconButton, link, readingRow, selected, tag } from "@/_components/ui";
import { compact, date, money, number, shortAddress, time } from "@/_lib/format";
import { viewEvidence } from "@/_lib/market-evidence";
import { Message } from "@/message";
import type { ViewState } from "@/state";
import type { MarketView } from "@floor/markets/schema";
import { Array, Option } from "effect";
import { chart } from "./chart";

const readings = (model: ViewState, h: H, market: MarketView) => {
  const moored = model.workspace?.moorings.includes(market.id) ?? false;
  return [
    h.dl([h.Class("readings")], [
      readingRow(h, "Liquidity", money(market.liquidityUsd)),
      readingRow(h, "Value moving", money(market.valueMovingUsd)),
      readingRow(
        h,
        "Observed trades",
        Option.match(Option.fromNullOr(market.flow), {
          onNone: () => "Unavailable",
          onSome: flow => String(flow.trades),
        }),
      ),
      readingRow(h, `${market.token0.symbol} reserve`, compact(market.reading.reserve0)),
      readingRow(h, `${market.token1.symbol} reserve`, compact(market.reading.reserve1)),
      readingRow(h, "Mechanism", humanKind(market)),
    ]),
    h.p([h.Class("fine muted")], [
      Option.match(Option.fromNullOr(market.flow), {
        onNone: () => "Swap-window data is unavailable for this reading.",
        onSome: flow => `Flow measured across ${flow.windowSeconds} seconds, blocks ${flow.fromBlock}–${flow.toBlock}.`,
      }),
    ]),
    button(h, model.exploded ? "Reassemble the instrument" : "Look inside the mechanism", Message.ToggleExploded(), {
      class: "wide-button",
      icon: "expand",
    }),
    ...(model.embedded ? [] : [h.div([h.Class("panel-actions")], [
      button(h, moored ? "Moored" : "Moor market", Message.Act({ action: { tag: "moor", marketId: market.id } }), {
        icon: "pin",
        class: moored ? "button selected" : "button",
      }),
      button(h, "Scribe a line", Message.OpenModal({ modal: "alert" }), { icon: "flag" }),
    ])]),
    ...Array.map(
      Array.filter(model.workspace?.alerts ?? [], alert => alert.marketId === market.id),
      alert =>
        h.keyed("div")(alert.id, [h.Class("scribed-line")], [
          icon(h, "flag", 14),
          h.span([], [`${alert.crossed ? "Crossed" : "Watching"} ${alert.direction} ${money(alert.price)}`]),
          iconButton(h, "Remove alert", "close", Message.Act({ action: { tag: "delete-alert", id: alert.id } })),
        ]),
    ),
    h.div([h.Class("source-box")], [
      h.p([h.Class("eyebrow")], ["A READING, WITH ITS SOURCE"]),
      h.p([h.Class("mono")], [`Base · block ${number(market.reading.provenance.blockNumber, 0)}`]),
      h.small([h.Class("muted")], [
        `${date(market.reading.provenance.blockTimestamp)} · ${
          time(market.reading.provenance.blockTimestamp)
        } · ${market.reading.provenance.source}`,
      ]),
      link(h, shortAddress(market.address), `https://basescan.org/address/${market.address}`),
      link(h, "Share this market", `${model.origin}/markets/${encodeURIComponent(market.id)}`),
    ]),
  ];
};

const populatedPanel = (model: ViewState, h: H, market: MarketView) => {
  const active = model.atlas?.activeMarketId === market.id;
  const moored = model.workspace?.moorings.includes(market.id) ?? false;
  const evidence = viewEvidence(model);
  const notes = Option.match(evidence, {
    onNone: () => [],
    onSome: current => Array.filter(current.notes, note => note.marketId === market.id),
  });
  const receipts = Option.match(evidence, {
    onNone: () => [],
    onSome: current => Array.filter(current.receipts, receipt => receipt.marketId === market.id),
  });
  const tabs = [["overview", "Readings"], ["notes", `Notes ${notes.length}`], [
    "receipts",
    `Receipts ${receipts.length}`,
  ]] as const;
  const content = model.tab === "overview"
    ? readings(model, h, market)
    : model.tab === "notes"
    ? notes.length > 0
      ? Array.map(notes, note => noteCard(model, h, note))
      : [
        empty(
          h,
          "No pins on this works yet",
          "Sourced observations will appear here.",
          model.embedded
            ? h.empty
            : button(h, "Open an agent desk", Message.OpenModal({ modal: "agent" }), { class: "text-button" }),
        ),
      ]
    : receipts.length > 0
    ? Array.map(receipts, receipt => receiptCard(model, h, receipt))
    : [empty(h, "A clean ledger", "Every proposal, refusal, and completed transaction leaves a receipt.")];
  return h.aside([h.Class("market-panel"), h.AriaLabel("Selected market")], [
    h.div([h.Class("panel-topline")], [
      h.span([h.Class("eyebrow")], ["INSTRUMENT RECORD"]),
      h.span([h.Class("mono muted")], ["01 / BASE"]),
    ]),
    h.div([h.Class("market-title-row")], [
      h.div([h.Class("token-mark")], [market.symbol.slice(0, 2)]),
      h.div([], [h.h2([], [market.symbol]), h.p([h.Class("muted")], [market.name])]),
      model.embedded ? h.empty : iconButton(
        h,
        moored ? "Release mooring" : "Moor this market",
        "pin",
        Message.Act({ action: { tag: "moor", marketId: market.id } }),
      ),
    ]),
    h.div([h.Class("market-tags")], [
      tag(h, market.venue),
      tag(h, humanKind(market)),
      ...(active ? [tag(h, "Busiest observed")] : []),
    ]),
    h.div([h.Class("price-readout")], [
      h.span([h.Class("eyebrow")], ["CURRENT PRICE"]),
      h.strong([h.Class("mono")], [money(market.priceUsd)]),
      h.span([h.Class("price-change mono")], [Option.match(Option.fromNullOr(market.change24h), {
        onNone: () => "Change unavailable",
        onSome: value => `${number(value)}% observed`,
      })]),
    ]),
    h.div([h.Class("panel-chart")], [
      chart(h, Array.map(market.history, point => point.price), 95),
      h.div([h.Class("chart-caption")], [
        h.span([], ["Observed tide"]),
        h.span([h.Class("mono")], [`${market.history.length} blocks sampled`]),
      ]),
    ]),
    h.div(
      [h.Class("panel-tabs")],
      Array.map(
        tabs,
        ([tab, label]) =>
          h.keyed("button")(tab, [h.Class(model.tab === tab ? "active" : ""), h.OnClick(Message.ChangedTab({ tab }))], [
            label,
          ]),
      ),
    ),
    h.div([h.Class("panel-body")], content),
    h.div([h.Class("panel-bottom")], [
      model.embedded
        ? link(h, "Open this works on The Floor", `${model.origin}/?market=${encodeURIComponent(market.id)}`)
        : button(h, "Community workshop", Message.Navigate({ section: "community" }), {
          class: "text-button",
          icon: "foundry",
        }),
      h.span([h.Class("fine muted")], ["Free form. Honest readings."]),
    ]),
  ]);
};

export const marketPanel = (model: ViewState, h: H) =>
  Option.match(selected(model), {
    onNone: () =>
      h.aside([h.Class("market-panel")], [
        empty(h, "Every works has a story", "Choose an instrument to inspect its source readings."),
      ]),
    onSome: market => populatedPanel(model, h, market),
  });
