import { BunRuntime, BunServices } from "@effect/platform-bun";
import { chromium } from "@playwright/test";
import type { Browser } from "@playwright/test";
import { Crypto, Effect, FileSystem, Option, Schema } from "effect";
import { Command, Flag } from "effect/cli";
import { Hex } from "effect/encoding";
import { CaptureConfiguration, fixedSeed, fixedTimeEpochMs, Sha256 } from "../../../testing/look/protocol";
import { browserCall, WorkbenchFailure } from "./runtime";

const Point = Schema.Struct({ x: Schema.Finite, y: Schema.Finite });
const Segment = Schema.Struct({ a: Point, b: Point });
const PrimitiveCase = Schema.Struct({
  name: Schema.NonEmptyString,
  pass: Schema.Boolean,
  boundary: Schema.Array(Point),
  samples: Schema.Int.check(Schema.isGreaterThan(0)),
  maxSilhouetteDistanceCssPx: Schema.Finite,
  maxProjectionOutsideHullCssPx: Schema.Finite,
  engineeringToleranceCssPx: Schema.Literal(0.0001),
  projectedVertices: Schema.Array(Point),
  targetSegments: Schema.Array(Segment),
});
const Projection = Schema.Struct({
  sourceSceneSha256: Sha256,
  generator: Schema.Literal("three-edge-projection"),
  generatorVersion: Schema.NonEmptyString,
  width: Schema.Literal(480),
  height: Schema.Literal(360),
  segments: Schema.NonEmptyArray(Segment),
  cylinderRegion: Schema.NonEmptyArray(Point),
  silhouetteSampleCss: Point,
  regionSpecification: Schema.NonEmptyString,
  camera: Schema.Struct({ projection: Schema.Array(Schema.Finite), world: Schema.Array(Schema.Finite) }),
  primitiveCases: Schema.NonEmptyArray(PrimitiveCase),
});
const Approval = Schema.TaggedStruct("SyntheticUnapproved", {});
const writeJson = Effect.fn("LookTargets.writeJson")(function*(path: string, value: Schema.Json) {
  const fs = yield* FileSystem.FileSystem;
  const encoded = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Json))(value);
  const bytes = new TextEncoder().encode(encoded + "\n");
  yield* fs.writeFile(path, bytes);
  const crypto = yield* Crypto.Crypto;
  return Hex.encode(yield* crypto.digest("SHA-256", bytes));
});
const pageResource = (browser: Browser, dpr: number) =>
  Effect.acquireRelease(
    browserCall("browser.newPage", () =>
      browser.newPage({ viewport: { width: 480, height: 360 }, deviceScaleFactor: dpr })),
    (page) =>
      browserCall("page.close", () => page.close()).pipe(Effect.orDie),
  );
