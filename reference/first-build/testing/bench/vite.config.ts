import { Effect, Path } from "effect";
import { defineConfig } from "vite";
import { projectPaths } from "../../scripts/build-paths.ts";

const configuration = Effect.gen(function*() {
  const path = yield* Path.Path;
  const { root, aliases } = yield* projectPaths;
  const resolve = (value: string) => path.resolve(root, value);
  return {
    root: resolve("testing/bench"),
    resolve: {
      alias: aliases,
    },
    server: { port: 5174, strictPort: true, host: "127.0.0.1", fs: { allow: [root] } },
    build: { outDir: resolve(".data/bench-site"), emptyOutDir: true },
    preview: { port: 5174, strictPort: true, host: "127.0.0.1" },
    logLevel: "error" as const,
  };
});

// oxlint-disable-next-line effecttsgo/strict-effect-provide -- Vite configuration is the build composition root; its promise contract is the runtime boundary.
export default defineConfig(() => Effect.runPromise(configuration.pipe(Effect.provide(Path.layer))));
