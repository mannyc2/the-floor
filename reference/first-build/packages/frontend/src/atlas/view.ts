import { button, type H, iconButton, selected, stat } from "@/_components/ui";
import { compact, date, number, time } from "@/_lib/format";
import { Message } from "@/message";
import type { Lens, ViewState } from "@/state";
import { Array, Option } from "effect";
import type { MountAction } from "foldkit/mount";
import { chart } from "./_components/chart";
import { tideStamps } from "./_components/tide-stamps";
export { marketPanel } from "./_components/panel";

const timeline = (model: ViewState, h: H) => {
  const blocks = model.atlas?.historyBlocks ?? [];
  const current = model.replayBlock > 0
    ? Math.max(0, blocks.findIndex(block => block.blockNumber === model.replayBlock))
    : Math.max(0, blocks.length - 1);
  const first = Array.head(blocks);
  const last = Array.last(blocks);
  const market = selected(model);
  return h.div([h.Class("timeline")], [
    h.div([h.Class("timeline-top")], [
      h.div([], [
        h.span([h.Class("eyebrow")], ["THE TIDE RECORD"]),
        h.span([h.Class("mono")], [Option.match(market, {
          onNone: () => "Price history",
          onSome: item => `${item.symbol} / ${item.quote.symbol}`,
        })]),
      ]),
      h.button([
        h.Class(`live-button${model.replayBlock === 0 ? " active" : ""}`),
        h.OnClick(Message.SetReplay({ block: 0 })),
      ], [h.span([h.Class("connection-dot")]), "Now"]),
    ]),
    h.div([h.Class("timeline-paper")], [
      chart(
        h,
        Option.match(market, { onNone: () => [], onSome: item => Array.map(item.history, point => point.price) }),
        160,
        "timeline-chart",
      ),
      Option.match(market, { onNone: () => h.empty, onSome: item => tideStamps(model, h, item) }),
    ]),
    h.input([
      h.Type("range"),
      h.AriaLabel("Replay block"),
      h.Min("0"),
      h.Max(String(Math.max(0, blocks.length - 1))),
      h.Step("1"),
      h.Value(String(current)),
      h.Disabled(blocks.length < 2),
      h.OnInput(value => Message.SetReplay({ block: blocks[Number(value)]?.blockNumber ?? 0 })),
    ]),
    h.div([h.Class("timeline-labels")], [
      h.span([], [
        Option.match(first, {
          onNone: () => "Waiting for history",
          onSome: block => `${date(block.timestamp)} · ${time(block.timestamp)}`,
        }),
      ]),
      h.span([h.Class("mono")], [
        model.replayBlock > 0 ? `BLOCK ${number(model.replayBlock, 0)}` : "Drag the paper to rewind",
      ]),
      h.span([], [Option.match(last, { onNone: () => "Now", onSome: block => time(block.timestamp) })]),
    ]),
  ]);
};

