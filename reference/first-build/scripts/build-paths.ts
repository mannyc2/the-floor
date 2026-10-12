import { Array, Effect, Path, Record } from "effect";

const packageNames = [
  "contract",
  "settings",
  "markets",
  "districts",
  "agents",
  "signing",
  "research",
  "foundry",
  "gate",
  "kit",
  "renderer",
  "surfaces",
];
export const projectPaths = Effect.gen(function*() {
  const path = yield* Path.Path;
  const root = yield* path.fromFileUrl(new URL("../", import.meta.url));
  return {
    root,
    aliases: {
      "@": path.resolve(root, "packages/frontend/src"),
      "@floor/markets/schema": path.resolve(root, "packages/markets/src/types.ts"),
      "@floor/renderer/market-view": path.resolve(root, "packages/renderer/src/market-view.ts"),
      "@floor/renderer/layout": path.resolve(root, "packages/renderer/src/layout.ts"),
      "@floor/renderer/evidence": path.resolve(root, "packages/renderer/src/evidence.ts"),
      "@floor/renderer/plate": path.resolve(root, "packages/renderer/src/plate.ts"),
      "@floor/gate/geometry": path.resolve(root, "packages/gate/src/geometry.ts"),
      ...Record.fromEntries(
        Array.map(
          packageNames,
          name => [`@floor/${name}`, path.resolve(root, `packages/${name}/src/index.ts`)] as const,
        ),
      ),
    },
  };
});
