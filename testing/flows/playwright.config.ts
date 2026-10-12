import { defineConfig } from "@playwright/test";
import { Config, Effect } from "effect";

// oxlint-disable-next-line effecttsgo/no-run-sync -- Playwright loads synchronous configuration before its native test runtime starts.
const settings = Effect.runSync(Effect.all({
  baseURL: Config.String("FLOOR_FLOW_URL").pipe(Config.withDefault("http://127.0.0.1:19740")),
  remote: Config.Boolean("FLOOR_FLOW_REMOTE").pipe(Config.withDefault(false)),
}));

export default defineConfig({
  testDir: ".",
  testMatch: "shell.spec.ts",
  reporter: "list",
  fullyParallel: false,
  workers: 1,
  use: { baseURL: settings.baseURL, viewport: { width: 1280, height: 900 }, trace: "retain-on-failure", video: "on" },
  outputDir: "../../work/flows/results",
  webServer: settings.remote ? [] : [{
    command: "bun --preload ./apps/floor/test/local-only.ts apps/floor/test/serve-local.ts",
    env: { CI: "true", ALCHEMY_TELEMETRY_DISABLED: "1" },
    cwd: "../..",
    url: "http://127.0.0.1:19740/api/health",
    reuseExistingServer: false,
    gracefulShutdown: { signal: "SIGTERM", timeout: 10000 },
    timeout: 120000,
    stdout: "pipe",
    stderr: "pipe",
  }],
});
