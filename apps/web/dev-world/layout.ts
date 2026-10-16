import { squareSpiralLayout, type WorldLayout } from "@floor/world/layout";
import { Option } from "effect";
import { layoutFromQuery, selectedLayout } from "./selection";

// The development build resolves the production viewer's `@floor/world/layout`
// import to this module (apps/web/vite.config.ts), which replaces only
// `canonicalLayout`. Production builds never see it.
export * from "@floor/world/layout";

export const canonicalLayout: WorldLayout = Option.getOrElse(
  selectedLayout(layoutFromQuery(new URL(location.href).searchParams)),
  () => squareSpiralLayout,
);
