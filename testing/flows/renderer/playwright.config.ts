import { defineConfig } from "@playwright/test";
import { Config, Effect } from "effect";

// Isolated worktrees need separate ports while the look checkout is running.
// oxlint-disable-next-line effecttsgo/no-run-sync -- Playwright loads its port before starting the native test runtime.
const port = Effect.runSync(Config.Port("FLOOR_RENDERER_PORT").pipe(Config.withDefault(5180)));
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  reporter: "list",
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  outputDir: "../../../work/flows/renderer",
  use: {
    baseURL,
    viewport: { width: 900, height: 700 },
    trace: "retain-on-failure",
    video: "on",
    launchOptions: { args: ["--use-angle=swiftshader-webgl", "--enable-unsafe-swiftshader"] },
  },
  webServer: {
    command:
      `bun run build:workbench && bunx --no-install vite preview --config apps/web/vite.config.ts --mode workbench --host 127.0.0.1 --port ${port} --strictPort`,
    cwd: "../../..",
    url: `${baseURL}/workbench/`,
    reuseExistingServer: false,
    gracefulShutdown: { signal: "SIGTERM", timeout: 10000 },
    timeout: 60000,
  },
});
