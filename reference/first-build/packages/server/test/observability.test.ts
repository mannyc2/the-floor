import { BunHttpServer } from "@effect/platform-bun";
import { assert, it } from "@effect/vitest";
import { ConfigProvider, Effect, Layer, Option, Ref, Schema } from "effect";
import { HttpServer, HttpServerRequest, HttpServerResponse } from "effect/http";
import { ObservabilityLive } from "../src/observability";

const Attribute = Schema.Struct({ key: Schema.String, value: Schema.Struct({ stringValue: Schema.String }) });
const TracePayload = Schema.Struct({
  resourceSpans: Schema.Array(Schema.Struct({
    resource: Schema.Struct({ attributes: Schema.Array(Attribute) }),
    scopeSpans: Schema.Array(Schema.Struct({
      spans: Schema.Array(Schema.Struct({
        name: Schema.String,
        traceId: Schema.String,
        spanId: Schema.String,
        startTimeUnixNano: Schema.String,
        endTimeUnixNano: Schema.String,
      })),
    })),
  })),
});

it.effect("native OTLP configuration exports the service span when its layer shuts down", () =>
  Effect.gen(function*() {
    const received = yield* Ref.make<ReadonlyArray<typeof TracePayload.Type>>([]);
    const collector = yield* BunHttpServer.make({ hostname: "127.0.0.1", port: 0 });
    yield* collector.serve(Effect.gen(function*() {
      const request = yield* HttpServerRequest.HttpServerRequest;
      assert.strictEqual(request.url, "/v1/traces");
      const payload = yield* HttpServerRequest.schemaBodyJson(TracePayload);
      yield* Ref.update(received, previous => [...previous, payload]);
      return HttpServerResponse.empty();
    }));
    const configured = ObservabilityLive.pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({
      NODE_ENV: "production",
      FLOOR_DEVTOOLS: false,
      OTEL_TRACES_EXPORTER: "otlp",
      OTEL_METRICS_EXPORTER: "none",
      OTEL_LOGS_EXPORTER: "none",
      OTEL_EXPORTER_OTLP_ENDPOINT: HttpServer.formatAddress(collector.address),
      // No scheduled export can run during this test: disposal must flush the buffered span.
      OTEL_BSP_SCHEDULE_DELAY: 60_000,
    }))));
    yield* Effect.void.pipe(
      Effect.withSpan("floor.observability.proof"),
      // oxlint-disable-next-line effecttsgo/strict-effect-provide, effect/noInlineProvide -- This nested test boundary closes the real exporter while the local collector remains alive.
      Effect.provide(configured),
    );
    const payloads = yield* Ref.get(received);
    const resources = payloads.flatMap(payload => payload.resourceSpans);
    const proof = yield* Effect.fromOption(Option.fromUndefinedOr(
      resources.flatMap(resource => resource.scopeSpans.flatMap(scope => scope.spans))
        .find(span => span.name === "floor.observability.proof"),
    ));
    assert.match(proof.traceId, /^[a-f0-9]{32}$/);
    assert.match(proof.spanId, /^[a-f0-9]{16}$/);
    assert.isTrue(resources.some(resource =>
      resource.resource.attributes.some(attribute =>
        attribute.key === "service.name" && attribute.value.stringValue === "the-floor-server"
      )
    ));
  }));
