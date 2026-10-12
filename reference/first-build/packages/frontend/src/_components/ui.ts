import type { MarketView } from "@floor/markets/schema";
import { Array, Option } from "effect";
import type { Html, HtmlBuilder } from "foldkit/html";
import { safeUrl } from "../_lib/format";
import { Message } from "../message";
import type { ViewState } from "../state";
import { icon, type IconName } from "./icons";

export type H = HtmlBuilder<Message>;
export interface ButtonOptions {
  readonly icon?: IconName;
  readonly class?: string;
  readonly disabled?: boolean;
  readonly title?: string;
  readonly key?: string;
}
export const button = (h: H, label: string, message: Message, options: ButtonOptions = {}): Html =>
  h.keyed("button")(options.key ?? label, [
    h.Type("button"),
    h.Class(options.class ?? "button"),
    h.OnClick(message),
    h.Disabled(options.disabled ?? false),
    h.Title(options.title ?? label),
  ], [
    ...Array.map(Option.toArray(Option.fromUndefinedOr(options.icon)), name => icon(h, name)),
    h.span([], [label]),
  ]);
export const iconButton = (h: H, label: string, name: IconName, message: Message): Html =>
  h.button([
    h.Type("button"),
    h.Class("icon-button"),
    h.AriaLabel(label),
    h.Title(label),
    h.OnClick(message),
  ], [icon(h, name)]);
export const tag = (h: H, text: string, className = ""): Html => h.span([h.Class(`tag ${className}`)], [text]);
export const empty = (h: H, heading: string, copy: string, action?: Html): Html =>
  h.div([h.Class("empty-state")], [
    h.div([h.Class("empty-mark")], [icon(h, "research", 30)]),
    h.h3([], [heading]),
    h.p([], [copy]),
    ...Option.toArray(Option.fromUndefinedOr(action)),
  ]);
export const stat = (h: H, label: string, value: string, detail?: string): Html =>
  h.div([h.Class("stat")], [
    h.span([h.Class("eyebrow")], [label]),
    h.strong([h.Class("mono")], [value]),
    ...Array.map(Option.toArray(Option.fromUndefinedOr(detail)), text => h.small([], [text])),
  ]);
export const link = (h: H, label: string, href: string): Html =>
  h.a([
    h.Href(safeUrl(href)),
    h.Target("_blank"),
    h.Rel("noopener noreferrer"),
    h.Class("source-link"),
  ], [label, icon(h, "arrow", 13)]);
export const title = (h: H, kicker: string, name: string, copy?: string): Html =>
  h.div([h.Class("page-title")], [
    h.p([h.Class("eyebrow")], [kicker]),
    h.h1([], [name]),
    ...Array.map(Option.toArray(Option.fromUndefinedOr(copy)), text => h.p([h.Class("muted")], [text])),
  ]);
export const readingRow = (h: H, label: string, value: string): Html =>
  h.keyed("div")(label, [h.Class("reading-row")], [
    h.dt([], [label]),
    h.dd([h.Class("mono")], [value]),
  ]);
export const owned = (model: ViewState) => model.workspace?.agents ?? [];
export const selected = (model: ViewState): Option.Option<MarketView> =>
  Option.fromNullOr(model.atlas).pipe(
    Option.flatMap(atlas => Array.findFirst(atlas.market.markets, market => market.id === model.selectedMarket)),
  );
export const humanKind = (market: MarketView): string => {
  if (market.kind === "constant-product") return "Balance pools";
  if (market.kind === "concentrated-liquidity") return "Depth racks";
  return "Curve works";
};
