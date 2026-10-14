import { approved, materialColor, synthetic } from "./tokens";

const source = "docs/decisions.md#the-look";
export const lineWidthCssPx = synthetic(
  1,
  source,
  "Recorded technique-B line weight; material picks do not add renderer acceptance.",
);
export const darkLine = {
  day: synthetic(
    0x080808,
    "docs/atlas.md#approved-night-materials--13-october-2026",
    "Dormant day dark-class entry; night approval cannot approve an unseen day class.",
  ),
  night: approved(
    0x080808,
    "testing/look/scenes/materials-night.json",
    "darkLine",
    "Shown surface-dark and complete instrument-contour strokes only; engraving remains provisional.",
  ),
};
export const lineOpacity = materialColor(1, 1, "lineOpacity");
export const lineClasses = {
  ordinary: synthetic(0, source, "Renderer encoding for ordinary surface outlines."),
  surfaceDark: synthetic(1, source, "Renderer encoding: dark strokes stay on the bright owning face."),
  instrumentContour: synthetic(
    2,
    source,
    "Renderer encoding: dark contour includes the verified adjoining mount edge.",
  ),
};
export const shading = {
  unshadedSlots: synthetic(4, source, "Existing palette layout; changing it readdresses every material."),
  tonesPerMaterial: synthetic(4, source, "Existing downward, dark-side, light-side and top slot order."),
  verticalThreshold: synthetic(.5, source, "Recorded provisional direction bands, without a new art approval."),
  sideTolerance: synthetic(-.0001, source, "Absorbs inverse-view roundoff at diagonal side boundaries."),
};
