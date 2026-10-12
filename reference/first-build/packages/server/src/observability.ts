import { Config, Effect, Layer, Logger } from "effect";
import { DevTools } from "effect/devtools";
import { FetchHttpClient } from "effect/http";
import { Otlp, OtlpSerialization } from "effect/observability";

/** Native OTEL_* configuration owns exporter selection, batching and flush-on-shutdown. */
const Exporters = Otlp.layerFromConfig({
  resource: { serviceName: "the-floor-server", serviceVersion: "0.1.0" },
  loggerMergeWithExisting: true,
}).pipe(Layer.provide(OtlpSerialization.layerJson), Layer.provide(FetchHttpClient.layer));

export const ObservabilityLive = Layer.unwrap(Effect.gen(function*() {
  const production = (yield* Config.String("NODE_ENV").pipe(Config.withDefault("development"))) === "production";
  const enabled = yield* Config.Boolean("FLOOR_DEVTOOLS").pipe(Config.withDefault(false));
  const url = yield* Config.String("FLOOR_DEVTOOLS_URL").pipe(Config.withDefault("ws://localhost:34437"));
  const logs = Logger.layer([production ? Logger.consoleJson : Logger.consolePretty()]);
  // DevTools delegates to its existing tracer, so the exporter must be constructed first.
  const tracing = enabled ? DevTools.layer(url).pipe(Layer.provide(Exporters)) : Exporters;
  return tracing.pipe(Layer.provide(logs));
}));
