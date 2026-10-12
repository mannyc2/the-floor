import { foldkit } from "@foldkit/vite-plugin";
import { defineConfig } from "vite";

export default defineConfig({
  // oxlint-disable-next-line effect/noModulePathFacts -- Vite resolves its package root before the application Effect runtime exists.
  root: import.meta.dirname,
  plugins: foldkit(),
  build: { manifest: true, sourcemap: true, outDir: "dist", emptyOutDir: true },
  server: { host: "127.0.0.1", port: 5180, strictPort: true, proxy: { "/api": "http://127.0.0.1:19740" } },
});
