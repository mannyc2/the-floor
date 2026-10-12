import { Config, Context, Crypto, DateTime, Effect, Layer, Option, Redacted, Schema, type Scope } from "effect";
import type { Page, Supervisor } from "effect-browser";
import { PolicyDenied } from "effect-browser/BrowserError";
import { Browserbase, BrowserbaseClient, ContextLease } from "effect-browserbase";

export interface InferenceConfig {
  readonly apiKey: Redacted.Redacted;
  readonly model: string;
  readonly apiUrl: string;
  readonly inputUsdPerMillion: number;
  readonly outputUsdPerMillion: number;
}
export interface BrowserConfig {
  readonly apiKey: Redacted.Redacted;
  readonly projectId: Option.Option<string>;
  readonly blockedDomains: readonly string[];
}
export interface ProviderConfig {
  readonly inference: Option.Option<InferenceConfig>;
  readonly browser: Option.Option<BrowserConfig>;
}
export class Providers extends Context.Service<Providers, ProviderConfig>()("floor/Providers") {}
const positiveRate = Schema.Finite.check(Schema.isGreaterThan(0));
const providerConfiguration = Config.all({
  apiKey: Config.Redacted("OPENAI_API_KEY").pipe(Config.option),
  model: Config.NonEmptyString("INFERENCE_MODEL").pipe(Config.option),
  apiUrl: Config.URL("INFERENCE_API_URL").pipe(Config.withDefault(new URL("https://api.openai.com/v1"))),
  inputUsdPerMillion: Config.schema(positiveRate, "INFERENCE_INPUT_USD_PER_MILLION").pipe(Config.option),
  outputUsdPerMillion: Config.schema(positiveRate, "INFERENCE_OUTPUT_USD_PER_MILLION").pipe(Config.option),
  browserKey: Config.Redacted("BROWSERBASE_API_KEY").pipe(Config.option),
  projectId: Config.NonEmptyString("BROWSERBASE_PROJECT_ID").pipe(Config.option),
  blockedDomains: Config.Array(Schema.NonEmptyString, "BLOCKED_BROWSER_DOMAINS").pipe(Config.withDefault([])),
});
export const providersLayer = Layer.effect(
  Providers,
  providerConfiguration.pipe(Effect.map(config =>
    Providers.of({
      inference: Option.map(
        Option.all({
          apiKey: config.apiKey,
          model: config.model,
          inputUsdPerMillion: config.inputUsdPerMillion,
          outputUsdPerMillion: config.outputUsdPerMillion,
        }),
        inference => ({ ...inference, apiUrl: config.apiUrl.toString() }),
      ),
      browser: Option.map(
        config.browserKey,
        apiKey => ({ apiKey, projectId: config.projectId, blockedDomains: config.blockedDomains }),
      ),
    })
  )),
);
export const providerStatus = (config: ProviderConfig) => ({
  inference: {
    configured: Option.isSome(config.inference),
    provider: "OpenAI-compatible Responses",
    model: Option.getOrNull(Option.map(config.inference, value => value.model)),
    message: Option.isSome(config.inference)
      ? "Configured. Calls are bounded and metered."
      : "Set OPENAI_API_KEY, INFERENCE_MODEL and both INFERENCE_*_USD_PER_MILLION rates to enable metered research.",
  },
  browser: {
    configured: Option.isSome(config.browser),
    provider: "Browserbase",
    message: Option.isSome(config.browser)
      ? "Read-only browser available."
      : "Set BROWSERBASE_API_KEY to enable read-only cloud browsing.",
  },
});
export function permittedResearchUrl(input: string, blockedDomains: readonly string[] = []): boolean {
  const parsed = Schema.decodeOption(Schema.URLFromString)(input);
  return Option.exists(parsed, url => {
    const host = url.hostname.toLowerCase();
    return ["https:", "http:"].includes(url.protocol) && url.username.length === 0 && url.password.length === 0
      && host !== "localhost" && !host.endsWith(".localhost") && !host.endsWith(".local") && !host.endsWith(".internal")
      && !host.includes(":") && !/^\d+\./.test(host) && host.includes(".")
      && !blockedDomains.some(domain => host === domain.toLowerCase() || host.endsWith(`.${domain.toLowerCase()}`));
  });
}
export const UntrustedPage = Schema.Struct({
  sourceId: Schema.String,
  url: Schema.String,
  title: Schema.String,
  text: Schema.String,
  untrusted: Schema.Literal(true),
  injectionWarning: Schema.Boolean,
  capturedAt: Schema.String,
});
export type UntrustedPage = typeof UntrustedPage.Type;
export interface BrowserSessionView {
  readonly sessionId: string;
  readonly liveViewUrl: Option.Option<Redacted.Redacted>;
  readonly status: "running" | "closed" | "release-unconfirmed";
  readonly capturedAt: string;
}
export class ResearchProviderError extends Schema.TaggedError<ResearchProviderError>()("ResearchProviderError", {
  operation: Schema.Literals(["browser", "inference", "observer"]),
  message: Schema.String,
}) {}
interface ResearchBrowserHandle {
  readonly sessionId: string;
  readonly liveViewUrl: Redacted.Redacted;
  readonly read: (url: string) => Effect.Effect<UntrustedPage, ResearchProviderError>;
  readonly release: Effect.Effect<Supervisor.Released>;
}
export class ResearchBrowser extends Context.Service<ResearchBrowser, {
  readonly open: Effect.Effect<Option.Option<ResearchBrowserHandle>, ResearchProviderError, Scope.Scope>;
}>()("floor/ResearchBrowser") {}
const readUntrustedPage = Effect.fn("ResearchBrowser.read")(
  function*(page: Page.Page, url: string, blockedDomains: readonly string[]) {
    if (!permittedResearchUrl(url, blockedDomains)) {
      return yield* new PolicyDenied({ detail: "This address is outside public read-only research." });
    }
    yield* page.goto(url);
    const content = yield* page.text({ maxChars: 12_000, unmask: false });
    if (!permittedResearchUrl(content.url, blockedDomains)) {
      return yield* new PolicyDenied({ detail: "The page redirected outside public research." });
    }
    const crypto = yield* Crypto.Crypto;
    return UntrustedPage.make({
      sourceId: `web:${yield* crypto.randomUUIDv4}`,
      url: content.url,
      title: content.title,
      text: content.text,
      untrusted: true,
      injectionWarning:
        /ignore (previous|all|your)|system (prompt|message)|send.*(funds|private key)|seed phrase|you are (now|an agent)/i
          .test(content.text),
      capturedAt: DateTime.formatIso(yield* DateTime.now),
    });
  },
);
const connectedBrowserLayer = (config: BrowserConfig) =>
  Layer.effect(
    ResearchBrowser,
    Effect.gen(function*() {
      const client = yield* BrowserbaseClient.BrowserbaseClient;
      const lease = yield* ContextLease.ContextLease;
      const crypto = yield* Crypto.Crypto;
      const open = Effect.gen(function*() {
        const hosted = yield* Browserbase.open({
          session: {
            projectId: Option.getOrUndefined(config.projectId),
            timeout: 180,
            keepAlive: false,
            browserSettings: {
              recordSession: true,
              logSession: false,
              solveCaptchas: false,
              viewport: { width: 1280, height: 720 },
            },
          },
          maxPages: 1,
          guard: request =>
            request.action === "navigate"
              && permittedResearchUrl(request.destination ?? request.href ?? request.url, config.blockedDomains)
              ? Effect.void
              : Effect.fail(new PolicyDenied({ detail: "The Floor browser permits only public-web navigation." })),
        });
        const page = yield* hosted.browser.firstPage;
        const live = yield* client.liveView(hosted.session.id, { expiresInSeconds: 180 });
        return Option.some({
          sessionId: hosted.session.id,
          liveViewUrl: live.debuggerFullscreenUrl,
          release: hosted.release,
          read: (url: string) =>
            readUntrustedPage(page, url, config.blockedDomains).pipe(
              Effect.provideService(Crypto.Crypto, crypto),
              Effect.mapError(() =>
                new ResearchProviderError({
                  operation: "browser",
                  message: "The page could not be read under the research policy.",
                })
              ),
            ),
        });
      }).pipe(
        Effect.provideService(BrowserbaseClient.BrowserbaseClient, client),
        Effect.provideService(ContextLease.ContextLease, lease),
        Effect.mapError(() =>
          new ResearchProviderError({ operation: "browser", message: "The cloud research browser is unavailable." })
        ),
      );
      return ResearchBrowser.of({ open });
    }),
  ).pipe(
    Layer.provide([
      BrowserbaseClient.layer({ apiKey: config.apiKey, requestTimeout: "20 seconds" }),
      ContextLease.layer,
    ]),
  );
/** @stability unstable */
export const researchBrowserLayer = Layer.unwrap(Effect.map(Providers, config =>
  Option.match(config.browser, {
    onNone: () => Layer.succeed(ResearchBrowser, ResearchBrowser.of({ open: Effect.succeedNone })),
    onSome: connectedBrowserLayer,
  })));
