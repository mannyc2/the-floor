import { figureHeight } from "@floor/atlas/proportions";
import { canonicalPostAnchor } from "@floor/contract/world";
import { squareSpiralLayout, type WorldLayout } from "@floor/world/layout";
import { proposalDimensions, proposalLayout, ProposalSeed } from "@floor/world/proposal";
import { Option, Schema } from "effect";

// The development world's layout comes from its URL, so the owner switches
// between layouts, seeds and scales by reloading, without restarting the world.
// "pitch" draws the proposal's 4.25H minimum post distance at the grid's post
// pitch, so both layouts share one density; "figure" draws one H at the Atlas
// figure height, the proposal's own conversion.
const Scale = Schema.Literals(["pitch", "figure"]);
const Grid = Schema.TaggedStruct("Grid", {});
const Proposal = Schema.TaggedStruct("Proposal", { seed: ProposalSeed, scale: Scale });
export const DevelopmentLayout = Schema.Union([Grid, Proposal]);
export type DevelopmentLayout = typeof DevelopmentLayout.Type;
const ProposalQuery = Schema.Struct({ seed: Schema.FiniteFromString.pipe(Schema.decodeTo(ProposalSeed)), scale: Scale });

export const layoutFromQuery = (query: URLSearchParams): Option.Option<DevelopmentLayout> =>
  query.get("layout") === "grid"
    ? Option.some(Grid.make({}))
    : Option.map(
      Schema.decodeUnknownOption(ProposalQuery)({ seed: query.get("seed"), scale: query.get("scale") ?? "pitch" }),
      value => Proposal.make(value),
    );

const gridPitch = Option.map(canonicalPostAnchor(1), anchor => Math.hypot(anchor.x, anchor.z));
export const unitsPerH = (scale: "pitch" | "figure") =>
  scale === "figure"
    ? Option.some(figureHeight)
    : Option.map(gridPitch, pitch => pitch * proposalDimensions.unit / proposalDimensions.postDistance);

// None when the URL names no drawable layout; the banner says the grid is shown.
export const selectedLayout = (selection: Option.Option<DevelopmentLayout>): Option.Option<WorldLayout> =>
  Option.flatMap(selection, value =>
    value._tag === "Grid"
      ? Option.some(squareSpiralLayout)
      : Option.map(unitsPerH(value.scale), units => proposalLayout({ seed: value.seed, unitsPerH: units })));
