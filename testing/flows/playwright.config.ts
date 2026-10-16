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

export default defineConfig({
  testDir: ".",
  reporter: "list",
  fullyParallel: false,
  workers: 1,
  use: { trace: "retain-on-failure", video: "on" },
  projects: [{
    name: "shell",
    testMatch: "shell.spec.ts",
    outputDir: "../../work/flows/results",
    use: { baseURL: Option.getOrElse(settings.baseURL, () => workerURL), viewport: { width: 1280, height: 900 } },
  }, {
    name: "first-trade",
    testMatch: "first-trade.spec.ts",
    timeout: 90000,
    outputDir: "../../work/flows/first-trade/results",
    use: {
      viewport: { width: 1280, height: 900 },
      launchOptions: { args: ["--use-angle=swiftshader-webgl", "--enable-unsafe-swiftshader"] },
    },
  }, {
    name: "renderer",
    testMatch: "renderer/*.spec.ts",
    timeout: 90000,
    outputDir: "../../work/flows/renderer",
    use: {
      baseURL: rendererURL,
      viewport: { width: 900, height: 700 },
      launchOptions: { args: ["--use-angle=swiftshader-webgl", "--enable-unsafe-swiftshader"] },
    },
  }],
  webServer: [
    {
      command: "bun scripts/first-trade.ts serve",
      cwd: "../..",
      url: "http://127.0.0.1:19743/",
      reuseExistingServer: false,
      gracefulShutdown: { signal: "SIGTERM", timeout: 30000 },
      timeout: 180000,
      stdout: "pipe",
      stderr: "pipe",
    },
    ...(settings.remote ? [] : [
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
