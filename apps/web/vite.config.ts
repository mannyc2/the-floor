import { foldkit } from "@foldkit/vite-plugin";
import { type Connect, defineConfig, type Plugin } from "vite";

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

export default defineConfig(({ mode }) => ({
  // oxlint-disable-next-line effect/noModulePathFacts -- Vite resolves its package root before the application Effect runtime exists.
  root: import.meta.dirname,
  plugins: [foldkit(), {
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
