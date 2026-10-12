import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./testing/e2e",
  timeout: 90000,
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    channel: "chrome",
    baseURL: "http://127.0.0.1:8791",
    actionTimeout: 15000,
    navigationTimeout: 30000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    viewport: { width: 1440, height: 1000 },
  },
  webServer: {
    command: "bun run packages/server/src/local.ts",
    env: { PORT: "8791", FLOOR_ORIGIN: "http://127.0.0.1:8791", FLOOR_DATABASE: ":memory:" },
    url: "http://127.0.0.1:8791/api/health",
    reuseExistingServer: false,
    timeout: 90000,
  },
});
