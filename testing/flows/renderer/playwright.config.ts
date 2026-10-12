import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  reporter: "list",
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  outputDir: "../../../work/flows/renderer",
  use: {
    baseURL: "http://127.0.0.1:5180",
    viewport: { width: 900, height: 700 },
    trace: "retain-on-failure",
    video: "on",
    launchOptions: { args: ["--use-angle=swiftshader-webgl", "--enable-unsafe-swiftshader"] },
  },
  webServer: {
    command:
      "bun run build:workbench && bunx --no-install vite preview --config apps/web/vite.config.ts --mode workbench --host 127.0.0.1 --port 5180 --strictPort",
    cwd: "../../..",
    url: "http://127.0.0.1:5180/workbench/",
    reuseExistingServer: false,
    gracefulShutdown: { signal: "SIGTERM", timeout: 10000 },
    timeout: 60000,
  },
});
