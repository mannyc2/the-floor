import { Option } from "effect";
import { type DevelopmentLayout, layoutFromQuery } from "./selection";

// A development-only strip, outside the Foldkit root, that names the layout on
// screen and links to the others. Each link keeps the world, chain and seed and
// drops the camera and delivery sequence, because positions differ by layout.
const here = new URL(location.href);
const selection = layoutFromQuery(here.searchParams);

const link = (label: string, change: (query: URLSearchParams) => void, current: boolean) => {
  const url = new URL(here.href);
  for (const key of ["x", "z", "extent", "rotation", "sequence"]) url.searchParams.delete(key);
  change(url.searchParams);
  const anchor = document.createElement("a");
  anchor.href = url.href;
  anchor.textContent = label;
  anchor.setAttribute("aria-current", current ? "page" : "false");
  return anchor;
};
const describe = (value: DevelopmentLayout) =>
  value._tag === "Grid"
    ? "Production grid"
    : `Proposal, unadopted · seed ${value.seed} · ${
      value.scale === "pitch" ? "4.25H at the grid's post pitch" : "H at the figure height"
    }`;
const is = (predicate: (value: DevelopmentLayout) => boolean) => Option.exists(selection, predicate);

const banner = document.createElement("nav");
banner.setAttribute("aria-label", "Development layout");
banner.style.cssText = [
  "position: fixed",
  "top: .75rem",
  "left: 50%",
  "transform: translateX(-50%)",
  "z-index: 3",
  "padding: .25rem .75rem",
  "font-size: .8rem",
  "background: var(--floor-paper)",
  "color: var(--floor-ink)",
].join("; ");
const status = document.createElement("span");
status.textContent = `Development world, synthetic · ${
  Option.match(selection, {
    onNone: () => "layout parameters not understood; showing the production grid",
    onSome: describe,
  })
} · `;
banner.append(
  status,
  link("Proposal", query => query.set("layout", "proposal"), is(value => value._tag === "Proposal")),
  " · ",
  link("Grid", query => query.set("layout", "grid"), is(value => value._tag === "Grid")),
  " · scale ",
  link("pitch", query => {
    query.set("layout", "proposal");
    query.set("scale", "pitch");
  }, is(value => value._tag === "Proposal" && value.scale === "pitch")),
  " · ",
  link("figure", query => {
    query.set("layout", "proposal");
    query.set("scale", "figure");
  }, is(value => value._tag === "Proposal" && value.scale === "figure")),
);
document.body.append(banner);
