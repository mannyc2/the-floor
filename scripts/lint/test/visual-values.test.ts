import { expect, test } from "bun:test";
import { hasStyleViolation, hasVisualLiteral } from "../visual-values";

test("Atlas owns CSS and inline style values, including generated-looking files", () => {
  for (const file of ["apps/web/src/main.css", "apps/web/src/_generated/palette.css"]) {
    expect(hasStyleViolation(file, "/* @generated */ .tile { color: #fff; width: 40px }")).toBe(true);
    expect(hasStyleViolation(file, ".tile { color: var(--atlas-ink); width: var(--atlas-unit) }")).toBe(false);
  }
  expect(hasStyleViolation("packages/atlas/src/tokens.css", ".tile { color:#fff }")).toBe(false);
  expect(hasStyleViolation("apps/web/index.html", "<p style=\"color:#ffff00\">Hello</p>")).toBe(true);
  expect(hasStyleViolation("apps/web/index.html", "<style>.tile{width:20px}</style>")).toBe(true);
  expect(hasStyleViolation("apps/web/index.html", "<p>200px is a measurement in this explanation.</p>")).toBe(false);
  expect(hasVisualLiteral("color: rgb(4 5 6)")).toBe(true);
});
