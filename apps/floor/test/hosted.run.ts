import { BunRuntime } from "@effect/platform-bun";
import { makeTestWorker, Snapshot, StorageReport, StorageRestart } from "@floor/app-floor/testing";
import { Stack } from "alchemy";
import { CloudflareEnvironment, providers, state } from "alchemy/Cloudflare";
import * as Test from "alchemy/Test/Core";
import { Clock, Config, Crypto, Effect, FileSystem, Option, Redacted, Ref, Schedule, Schema } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import { makeCryptoWorker } from "./fixtures/hosted-crypto";

const stage = "floor-hosted-20261012-001";
const directory = "work/hosted-readiness/run-002";
const options = { providers: providers(), state: state(), profile: "default", dev: false, sidecar: false, stage };
class ProbeInvariant extends Schema.TaggedError<ProbeInvariant>()("ProbeInvariant", { message: Schema.String }) {}
class GateNotReady extends Schema.TaggedError<GateNotReady>()("GateNotReady", { status: Schema.Finite }) {}
const ensure = (condition: boolean, invariant: string) =>
  condition ? Effect.void : Effect.fail(new ProbeInvariant({ message: invariant }));
const encode = Schema.encodeEffect(Schema.fromJsonString(Schema.Json));
const same = Effect.fn("hostedProbe.same")(function*(left: Schema.Json, right: Schema.Json) {
  return (yield* encode(left)) === (yield* encode(right));
});
const main = Effect.gen(function*() {
  yield* ensure(
    yield* Config.Boolean("FLOOR_EXECUTE_HOSTED_PROBE").pipe(Config.withDefault(false)),
    "Hosted execution requires its explicit command flag",
  );
  const accountId = yield* Test.withProviders(
    Effect.gen(function*() {
      return (yield* yield* CloudflareEnvironment).accountId;
    }),
    options,
    "hosted-readiness",
  );
  yield* ensure(
    accountId === "7aa7065a7e971d97435b3f22098d78b0",
    "Only the owner-selected Cloudflare account is permitted",
  );
  const fs = yield* FileSystem.FileSystem;
  yield* ensure(
    !(yield* fs.exists(`${directory}/result.json`)),
    "Choose a new evidence directory before repeating the hosted probe",
  );
  yield* fs.makeDirectory(directory, { recursive: true });
  const token = Redacted.make(yield* (yield* Crypto.Crypto).randomUUIDv4());
  const stack = Stack(
    "FloorHostedPlatform",
    { providers: providers(), state: state() },
    Effect.gen(function*() {
      const env = { FLOOR_PROBE_TOKEN: token };
      return { agent: yield* makeTestWorker({ env }), crypto: yield* makeCryptoWorker(env) };
    }),
  );
  const startedAt = yield* Clock.currentTimeMillis;
  yield* fs.writeFileString(
    `${directory}/intent.json`,
    yield* encode({
      stage,
      startedAt,
      authorizedAccountId: "7aa7065a7e971d97435b3f22098d78b0",
      maximumLifetimeMinutes: 30,
      maximumDriverRequests: 80,
      browser: false,
      paidModelCalls: false,
      resources: [
        "FloorLocalAgent",
        "FloorStorage",
        "FLOOR_THREADS",
        "FLOOR_MAILBOXES",
        "STORAGE",
        "FloorHostedCrypto",
      ],
    }),
  );
  // Install cleanup before deployment so partially created resources are also removed on failure.
  yield* Effect.addFinalizer(() =>
    Test.destroy(options, stack).pipe(
      Effect.timeout("4 minutes"),
      Effect.tap(() =>
        Effect.gen(function*() {
          yield* fs.writeFileString(
            `${directory}/destroy.json`,
            yield* encode({
              destroyedAt: yield* Clock.currentTimeMillis,
              stage,
              result: "Alchemy destroy completed; independent account inventory required",
            }),
          );
        })
      ),
      Effect.orDie,
    )
  );
  const deployed = yield* Test.deploy(options, stack, { scope: yield* Effect.scope });
  const agentUrl = yield* Schema.decodeUnknownEffect(Schema.NonEmptyString)(deployed.agent.url);
  const cryptoUrl = yield* Schema.decodeUnknownEffect(Schema.NonEmptyString)(deployed.crypto.url);
  yield* fs.writeFileString(
    `${directory}/resources.json`,
    yield* encode({
      stage,
      agent: { name: deployed.agent.workerName, url: agentUrl },
      crypto: { name: deployed.crypto.workerName, url: cryptoUrl },
    }),
  );
  const client = yield* HttpClient.HttpClient;
  const requests = yield* Ref.make(0);
  const get = Effect.fn("hostedProbe.request")(function*(url: string, authenticated: boolean = true) {
    const count = yield* Ref.updateAndGet(requests, (value) => value + 1);
    yield* ensure(count <= 80, "Driver request budget remains bounded");
    const request = HttpClientRequest.get(url);
    const response = yield* client.execute(
      authenticated ? HttpClientRequest.setHeader(request, "x-floor-probe-token", Redacted.value(token)) : request,
    ).pipe(Effect.timeout("20 seconds"));
    const errorBody = response.status >= 400
      ? (yield* response.text).slice(0, 4096).replaceAll(Redacted.value(token), "[REDACTED]")
      : "omitted-success-body";
    yield* fs.writeFileString(
      `${directory}/request-${count}.json`,
      yield* encode({
        count,
        url,
        status: response.status,
        contentType: Option.getOrElse(Option.fromNullishOr(response.headers["content-type"]), () => "unknown"),
        errorBody,
      }),
    );
    return response;
  });
  yield* get(`${agentUrl}/ready`, false).pipe(
    Effect.flatMap((response): Effect.Effect<void, GateNotReady | ProbeInvariant> =>
      response.status === 403
        ? Effect.void
        : [404, 503, 520, 521, 522, 523, 524].includes(response.status)
        ? Effect.fail(new GateNotReady({ status: response.status }))
        : ensure(false, `Probe gate returned unexpected HTTP ${response.status}`)
    ),
    Effect.retry({ times: 5, schedule: Schedule.spaced("2 seconds"), while: (error) => error._tag === "GateNotReady" }),
  );
  const unauthorized = yield* get(`${agentUrl}/enqueue?thread=unauthorized`, false);
  yield* ensure(unauthorized.status === 403, "Secret gate refuses an unauthenticated mutation");
  const thread = `hosted-${startedAt}`;
  yield* get(`${agentUrl}/enqueue?thread=${thread}`).pipe(Effect.flatMap(HttpClientResponse.filterStatusOk));
  const quietStartedAt = yield* Clock.currentTimeMillis;
  // The absence of polling is the assertion: native alarms must execute during this measured interval.
  yield* Effect.sleep("6 seconds");
  const observedAt = yield* Clock.currentTimeMillis;
  const snapshot = yield* get(`${agentUrl}/snapshot?thread=${thread}`).pipe(
    Effect.flatMap(HttpClientResponse.filterStatusOk),
    Effect.flatMap(HttpClientResponse.schemaBodyJson(Snapshot)),
  );
  yield* ensure(
    snapshot.callback.completedAt > quietStartedAt && snapshot.callback.completedAt < observedAt,
    "Callback executes without polling",
  );
  const settled = snapshot.records.find((record) => record.kind === "SubmissionSettled");
  yield* ensure(
    settled?.settlement === "completed" && settled.createdAt > quietStartedAt && settled.createdAt < observedAt,
    "Native Yielded alarm settles during the quiet interval",
  );
  yield* ensure(
    yield* same(
      yield* Schema.decodeUnknownEffect(Schema.Json)(
        snapshot.records.find((record) => record.kind === "RunCompleted")?.output,
      ),
      {
        answer: "synthetic-done-v1",
      },
    ),
    "Real runtime returns the injected offline model answer",
  );
  yield* fs.writeFileString(
    `${directory}/admission.json`,
    yield* encode({ thread, quietStartedAt, observedAt, snapshot }),
  );
  const storage = yield* get(`${agentUrl}/storage-run?thread=${thread}`).pipe(
    Effect.flatMap(HttpClientResponse.filterStatusOk),
    Effect.flatMap(HttpClientResponse.schemaBodyJson(StorageReport)),
  );
  for (const [name, result] of Object.entries(storage)) {
    yield* ensure(
      result.rollbackFailed && (yield* same(result.afterRollback, result.beforeRollback)),
      `${name}: failed transaction rolls back`,
    );
    yield* ensure(
      result.casAttempts === 16 && result.casWinners === 1 && result.final.rows.length === 1
        && result.final.rows[0]?.version === 1,
      `${name}: one conditional update wins`,
    );
    yield* ensure(
      result.final.rows[0]?.marker === "migration-2" && result.final.migrations.length === 2
        && (yield* same(result.final.migrations, result.beforeRollback.migrations)),
      `${name}: migrations are applied once`,
    );
  }
  yield* fs.writeFileString(`${directory}/storage.json`, yield* encode(storage));
  const reset = yield* get(`${agentUrl}/storage-reset?thread=${thread}`);
  yield* ensure(reset.status >= 500, "Durable Object abort terminates the triggering request");
  const afterReset = yield* get(`${agentUrl}/storage-snapshot?thread=${thread}`).pipe(
    Effect.flatMap(HttpClientResponse.filterStatusOk),
    Effect.flatMap(HttpClientResponse.schemaBodyJson(StorageRestart)),
  );
  yield* ensure(
    (yield* same(afterReset.durable, storage.durable.final)) && (yield* same(afterReset.d1, storage.d1.final)),
    "Storage survives DO abort and fresh binding requests",
  );
  yield* fs.writeFileString(
    `${directory}/storage-restart.json`,
    yield* encode({ resetStatus: reset.status, afterReset }),
  );
  yield* get(`${agentUrl}/enqueue?thread=${thread}`).pipe(Effect.flatMap(HttpClientResponse.filterStatusOk));
  yield* Effect.sleep("3 seconds");
  const afterDuplicate = yield* get(`${agentUrl}/snapshot?thread=${thread}`).pipe(
    Effect.flatMap(HttpClientResponse.filterStatusOk),
    Effect.flatMap(HttpClientResponse.schemaBodyJson(Snapshot)),
  );
  yield* ensure(
    yield* same(afterDuplicate.records, snapshot.records),
    "Duplicate admission does not create a second run",
  );
  yield* fs.writeFileString(`${directory}/duplicate.json`, yield* encode(afterDuplicate));
  const cryptoResponse = yield* get(cryptoUrl).pipe(Effect.flatMap(HttpClientResponse.filterStatusOk));
  const cryptoResult = yield* HttpClientResponse.schemaBodyJson(
    Schema.Struct({
      sha256: Schema.String,
      emptySha256: Schema.String,
      uuidCount: Schema.Finite,
      uuidDistinct: Schema.Boolean,
      invalidSizeError: Schema.String,
      bunGlobalPresent: Schema.Boolean,
    }),
  )(cryptoResponse);
  yield* ensure(
    cryptoResult.uuidCount === 32 && cryptoResult.uuidDistinct && !cryptoResult.bunGlobalPresent,
    "Web Crypto executes in the hosted Worker",
  );
  yield* fs.writeFileString(`${directory}/crypto.json`, yield* encode(cryptoResult));
  yield* fs.writeFileString(
    `${directory}/result.json`,
    yield* encode({
      result: "pass",
      stage,
      startedAt,
      completedAt: yield* Clock.currentTimeMillis,
      driverRequests: yield* Ref.get(requests),
      agentHostedRestart: "not tested; storage DO was reset and agent duplicate admission was tested",
      browser: "not run",
      paidModelCalls: 0,
    }),
  );
}).pipe(Effect.timeout("20 minutes"));

// oxlint-disable-next-line effecttsgo/any-unknown-in-error-context -- Alchemy's test harness erases its error type; this process boundary contains it as a failure exit.
BunRuntime.runMain(Test.toEffect(main, options).pipe(Effect.orDie));