const lenses: readonly (readonly [Lens, string])[] = [
  ["flow", "Flow"],
  ["liquidity", "Liquidity"],
  ["attention", "Attention"],
  ["risk", "Risk"],
  ["mine", "Mine"],
];
export const atlas = (model: ViewState, h: H, mount: MountAction<Message>) => {
  const data = model.atlas?.market;
  const markets = data?.markets ?? [];
  const visible = Array.filter(
    markets,
    market =>
      `${market.symbol} ${market.name} ${market.venue}`.toLowerCase().includes(model.search.toLowerCase())
      && (model.section !== "harbour" || (model.workspace?.moorings.includes(market.id) ?? false)),
  );
  return h.section([h.Class("atlas-column"), h.AriaLabel("Market atlas")], [
    h.div([h.Class("atlas-heading")], [
      h.div([], [
        h.p([h.Class("eyebrow")], [model.section === "harbour" ? "YOUR PRIVATE ANCHORAGE" : "ISLAND I · BASE"]),
        h.h1([], [model.section === "harbour" ? "Your harbour" : "The Base harbour"]),
        h.p([h.Class("atlas-subtitle")], [
          model.replayBlock > 0
            ? `A record of ${time(data?.blockTimestamp ?? model.date)}.`
            : "Real markets. Instruments in motion.",
        ]),
      ]),
      h.div([h.Class("view-path")], [
        h.span([], ["Floor"]),
        h.span([], ["›"]),
        h.span([], ["Base"]),
        h.span([], ["›"]),
        h.strong([], [model.zoom]),
      ]),
    ]),
    h.div([h.Class("lens-bar"), h.AriaLabel("Map lenses")], [
      h.span([h.Class("eyebrow")], ["LENS"]),
      ...Array.map(lenses, ([lens, label]) =>
        h.keyed("button")(lens, [
          h.Class(`lens${model.lens === lens ? " active" : ""}`),
          h.OnClick(Message.ChangedLens({ lens })),
          h.AriaPressed(String(model.lens === lens)),
        ], [label])),
      h.div([h.Class("lens-spacer")]),
      h.span([h.Class("data-mode")], [
        model.replayBlock > 0 ? "REPLAY" : data?.source === "recording" ? "RECORDING" : "ON CHAIN",
      ]),
    ]),
    h.div([h.Class("scene-wrap")], [
      h.div([
        h.Id("atlas-host"),
        h.Class("atlas-host"),
        h.AriaLabel("Isometric map of Base markets"),
        h.OnMount(mount),
      ]),
      ...(markets.length === 0
        ? [
          h.div([h.Class("loading-state"), h.Role("status")], [
            h.div([h.Class("loading-rule")]),
            h.p([], ["Reading the harbour…"]),
            h.small([], ["Waiting for its first source block."]),
          ]),
        ]
        : []),
      h.div([h.Class("compass"), h.AriaHidden(true)], [h.span([], ["N"]), h.span([h.Class("compass-rose")], ["✧"])]),
      h.div([h.Class("scene-controls")], [
        iconButton(h, "Zoom in", "plus", Message.Zoom({ direction: "in" })),
        iconButton(h, "Zoom out", "minus", Message.Zoom({ direction: "out" })),
        iconButton(h, "Fit island", "expand", Message.Zoom({ direction: "reset" })),
      ]),
      h.div([h.Class("scene-caption")], [
        h.span([h.Class("smallcaps")], ["The harbour works"]),
        h.span([], ["Orthographic survey · 30°"]),
      ]),
      h.div([h.Class("scene-hint")], [
        h.span([h.Class("key")], ["E"]),
        "Explode the instrument",
        h.span([h.Class("hint-rule")]),
        "Drag to pan · scroll to explore",
      ]),
      ...(model.search.length > 0
        ? [
          h.div([h.Class("search-results")], [
            h.p([h.Class("eyebrow")], [`${visible.length} MATCHING WORKS`]),
            ...Array.map(
              visible,
              market =>
                button(h, `${market.symbol} / ${market.quote.symbol}`, Message.SelectedMarket({ id: market.id }), {
                  class: "search-result",
                  key: market.id,
                }),
            ),
          ]),
        ]
        : []),
      ...(model.section === "harbour" && visible.length === 0
        ? [
          h.div([h.Class("harbour-empty")], [
            h.h2([], ["A place to return to"]),
            h.p([], ["Moor a market from its instrument panel."]),
            button(h, "Explore the atlas", Message.Navigate({ section: "atlas" })),
          ]),
        ]
        : []),
    ]),
    h.div([h.Class("map-legend")], [
      h.div([], [h.span([h.Class("legend-swatch brass")]), "Data-bound instrument"]),
      h.div([], [h.span([h.Class("legend-swatch water")]), "Liquidity"]),
      h.div([], [h.span([h.Class("legend-swatch line")]), "Structure"]),
      h.span([h.Class("legend-note")], ["The busiest measured pour is lit."]),
    ]),
    h.div([h.Class("map-summary")], [
      stat(h, "INDEXED WORKS", String(markets.length), "Base · observed chain data"),
      stat(
        h,
        "INDEXED LIQUIDITY",
        `$${compact(Array.reduce(markets, 0, (sum, market) => sum + (market.liquidityUsd ?? 0)))}`,
        "Across the displayed pools",
      ),
      h.div([h.Class("map-channel")], [
        button(h, model.channel ? "Following the current" : "Follow the current", Message.ToggleChannel(), {
          icon: model.channel ? "pause" : "play",
          class: "text-button",
          disabled: Option.isNone(Option.fromNullishOr(model.atlas?.activeMarketId)),
        }),
        h.small([], ["Let the busiest works lead the camera."]),
      ]),
    ]),
    timeline(model, h),
  ]);
};
