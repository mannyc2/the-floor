import { defineConfig } from "@playwright/test";
import type { PlaywrightTestConfig } from "@playwright/test";
import { Config, Effect, Option } from "effect";
const settings = Effect.runSync(Effect.all({
  baseURL: Config.String("FLOOR_FLOW_URL").pipe(Config.option),
  remote: Config.Boolean("FLOOR_FLOW_REMOTE").pipe(Config.withDefault(false)),
  port: Config.Port("FLOOR_RENDERER_PORT").pipe(Config.withDefault(5180)),
  workerPort: Config.Port("FLOOR_WORKER_PORT").pipe(Config.withDefault(19740)),
}));
const rendererURL = `http://127.0.0.1:${settings.port}`;
const workerURL = `http://127.0.0.1:${settings.workerPort}`;
const swiftShader = { args: ["--use-angle=swiftshader-webgl", "--enable-unsafe-swiftshader"] };
// The first-trade flow owns a local fork and signer; it never targets a hosted stage.
const firstTrade = settings.remote ? [] : [{
  name: "first-trade",
  testMatch: "first-trade.spec.ts",
  timeout: 90000,
  outputDir: "../../work/flows/first-trade/results",
  use: { viewport: { width: 1280, height: 900 }, launchOptions: swiftShader },
}];

export default defineConfig({
  testDir: ".",
  reporter: "list",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // A hosted run spends a bounded request budget once; stop at its first failure.
  maxFailures: settings.remote ? 1 : 0,
  use: { trace: "retain-on-failure", video: "on" },
  projects: [
    {
      // Production entry: the shell/MCP connection and the camera flows share one
      // request-budgeted worker against the local Worker or FLOOR_FLOW_URL.
      name: "shell",
      testMatch: ["shell.spec.ts", "production-renderer.spec.ts"],
      outputDir: "../../work/flows/results",
      use: {
        baseURL: Option.getOrElse(settings.baseURL, () => workerURL),
        viewport: { width: 1280, height: 900 },
        serviceWorkers: "block",
        trace: settings.remote ? "on" : "retain-on-failure",
        launchOptions: swiftShader,
      },
    },
    ...firstTrade,
    {
      name: "renderer",
      testMatch: "renderer/*.spec.ts",
      timeout: 90000,
      outputDir: "../../work/flows/renderer",
      use: { baseURL: rendererURL, viewport: { width: 900, height: 700 }, launchOptions: swiftShader },
    },
  ],
  webServer: [
    ...(settings.remote ? [] : [
      {
        command: "bun scripts/first-trade.ts serve",
        cwd: "../..",
        url: "http://127.0.0.1:19743/",
        reuseExistingServer: false,
        gracefulShutdown: { signal: "SIGTERM", timeout: 30000 },
        timeout: 180000,
        stdout: "pipe",
        stderr: "pipe",
      } satisfies NonNullable<PlaywrightTestConfig["webServer"]>,
      {
        command: "bun --preload ./apps/floor/test/local-only.ts apps/floor/test/serve-local.ts",
        env: { CI: "true", ALCHEMY_TELEMETRY_DISABLED: "1", FLOOR_WORKER_PORT: String(settings.workerPort) },
        cwd: "../..",
        url: `${workerURL}/`,
        reuseExistingServer: false,
        gracefulShutdown: { signal: "SIGTERM", timeout: 10000 },
        timeout: 120000,
        stdout: "pipe",
        stderr: "pipe",
      } satisfies NonNullable<PlaywrightTestConfig["webServer"]>,
    ]),
    {
      command:
        `bunx --no-install vite build --config apps/web/vite.config.ts --mode workbench && bunx --no-install vite preview --config apps/web/vite.config.ts --mode workbench --host 127.0.0.1 --port ${settings.port} --strictPort`,
      cwd: "../..",
      url: `${rendererURL}/workbench/`,
      reuseExistingServer: false,
      gracefulShutdown: { signal: "SIGTERM", timeout: 10000 },
      timeout: 60000,
    },
  ],
});
