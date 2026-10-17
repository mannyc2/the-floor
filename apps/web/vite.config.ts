import { NodeServices } from "@effect/platform-node";
import { foldkit } from "@foldkit/vite-plugin";
import { Effect, FileSystem, Schema } from "effect";
import { ChildProcess } from "effect/process";
import { type Connect, defineConfig, type Plugin } from "vite";
import { traderKitFile } from "./src/map/_lib/assets/trader-kit";

const lookRoute: Connect.NextHandleFunction = (request, _response, next) => {
  if (request.url?.startsWith("/look/") === true) {
    request.url = request.url.replace("/look/", "/workbench/look.html");
  }
  next();
};

// The development world builds the production page with one substitution: the
// viewer's `@floor/world/layout` import resolves to a module that picks the
// layout from the URL. Only the production source is redirected, so the
// development modules still reach the real layout seam.
const developmentWorld = (): Plugin => {
  const paths = { source: "", layout: "" };
  return {
    name: "floor-development-world",
    enforce: "pre",
    configResolved(config) {
      paths.source = `${config.root}/src/`;
      paths.layout = `${config.root}/dev-world/layout.ts`;
    },
    resolveId(source, importer) {
      if (source === "@floor/world/layout" && importer?.startsWith(paths.source) === true) return paths.layout;
      // oxlint-disable-next-line effect/noNullish -- Vite's resolveId contract defers every other import to the next resolver with null.
      return null;
    },
    transformIndexHtml: {
      order: "pre",
      handler: () => [{ tag: "script", attrs: { type: "module", src: "/dev-world/banner.ts" }, injectTo: "body" }],
    },
  };
};

class TraderKitBuildError extends Schema.TaggedError<TraderKitBuildError>()("TraderKitBuildError", {
  code: Schema.Int,
}) {}

// The trader kit is baked from its CC0 sources whenever the page is built or
// served: one binary beside the page, never part of a script bundle. The bake
// runs under Bun, which loads the workspace's TypeScript sources it shares
// with the viewer; this config runs under Node.
const traderKit = (): Plugin => {
  const state = { root: "" };
  const bake = Effect.gen(function*() {
    const files = yield* FileSystem.FileSystem;
    const out = `${state.root}/../../work/trader-kit/${traderKitFile}`;
    const child = yield* ChildProcess.make("bun", [`${state.root}/kit/traders/cli.ts`, "--out", out], {
      stdout: "inherit",
      stderr: "inherit",
      forceKillAfter: "5 seconds",
    });
    const code = yield* child.exitCode;
    if (code !== 0) return yield* new TraderKitBuildError({ code });
    return yield* files.readFile(out);
  }).pipe(
    Effect.scoped,
    // oxlint-disable-next-line effecttsgo/strict-effect-provide -- The Vite plugin is the bake's Node composition boundary.
    Effect.provide(NodeServices.layer),
  );
  return {
    name: "floor-trader-kit",
    configResolved(config) {
      state.root = config.root;
    },
    generateBundle() {
      return Effect.runPromise(Effect.map(bake, source => {
        this.emitFile({ type: "asset", fileName: traderKitFile, source });
      }));
    },
    configureServer(server) {
      server.middlewares.use(`/${traderKitFile}`, (_request, response, next) => {
        Effect.runFork(Effect.match(bake, {
          onFailure: next,
          onSuccess: bytes => {
            response.setHeader("Content-Type", "application/octet-stream");
            response.end(bytes);
          },
        }));
      });
    },
  };
};

export default defineConfig(({ mode }) => ({
  // oxlint-disable-next-line effect/noModulePathFacts -- Vite resolves its package root before the application Effect runtime exists.
  root: import.meta.dirname,
  plugins: [foldkit(), ...(mode === "workbench" ? [] : [traderKit()]), {
    name: "floor-look-route",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(lookRoute);
    },
    configurePreviewServer(server) {
      server.middlewares.use(lookRoute);
    },
  }, ...(mode === "dev-world" ? [developmentWorld()] : [])],
  build: {
    manifest: true,
    sourcemap: true,
    outDir: mode === "workbench"
      ? "../../work/web-workbench"
      : mode === "dev-world"
      ? "../../work/dev-world/web"
      : "dist",
    emptyOutDir: true,
    // The diagnostic entry is never an input to the production artifact.
    rolldownOptions: { input: mode === "workbench" ? ["workbench/index.html", "workbench/look.html"] : "index.html" },
  },
  server: { host: "127.0.0.1", port: 5180, strictPort: true, proxy: { "/api": "http://127.0.0.1:19740" } },
}));
