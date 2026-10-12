import { Emblem } from "@floor/contract";
import { Option, Predicate } from "effect";
import type { Html, HtmlBuilder } from "foldkit/html";
export type IconName =
  | "atlas"
  | "harbour"
  | "research"
  | "foundry"
  | "tide"
  | "search"
  | "sun"
  | "moon"
  | "arrow"
  | "close"
  | "plus"
  | "minus"
  | "pin"
  | "settings"
  | "play"
  | "pause"
  | "expand"
  | "flag"
  | "download"
  | "check"
  | "agent";
const paths: Record<IconName, string> = {
  atlas: "M3 5 9 3l6 2 6-2v16l-6 2-6-2-6 2V5Zm6-2v16m6-14v16",
  harbour: "M12 3v17M8 7h8M4 13v3c0 3 8 5 8 5s8-2 8-5v-3M2 15l2-2 2 2m12 0 2-2 2 2",
  research: "M5 3h14v18H5V3Zm4 5h6m-6 4h6m-6 4h4",
  foundry: "M3 21h18V9l-6 3V7l-6 3V3H5v18m4-5h2m4 0h2",
  tide: "M3 4h18v16H3V4Zm2 10 3-2 3 3 3-7 3 3 2-1M7 1v6m10-6v6",
  search: "M16 16l5 5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z",
  sun: "M12 2v2m0 16v2M2 12h2m16 0h2M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2M17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0Z",
  moon: "M20 15A9 9 0 0 1 9 3a9 9 0 1 0 11 12Z",
  arrow: "M4 12h16m-6-6 6 6-6 6",
  close: "M6 6l12 12M18 6 6 18",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  pin: "m7 3 10 0-1 7 4 4H4l4-4-1-7Zm5 11v8",
  settings: "M4 6h16M4 12h16M4 18h16M8 3v6m8 0v6m-5 0v6",
  play: "m8 4 12 8-12 8V4Z",
  pause: "M8 4v16M16 4v16",
  expand: "M3 9V3h6m6 0h6v6M3 15v6h6m6 0h6v-6",
  flag: "M5 22V3h14l-4 5 4 5H5",
  download: "M12 2v13m-5-5 5 5 5-5M4 17v4h16v-4",
  check: "m4 12 5 5L20 6",
  agent: "M7 5h10v8H7V5Zm5-4v4M5 21v-5l7-3 7 3v5M9 9h.1M15 9h.1",
};
export const icon = <M>(h: HtmlBuilder<M>, name: IconName, size = 18): Html =>
  h.svg([
    h.ViewBox("0 0 24 24"),
    h.Width(String(size)),
    h.Height(String(size)),
    h.Fill("none"),
    h.Stroke("currentColor"),
    h.StrokeWidth("1.25"),
    h.AriaHidden(true),
  ], [h.path([h.D(paths[name])])]);
export const emblem = <M>(h: HtmlBuilder<M>, identity: Emblem | Emblem["shape"], size = 22): Html => {
  const shape = Predicate.isString(identity) ? identity : identity.shape;
  const modifier = Predicate.isString(identity) ? Option.none() : Option.fromNullOr(identity.modifier);
  const shapes = {
    circle: "M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z",
    triangle: "m12 3 10 18H2L12 3Z",
    square: "M4 4h16v16H4Z",
    diamond: "m12 2 10 10-10 10L2 12Z",
    hexagon: "m7 3 10 0 5 9-5 9H7l-5-9 5-9Z",
    cross: "M9 2h6v7h7v6h-7v7H9v-7H2V9h7V2Z",
    crescent: paths.moon,
    star: "m12 2 3 7 7 1-5 5 1 7-6-4-6 4 1-7-5-5 7-1 3-7Z",
  };
  return h.svg([
    h.ViewBox("0 0 24 24"),
    h.Width(String(size)),
    h.Height(String(size)),
    h.Fill("none"),
    h.Stroke("currentColor"),
    h.StrokeWidth("1.3"),
    h.AriaHidden(true),
  ], [
    h.path([h.D(shapes[shape])]),
    Option.match(modifier, {
      onNone: () => h.empty,
      onSome: mark =>
        mark === "bar"
          ? h.path([h.D("M7 12h10")])
          : h.circle([
            h.Cx("12"),
            h.Cy("12"),
            h.R(mark === "dot" ? "1.5" : "3.5"),
            h.Fill(mark === "dot" ? "currentColor" : "none"),
          ]),
    }),
  ]);
};
