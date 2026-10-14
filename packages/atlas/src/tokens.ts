import { Data } from "effect";

export type AtlasStatus = Data.TaggedEnum<{
  Approved: {
    readonly decisionDate: "2026-10-13";
    readonly decisionReference: "docs/decisions.md#the-look";
    readonly sceneBrief: string;
    readonly sourceKey: string;
    readonly scope: string;
  };
  Provisional: { readonly source: string; readonly reason: string };
  Synthetic: { readonly source: string; readonly reason: string };
}>;
const Status = Data.taggedEnum<AtlasStatus>();

export interface AtlasValue<A> {
  readonly value: A;
  readonly status: AtlasStatus;
}
export interface ThemeValues<A> {
  readonly day: AtlasValue<A>;
  readonly night: AtlasValue<A>;
}
export const approved = <A>(value: A, sceneBrief: string, sourceKey: string, scope: string): AtlasValue<A> => ({
  value,
  status: Status.Approved({
    decisionDate: "2026-10-13",
    decisionReference: "docs/decisions.md#the-look",
    sceneBrief,
    sourceKey,
    scope,
  }),
});
export const provisional = <A>(value: A, source: string, reason: string): AtlasValue<A> => ({
  value,
  status: Status.Provisional({ source, reason }),
});
export const synthetic = <A>(value: A, source: string, reason: string): AtlasValue<A> => ({
  value,
  status: Status.Synthetic({ source, reason }),
});
export const materialColor = (day: number, night: number, sourceKey: string): ThemeValues<number> => ({
  day: approved(
    day,
    "testing/look/scenes/materials-day.json",
    sourceKey,
    "Shown day material value only; no new face, geometry or interface approval.",
  ),
  night: approved(
    night,
    "testing/look/scenes/materials-night.json",
    sourceKey,
    "Shown night material value only; no new face, geometry or interface approval.",
  ),
});

// The paper token names the actual flat material. The renderer's old unshaded
// paper slot is a separate synthetic alias and must never inherit this approval.
export const colors = {
  ground: materialColor(0xf1dfc4, 0x0d0f10, "ground"),
  line: materialColor(0x080808, 0xc2cdd7, "line"),
  paper: materialColor(0xebd9bc, 0xafa79b, "paper"),
};
