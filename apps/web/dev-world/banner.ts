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

// The strip wears the shell's paper and ink, set from the Atlas in its entry.
const style = document.createElement("style");
style.textContent = `
  .dev-world-strip {
    position: fixed; top: .9rem; left: 50%; transform: translateX(-50%); z-index: 3; max-width: calc(100vw - 26rem);
    padding: .25rem .7rem; border: .0625rem dashed color-mix(in srgb, var(--floor-ink-day) 45%, transparent);
    background: color-mix(in srgb, var(--floor-paper-day) 94%, transparent); color: var(--floor-ink-day);
    font-family: "Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", "URW Palladio L", P052, serif;
    font-size: .76rem; line-height: 1.4; font-variant-caps: all-small-caps; letter-spacing: .06em; text-align: center;
  }
  .dev-world-strip a { color: inherit; text-decoration-thickness: .0625rem; text-underline-offset: .15em; }
  .dev-world-strip a[aria-current="page"] { font-weight: 700; text-decoration: none; }
  body:has(.floor-shell[data-theme="night"]) .dev-world-strip {
    border-color: color-mix(in srgb, var(--floor-ink-night) 45%, transparent);
    background: color-mix(in srgb, var(--floor-ground-night) 94%, transparent); color: var(--floor-ink-night);
  }
  @media (max-width: 64rem) {
    .dev-world-strip { top: auto; bottom: 3.9rem; max-width: calc(100vw - 2rem); font-size: .66rem; padding: .15rem .5rem; }
    body:has(.has-drawer) .dev-world-strip { display: none; }
  }
`;
document.head.append(style);
const banner = document.createElement("nav");
banner.setAttribute("aria-label", "Development layout");
banner.className = "dev-world-strip";
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
