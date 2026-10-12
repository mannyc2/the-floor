import { foldkit } from "@foldkit/vite-plugin";
import { Effect, Path } from "effect";
import { defineConfig } from "vite";
import { projectPaths } from "./scripts/build-paths.ts";

const configuration = Effect.gen(function*() {
  const { root, aliases } = yield* projectPaths;
  const path = yield* Path.Path;
  return {
    root: "packages/frontend",
    plugins: foldkit(),
    resolve: { alias: aliases },
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        "/api": "http://127.0.0.1:8787",
        "/mcp": "http://127.0.0.1:8787",
        "/embed.js": "http://127.0.0.1:8787",
        "/markets/": "http://127.0.0.1:8787",
        "/agents/": "http://127.0.0.1:8787",
        "/plates/": "http://127.0.0.1:8787",
        "/stream": { target: "ws://127.0.0.1:8787", ws: true },
      },
    },
    build: {
      outDir: "../../dist/client",
      emptyOutDir: true,
      target: "es2022",
      sourcemap: true,
      manifest: true,
      rolldownOptions: {
        input: {
          atlas: path.resolve(root, "packages/frontend/index.html"),
          gate: path.resolve(root, "packages/frontend/design-review.html"),
          plate: path.resolve(root, "packages/frontend/plate-render.html"),
        },
      },
    },
  };
});

// oxlint-disable-next-line effecttsgo/strict-effect-provide -- Vite invokes this build composition root; its Promise contract owns the Effect runtime.
export default defineConfig(() => Effect.runPromise(configuration.pipe(Effect.provide(Path.layer))));
