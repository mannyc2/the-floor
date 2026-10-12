import { BunRuntime, BunServices } from "@effect/platform-bun";
import { chromium } from "@playwright/test";
import { DateTime, Effect, FileSystem, Layer, Option, Path, Schedule, Schema } from "effect";
import { Command, Flag } from "effect/cli";
import { FetchHttpClient, HttpClient } from "effect/http";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { BenchError, BenchReport, BenchResult, failuresFor, regressionsFor, reportTable, thresholds } from "./result";
import { scenarioNames, scenarios } from "./scenarios";

const browserOperation = <A>(operation: string, run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: cause => new BenchError({ message: `${operation} failed`, cause }),
  });

const command = Command.make(
  "bench",
  {
    scenario: Flag.Literals("scenario", [...scenarioNames, "all"]).pipe(Flag.withDefault("all")),
    headed: Flag.Boolean("headed").pipe(Flag.withDefault(false)),
    baseline: Flag.String("baseline").pipe(Flag.optional),
    output: Flag.String("output").pipe(Flag.withDefault("testing/bench/reports")),
  },
  Effect.fn("Bench.run")(function*({ scenario: requested, headed, baseline, output }) {
    const selected = requested === "all" ? scenarios : scenarios.filter(scenario => scenario.name === requested);
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);
    const prior = yield* Option.match(baseline, {
      onNone: () => Effect.succeed(Option.none<BenchReport>()),
      onSome: filename =>
        fs.readFileString(filename).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(BenchReport))),
          Effect.asSome,
        ),
    });
    yield* fs.makeDirectory(output, { recursive: true });
    const build = yield* spawner.spawn(
      ChildProcess.make("bun", ["x", "vite", "build", "--config", "testing/bench/vite.config.ts"], {
        stdout: "inherit",
        stderr: "inherit",
        forceKillAfter: "5 seconds",
      }),
    );
    const buildExit = yield* build.exitCode;
    if (buildExit !== 0) return yield* new BenchError({ message: "The isolated benchmark bundle did not build" });
    yield* spawner.spawn(
      ChildProcess.make("bun", ["x", "vite", "preview", "--config", "testing/bench/vite.config.ts"], {
        stdout: "inherit",
        stderr: "inherit",
        forceKillAfter: "5 seconds",
      }),
    );
    yield* client.get("http://127.0.0.1:5174").pipe(
      Effect.retry({ times: 100, schedule: Schedule.spaced("100 millis") }),
    );
    const browser = yield* Effect.acquireRelease(
      browserOperation("Open Chromium", () => chromium.launch({ channel: "chrome", headless: !headed })),
      value => browserOperation("Close Chromium", () => value.close()).pipe(Effect.orDie),
    );
    const reports = yield* Effect.forEach(
      selected,
      Effect.fn("Bench.scenario")(function*(scenario) {
        const context = yield* Effect.acquireRelease(
          browserOperation("Create the recorded browser context", () =>
            browser.newContext({
              viewport: { width: 1440, height: 900 },
              deviceScaleFactor: 1,
              recordVideo: { dir: path.join(output, "videos"), size: { width: 1440, height: 900 } },
            })),
          value => browserOperation("Close the recorded context", () => value.close()).pipe(Effect.orDie),
        );
        yield* browserOperation(
          "Start the browser trace",
          () => context.tracing.start({ screenshots: true, snapshots: true, sources: true }),
        );
        yield* Effect.addFinalizer(() =>
          browserOperation(
            "Save the browser trace",
            () => context.tracing.stop({ path: path.join(output, `${scenario.name}.trace.zip`) }),
          ).pipe(Effect.orDie)
        );
        const page = yield* browserOperation("Open the bench page", () => context.newPage());
        const errors: string[] = [];
        page.on("pageerror", error => errors.push(error.message));
        page.on("console", message => {
          if (message.type() === "error") errors.push(message.text());
        });
        yield* Effect.logInfo(
          `Running ${scenario.name} for 60 seconds: ${scenario.markets.toLocaleString()} synthetic markets; ${scenario.readingsPerSecond.toLocaleString()} readings/second`,
        );
        yield* browserOperation(
          "Load the scenario",
          () =>
            page.goto(`http://127.0.0.1:5174/?scenario=${scenario.name}`, {
              waitUntil: "networkidle",
              timeout: 180_000,
            }),
        );
        yield* browserOperation(
          "Wait for the renderer",
          () => page.waitForFunction(() => window.floorBench?.ready === true, {}, { timeout: 180_000 }),
        );
        const report = yield* browserOperation(
          "Sample sixty seconds of frames",
          () => page.evaluate(() => window.floorBench?.run()),
        ).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(BenchResult)),
          Effect.timeoutOrElse({
            duration: "120 seconds",
            orElse: () =>
              Effect.fail(new BenchError({ message: `${scenario.name} did not finish its sixty-second sample` })),
          }),
        );
        const baselineReport = Option.flatMap(
          prior,
          value => Option.fromUndefinedOr(value.reports.find(item => item.scenario === report.scenario)),
        );
        const browserReport = { ...report, webglErrors: [...report.webglErrors, ...errors] };
        const failures = [
          ...failuresFor(browserReport),
          ...Option.match(baselineReport, { onNone: () => [], onSome: value => regressionsFor(browserReport, value) }),
        ];
        const complete: BenchResult = {
          ...browserReport,
          target: { ...report.target, passesInThisBrowser: failures.length === 0, failures },
        };
        const json = yield* Schema.encodeEffect(Schema.fromJsonString(BenchResult))(complete);
        yield* fs.writeFileString(path.join(output, `${scenario.name}.json`), `${json}\n`);
        yield* browserOperation(
          "Save the rendered plate",
          () => page.screenshot({ path: path.join(output, `${scenario.name}.png`) }),
        );
        yield* Effect.logInfo(
          `${scenario.name}: p95 ${report.frameCadence.p95Ms}ms; p99 ${report.frameCadence.p99Ms}ms; ${report.workload.appliedBatches}/${report.workload.expectedBatches} batches; ${
            failures.length === 0 ? "pass" : failures.join("; ")
          }`,
        );
        return complete;
      }, Effect.scoped),
      { concurrency: 1 },
    );
    const now = yield* DateTime.now;
    const report: BenchReport = {
      version: 3,
      createdAt: DateTime.formatIso(now),
      thresholds,
      methodology:
        "Sixty-second synthetic workloads shaped by a captured Base day, contract schemas and the production district coalescer, through the real Three.js renderer. Cadence and actual rendered frames are separate. Reading latency ends at the next browser presentation opportunity after submission, not measured physical display pixels. GPU byte sizes, real phone results, a verified liquidation cascade, and end-to-end network transport are not established by this isolated renderer bench. Video and tracing are enabled consistently for each run and add overhead.",
      reports,
    };
    const json = yield* Schema.encodeEffect(Schema.fromJsonString(BenchReport))(report);
    yield* fs.writeFileString(path.join(output, "latest.json"), `${json}\n`);
    yield* fs.writeFileString(path.join(output, "summary.md"), `${reportTable(report)}\n\n${report.methodology}\n`);
    yield* Effect.logInfo(`Reports saved to ${path.resolve(output, "latest.json")}`);
    const failures = reports.filter(result => !result.target.passesInThisBrowser);
    if (failures.length > 0) {
      return yield* new BenchError({
        message: `Performance targets failed for ${
          failures.map(result => result.scenario).join(", ")
        }; evidence has been saved.`,
      });
    }
    return void 0;
  }),
);

command.pipe(
  Command.run({ version: "3.0.0" }),
  Effect.scoped,
  // oxlint-disable-next-line effecttsgo/strict-effect-provide -- This CLI composes its platform and HTTP capabilities once at the host boundary.
  Effect.provide(Layer.mergeAll(FetchHttpClient.layer, BunServices.layer)),
  BunRuntime.runMain,
);