const projectRung = Effect.fn("LookTargets.projectRung")(function*(
  browser: Browser,
  baseUrl: string,
  rung: CaptureConfiguration["rung"],
) {
  const config: CaptureConfiguration = {
    technique: "B",
    backend: "webgl",
    theme: "day",
    asset: "scene",
    width: 480,
    height: 360,
    dpr: 1,
    desks: 12,
    rung,
    seed: fixedSeed,
    fixedTimeEpochMs,
  };
  const page = yield* pageResource(browser, 1);
  const url = new URL(baseUrl);
  for (const [key, value] of Object.entries(config)) url.searchParams.set(key, String(value));
  yield* browserCall("page.goto", () => page.goto(url.href));
  yield* browserCall("look.ready", () => page.waitForFunction(() => window.floorLook?.state()._tag === "Ready"));
  const observed: unknown = yield* browserCall("cpu.project", () => page.evaluate(() => window.floorTest.targets()));
  return yield* Schema.decodeUnknownEffect(Projection)(observed);
}, Effect.scoped);
const svg = (width: number, height: number, content: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="white"/>${content}</svg>`;
const rasterize = Effect.fn("LookTargets.rasterize")(
  function*(browser: Browser, dpr: number, markup: string, output: string) {
    const page = yield* pageResource(browser, dpr);
    yield* browserCall(
      "svg.setContent",
      () => page.setContent(`<style>html,body{margin:0;overflow:hidden}</style>${markup}`),
    );
    const bytes = yield* browserCall("svg.screenshot", () => page.screenshot({ path: output }));
    const crypto = yield* Crypto.Crypto;
    return Hex.encode(yield* crypto.digest("SHA-256", bytes));
  },
  Effect.scoped,
);

const generate = Effect.fn("LookTargets.generate")(function*(url: string, output: string) {
  const fs = yield* FileSystem.FileSystem;
  if (yield* fs.exists(output)) {
    return yield* new WorkbenchFailure({
      operation: "target-output",
      cause: "Use a new output directory to preserve earlier evidence",
    });
  }
  yield* fs.makeDirectory(output, { recursive: true });
  const browser = yield* Effect.acquireRelease(
    browserCall(
      "chromium.launch",
      () => chromium.launch({ headless: true, args: ["--use-angle=swiftshader-webgl", "--enable-unsafe-swiftshader"] }),
    ),
    (owned) => browserCall("chromium.close", () => owned.close()).pipe(Effect.orDie),
  );
  const rungs: ReadonlyArray<CaptureConfiguration["rung"]> = ["building", "floor", "desk"];
  const projections = yield* Effect.forEach(
    rungs,
    Effect.fnUntraced(function*(rung) {
      const projection = yield* projectRung(browser, url, rung);
      yield* writeJson(`${output}/${rung}-projection.json`, projection);
      return { rung, projection };
    }),
    { concurrency: 1 },
  );
  const first = Option.fromUndefinedOr(projections[0]);
  if (Option.isNone(first)) {
    return yield* new WorkbenchFailure({ operation: "target-source", cause: "No rung was projected" });
  }
  const baseline = first.value.projection;
  if (projections.some((row) => row.projection.sourceSceneSha256 !== baseline.sourceSceneSha256)) {
    return yield* new WorkbenchFailure({
      operation: "target-source",
      cause: "All rungs must project identical immutable scene bytes",
    });
  }
  const primitiveReport = {
    sourceSceneSha256: baseline.sourceSceneSha256,
    method: "Independent convex hull of projected source vertices, sampled against CPU target segments",
    cases: projections.flatMap((row) =>
      row.projection.primitiveCases.map((checked) => ({ rung: row.rung, ...checked }))
    ),
  };
  const primitiveReportSha256 = yield* writeJson(`${output}/primitives.json`, primitiveReport);
  if (primitiveReport.cases.some((row) => !row.pass)) {
    return yield* new WorkbenchFailure({
      operation: "primitive-silhouettes",
      cause: "A primitive failed; inspect the retained projections and primitive report",
    });
  }
  const cases = yield* Effect.forEach(
    projections,
    Effect.fnUntraced(function*({ rung, projection }) {
      const path = projection.segments.map((segment) => `M${segment.a.x},${segment.a.y}L${segment.b.x},${segment.b.y}`)
        .join("");
      const target = svg(
        480,
        360,
        `<path d="${path}" fill="none" stroke="black" stroke-width="1" stroke-linecap="butt"/>`,
      );
      const points = projection.cylinderRegion.map((point) => `${point.x},${point.y}`).join(" ");
      const region = svg(480, 360, `<polygon points="${points}" fill="black"/>`);
      yield* fs.writeFileString(`${output}/${rung}-target.svg`, target);
      yield* fs.writeFileString(`${output}/${rung}-region.svg`, region);
      return yield* Effect.forEach(
        [1, 2, 3],
        Effect.fnUntraced(function*(dpr) {
          const image = `${rung}-${dpr}.png`, cylinderRegion = `${rung}-${dpr}-region.png`;
          const imageSha256 = yield* rasterize(browser, dpr, target, `${output}/${image}`);
          const cylinderRegionSha256 = yield* rasterize(browser, dpr, region, `${output}/${cylinderRegion}`);
          return {
            rung,
            dpr,
            image,
            imageSha256,
            cylinderRegion,
            cylinderRegionSha256,
            silhouetteSampleRaster: {
              x: projection.silhouetteSampleCss.x * dpr,
              y: projection.silhouetteSampleCss.y * dpr,
            },
            regionSpecification: projection.regionSpecification,
          };
        }),
        { concurrency: 1 },
      );
    }),
    { concurrency: 1 },
  );
  yield* writeJson(`${output}/manifest.json`, {
    sourceSceneSha256: baseline.sourceSceneSha256,
    generator: "three-edge-projection",
    generatorVersion: baseline.generatorVersion,
    primitiveReportSha256,
    approval: Approval.make({}),
    cases: cases.flat(),
  });
  yield* Effect.logInfo(`Generated nine synthetic target rasters and verified nine primitive cases in ${output}`);
  return cases.flat().length;
}, Effect.scoped);

const command = Command.make(
  "look-targets",
  { url: Flag.String("url"), output: Flag.String("out") },
  Effect.fn("LookTargets.command")(function*({ url, output }) {
    yield* generate(url, output);
  }),
);

if (import.meta.main) {
  // oxlint-disable-next-line effecttsgo/strict-effect-provide -- This CLI owns browser, filesystem and digest services for web-owned target generation.
  BunRuntime.runMain(command.pipe(Command.run({ version: "1.0.0" }), Effect.provide(BunServices.layer)));
}
