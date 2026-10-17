import { Option } from "effect";
import type { HtmlBuilder } from "foldkit/html";
import type { WorldView } from "../_lib/live-world";
import { Message } from "../message";

type Floor = WorldView["floors"][number];
type Desk = WorldView["desks"][number];

// The full name doubles as the compact switcher's accessible name.
export const floorName = (floor: Pick<Floor, "index" | "blueprint" | "desks">) =>
  `Floor ${floor.index + 1} · ${
    floor.blueprint ? "blueprint" : `${floor.desks} ${floor.desks === 1 ? "desk" : "desks"}`
  }`;

const deskList = (
  { desks, query, selected }: {
    readonly desks: ReadonlyArray<Desk>;
    readonly query: string;
    readonly selected: Option.Option<number>;
  },
  h: HtmlBuilder<Message>,
) => {
  const needle = query.trim().toLowerCase();
  const listed = needle.length === 0
    ? desks
    : desks.filter(desk => desk.agent.toLowerCase().includes(needle) || desk.desk.toLowerCase().includes(needle));
  return h.section([h.Id("desk-list"), h.Class("desk-panel"), h.AriaLabel("Desks on this floor")], [
    h.input([
      h.Type("search"),
      h.Class("desk-search"),
      h.AriaLabel("Search desks"),
      h.Placeholder("Search agent or desk"),
      h.Value(query),
      h.Autocomplete("off"),
      h.Spellcheck(false),
      h.OnInput(text => Message.ChangedDeskQuery({ query: text })),
    ]),
    h.p([h.Class("desk-count")], [`${listed.length} of ${desks.length} ${desks.length === 1 ? "desk" : "desks"}`]),
    h.div(
      [h.Class("desk-list")],
      listed.map(desk => {
        const state = Option.getOrElse(desk.state, () => "unreported");
        return h.button([
          h.Class("desk-row"),
          h.AriaLabel(`Open desk for ${desk.agent}`),
          h.DataAttribute("agent-state", state),
          h.AriaCurrent(Option.exists(selected, id => id === desk.id) ? "true" : "false"),
          h.OnClick(Message.SelectedEntity({ entity: Option.some(desk.id) })),
        ], [
          h.span([h.Class("desk-agent")], [desk.agent]),
          state === "unreported" ? h.empty : h.span([h.Class("desk-state")], [state]),
        ]);
      }),
    ),
  ]);
};

// The compact floor switcher and the desk list, which stays folded until
// asked for so it never covers the floor. It lists the floor in view.
export const worldPanel = (
  { floors, inView, desks, open, query, selected, ready }: {
    readonly floors: ReadonlyArray<Floor>;
    readonly inView: Option.Option<Floor>;
    readonly desks: ReadonlyArray<Desk>;
    readonly open: boolean;
    readonly query: string;
    readonly selected: Option.Option<number>;
    readonly ready: boolean;
  },
  h: HtmlBuilder<Message>,
) =>
  h.div([h.Class("world-panel")], [
    h.nav(
      [h.AriaLabel("Floors"), h.Class("world-floors")],
      floors.map(floor =>
        h.button([
          h.Class(floor.blueprint ? "floor-button blueprint" : "floor-button"),
          h.AriaLabel(floorName(floor)),
          h.Title(floorName(floor)),
          h.AriaCurrent(Option.exists(inView, current => current.index === floor.index) ? "location" : "false"),
          h.OnClick(Message.ClickedFloor({ floor: floor.index })),
          h.Disabled(!ready),
        ], [String(floor.index + 1)])
      ),
    ),
    h.p([h.Class("floor-caption")], [Option.match(inView, { onNone: () => "Between floors", onSome: floorName })]),
    h.button([
      h.Class("chrome-button chrome-text desks-toggle"),
      h.AriaExpanded(open),
      h.AriaControls("desk-list"),
      h.OnClick(Message.ToggledDesks()),
    ], ["Desks", h.span([h.Class("toggle-mark"), h.AriaHidden(true)], ["▾"])]),
    open
      ? deskList({
        desks: desks.filter(desk => Option.exists(inView, floor => floor.index === desk.floor)),
        query,
        selected,
      }, h)
      : h.empty,
  ]);
