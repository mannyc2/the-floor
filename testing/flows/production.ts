import { NodeServices } from "@effect/platform-node";
import { expect, test as base } from "@playwright/test";
import type { APIResponse, PlaywrightTestOptions, TestInfo } from "@playwright/test";
import { Effect, FileSystem, Option, Schema } from "effect";

// A hosted run's request budget: browser requests to the stage, and the flows'
// own direct API calls, which come out of the separate non-browser budget.
const browserLimit = 500;
const directLimit = 20;

// Receipts are written into the test's output directory, so they survive the
// list reporter alongside the run's videos and screenshots.
export const retainJson = (info: TestInfo, name: string, value: Schema.Json) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem;
    const path = info.outputPath(`${name}.json`);
    yield* fs.writeFileString(path, yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Json))(value));
  }).pipe(
    // oxlint-disable-next-line effecttsgo/strict-effect-provide -- The Playwright report adapter owns its filesystem service.
    Effect.provide(NodeServices.layer),
    Effect.runPromise,
  );

export type StageRequest = (
  path: string,
  options: {
    readonly method: "GET" | "POST" | "DELETE";
    readonly headers?: Record<string, string>;
    readonly data?: Schema.Json;
  },
) => Promise<APIResponse>;

const stageOrigin = (baseURL: PlaywrightTestOptions["baseURL"]) =>
  Option.match(Option.fromNullishOr(baseURL), { onNone: () => "", onSome: value => new URL(value).origin });

// The one serial worker shares both caps across the shell, desktop and phone
// flows. Requests below a cap reach the real server unmodified. The browser
// guard disables caching, so its receipts count a conservative cold load and
// are not renderer performance evidence.
export const test = base.extend<
  { productionAudit: void; stageRequest: StageRequest },
  { stageBudget: { browser: number; direct: number } }
>({
  // @effect-diagnostics-next-line asyncFunction:off -- Playwright owns the worker-scoped request budget lifetime.
  stageBudget: [async ({ browserName }, use) => {
    expect(browserName).toBe("chromium");
    await use({ browser: 0, direct: 0 });
  }, { scope: "worker" }],
  // @effect-diagnostics-next-line asyncFunction:off -- Playwright owns the request context and report finalization.
  stageRequest: async ({ request, baseURL, stageBudget }, use, info) => {
    const origin = stageOrigin(baseURL);
    expect(origin, "production flows need the stage URL").not.toBe("");
    const receipts: Array<{ method: string; url: string; status: number }> = [];
    // oxlint-disable-next-line effect/noTryCatch -- A native test failure must still retain the direct request receipts.
    try {
      // @effect-diagnostics-next-line asyncFunction:off -- Playwright's request context returns a native Promise.
      await use(async (path, options) => {
        const url = new URL(path, origin);
        expect(url.origin, "direct requests stay on the stage origin").toBe(origin);
        expect(stageBudget.direct, "the direct stage-request budget must not be exhausted").toBeLessThan(directLimit);
        stageBudget.direct++;
        // One hop, no network retry: a redirect is returned for the caller's status assertion.
        const response = await request.fetch<unknown>(url.href, { ...options, maxRedirects: 0, maxRetries: 0 });
        receipts.push({ method: options.method, url: url.href, status: response.status() });
        return response;
      });
    } finally {
      await retainJson(info, "production-direct-requests", {
        origin,
        sent: stageBudget.direct,
        limit: directLimit,
        receipts,
      });
    }
  },
  // @effect-diagnostics-next-line asyncFunction:off -- Playwright owns context interception and report finalization.
  productionAudit: [async ({ context, page, baseURL, stageBudget }, use, info) => {
    const origin = stageOrigin(baseURL);
    expect(origin, "production flows need the stage URL").not.toBe("");
    const requests: Array<{ method: string; url: string; admitted: boolean }> = [];
    const responses: Array<{ url: string; status: number }> = [];
    const messages: Array<string> = [];
    const errors: Array<string> = [];
    const unexpectedOrigins: Array<string> = [];
    const redirects: Array<{ from: string; to: string }> = [];
    const startedAt = stageBudget.browser;
    let refused = 0;
    // @effect-diagnostics-next-line asyncFunction:off -- Playwright awaits each request's allow-or-abort decision before transmission.
    await context.route("**/*", async route => {
      const request = route.request();
      if (new URL(request.url()).origin !== origin) {
        unexpectedOrigins.push(request.url());
        await route.abort("blockedbyclient");
        return;
      }
      const admitted = stageBudget.browser < browserLimit;
      requests.push({ method: request.method(), url: request.url(), admitted });
      if (!admitted) {
        refused++;
        await route.abort("blockedbyclient");
        return;
      }
      stageBudget.browser++;
      // Native browser redirects bypass later route handlers. Fetch only this
      // hop so a redirect cannot escape either the origin or the request cap.
      const response = await route.fetch<unknown>({ maxRedirects: 0, maxRetries: 0 });
      const location = Option.fromNullishOr(response.headers()["location"]);
      if (response.status() >= 300 && response.status() < 400 && Option.isSome(location)) {
        redirects.push({ from: request.url(), to: location.value });
        await route.abort("blockedbyclient");
        return;
      }
      await route.fulfill({ response });
    });
    page.on("response", response => responses.push({ url: response.url(), status: response.status() }));
    page.on("console", message => messages.push(`[${message.type()}] ${message.text()}`));
    page.on("pageerror", error => errors.push(error.message));
    // oxlint-disable-next-line effect/noTryCatch -- A native test failure must still retain the real network receipt and browser log.
    try {
      await use();
    } finally {
      await retainJson(info, "production-network", {
        origin,
        startedAt,
        sent: stageBudget.browser,
        limit: browserLimit,
        refused,
        unexpectedOrigins,
        redirects,
        pageErrors: errors,
        requests,
        responses,
      });
      await retainJson(info, "production-browser-log", messages);
    }
    expect(refused, "the shared production-flow request budget must not be exhausted").toBe(0);
    expect(unexpectedOrigins, "the production flow needs only its own stage origin").toEqual([]);
    expect(redirects, "the stage must serve this flow without redirects").toEqual([]);
    expect(errors).toEqual([]);
  }, { auto: true }],
});

export { expect };
