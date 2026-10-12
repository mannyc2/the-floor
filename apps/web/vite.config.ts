import { foldkit } from "@foldkit/vite-plugin";
import { type Connect, defineConfig } from "vite";

const lookRoute: Connect.NextHandleFunction = (request, _response, next) => {
  if (request.url?.startsWith("/look/") === true) {
    request.url = request.url.replace("/look/", "/workbench/look.html");
  }
  next();
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
  }],
  build: {
    manifest: true,
    sourcemap: true,
    outDir: mode === "workbench" ? "../../work/web-workbench" : "dist",
    emptyOutDir: true,
    // The diagnostic entry is never an input to the production artifact.
    rolldownOptions: { input: mode === "workbench" ? ["workbench/index.html", "workbench/look.html"] : "index.html" },
  },
  server: { host: "127.0.0.1", port: 5180, strictPort: true, proxy: { "/api": "http://127.0.0.1:19740" } },
}));
