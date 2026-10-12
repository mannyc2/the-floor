import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Crypto, Effect, FileSystem, Option, Schema } from "effect";
import { Command, Flag } from "effect/cli";
import { Hex } from "effect/encoding";
import { cylinderDensity, cylinderWidth, scores } from "./metrics";
import { erodeRegion, grayscaleOnWhite, MeasurementError, thresholdMask } from "./pixels";
import { decodePng } from "./png";
import { CaptureConfiguration, Sha256 } from "./protocol";

const RasterPoint = Schema.Struct({ x: Schema.Finite, y: Schema.Finite });
const localPng = Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9_-]+\.png$/));
const Target = Schema.Struct({
  rung: Schema.Literals(["district", "works", "machine"]),
  dpr: Schema.Literals([1, 2, 3]),
  image: localPng,
  imageSha256: Sha256,
  cylinderRegion: localPng,
  cylinderRegionSha256: Sha256,
  silhouetteSampleRaster: RasterPoint,
  regionSpecification: Schema.NonEmptyString,
});
const TargetManifest = Schema.Struct({
  sourceSceneSha256: Sha256,
  generator: Schema.Literal("three-edge-projection"),
  generatorVersion: Schema.NonEmptyString,
  primitiveReportSha256: Sha256,
  approval: Schema.Union([
    Schema.TaggedStruct("SyntheticUnapproved", {}),
    Schema.TaggedStruct("OwnerApproved", { owner: Schema.NonEmptyString, decisionReference: Schema.NonEmptyString }),
  ]),
  cases: Schema.NonEmptyArray(Target),
});
const PrimitiveReport = Schema.Struct({
  sourceSceneSha256: Sha256,
  cases: Schema.NonEmptyArray(
    Schema.Struct({ pass: Schema.Boolean, samples: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)) }),
  ),
});
const Capture = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("measured"),
    id: Schema.String.check(Schema.isPattern(/^B-(day|night)-(district|works|machine)-[123]$/)),
    config: CaptureConfiguration,
    sourceSceneSha256: Sha256,
    repeatable: Schema.Boolean,
  }),
  Schema.Struct({ status: Schema.Literal("failed"), config: CaptureConfiguration, reason: Schema.String }),
]);
interface UnmeasuredCell {
  readonly status: "not_measured";
  readonly config: CaptureConfiguration;
  readonly reason: string;
}
interface MeasuredCell {
  readonly status: "measured";
  readonly id: string;
  readonly config: CaptureConfiguration;
  readonly repeatable: boolean;
  readonly capture: string;
  readonly captureSha256: string;
  readonly target: typeof Target.Type;
  readonly againstTarget: Effect.Success<ReturnType<typeof scores>>;
  readonly cylinderWidth: Effect.Success<ReturnType<typeof cylinderWidth>>;
  readonly targetCylinderWidth: Effect.Success<ReturnType<typeof cylinderWidth>>;
  readonly cylinderInterior: Effect.Success<ReturnType<typeof cylinderDensity>>;
}
const optionalNumber = (value: Option.Option<number>) => Option.getOrNull(value);
const stats = (values: ReadonlyArray<number>) =>
  values.length === 0 ? Option.none() : Option.some({
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    min: Math.min(...values),
    max: Math.max(...values),
  });
const present = (values: ReadonlyArray<Option.Option<number>>) =>
  values.flatMap((value) => Option.match(value, { onNone: () => [], onSome: (number) => [number] }));
const readPng = Effect.fn("readVerifiedLookPng")(function*(path: string, expected: string) {
  const fs = yield* FileSystem.FileSystem, crypto = yield* Crypto.Crypto;
  const bytes = yield* fs.readFile(path);
  const sha256 = Hex.encode(yield* crypto.digest("SHA-256", bytes));
  if (sha256 !== expected) {
    return yield* new MeasurementError({
      operation: "readPng",
      invariant: `Image checksum does not match the manifest: ${path}`,
    });
  }
  return yield* grayscaleOnWhite(yield* decodePng(bytes));
});
const measureCell = Effect.fn("measureLookCell")(
  function*(capture: typeof Capture.Type, manifest: typeof TargetManifest.Type, captures: string, targets: string) {
    if (capture.status === "failed") {
      const row: UnmeasuredCell = { status: "not_measured", config: capture.config, reason: capture.reason };
      return row;
    }
    if (capture.sourceSceneSha256 !== manifest.sourceSceneSha256) {
      return yield* new MeasurementError({
        operation: "measureCell",
        invariant: "The capture and CPU target use different scene bytes",
      });
    }
    const matching = manifest.cases.filter((candidate) =>
      candidate.rung === capture.config.rung && candidate.dpr === capture.config.dpr
    );
    if (matching.length !== 1) {
      return yield* new MeasurementError({
        operation: "measureCell",
        invariant: "Exactly one CPU target is required per rung/DPR",
      });
    }
    const selected = yield* Effect.fromOption(Option.fromNullishOr(matching[0]));
    const fs = yield* FileSystem.FileSystem, crypto = yield* Crypto.Crypto;
    const capturePath = `${captures}/${capture.id}/edges.png`;
    const bytes = yield* fs.readFile(capturePath);
    const gray = yield* grayscaleOnWhite(yield* decodePng(bytes));
    const targetGray = yield* readPng(`${targets}/${selected.image}`, selected.imageSha256);
    const regionGray = yield* readPng(`${targets}/${selected.cylinderRegion}`, selected.cylinderRegionSha256);
    const prediction = yield* thresholdMask(gray), target = yield* thresholdMask(targetGray);
    const region = yield* erodeRegion(yield* thresholdMask(regionGray), capture.config.dpr);
    const againstTarget = yield* scores(prediction, target, capture.config.dpr);
    const width = yield* cylinderWidth(gray, selected.silhouetteSampleRaster, capture.config.dpr);
    const targetWidth = yield* cylinderWidth(targetGray, selected.silhouetteSampleRaster, capture.config.dpr);
    const density = yield* cylinderDensity(prediction, target, region, capture.config.dpr);
    const row: MeasuredCell = {
      status: "measured",
      id: capture.id,
      config: capture.config,
      repeatable: capture.repeatable,
      capture: capturePath,
      captureSha256: Hex.encode(yield* crypto.digest("SHA-256", bytes)),
      target: selected,
      againstTarget,
      cylinderWidth: width,
      targetCylinderWidth: targetWidth,
      cylinderInterior: density,
    };
    return row;
  },
);
const widthJson = (value: Effect.Success<ReturnType<typeof cylinderWidth>>) => ({
  ...value,
  nearestRunDistanceCssPx: optionalNumber(value.nearestRunDistanceCssPx),
});
const measuredJson = (value: Effect.Success<ReturnType<typeof measureCell>>): Schema.Json => {
  if (value.status === "not_measured") return { status: value.status, config: value.config, reason: value.reason };
  const score = value.againstTarget, density = value.cylinderInterior;
  return {
    status: value.status,
    id: value.id,
    config: value.config,
    repeatable: value.repeatable,
    capture: value.capture,
    captureSha256: value.captureSha256,
    target: value.target,
    againstTarget: {
      ...score,
      exactF1: optionalNumber(score.exactF1),
      tolerantF1: optionalNumber(score.tolerantF1),
      exactPrecision: optionalNumber(score.exactPrecision),
      exactRecall: optionalNumber(score.exactRecall),
      tolerantPrecision: optionalNumber(score.tolerantPrecision),
      tolerantRecall: optionalNumber(score.tolerantRecall),
    },
    cylinderWidth: widthJson(value.cylinderWidth),
    targetCylinderWidth: widthJson(value.targetCylinderWidth),
    cylinderInterior: {
      ...density,
      fractionOfRoi: optionalNumber(density.fractionOfRoi),
      meanFalseCrossingsPer100CssPx: optionalNumber(density.meanFalseCrossingsPer100CssPx),
    },
  };
};

const measure = Effect.fn("measureLookAttempt")(
  function*(
    paths: {
      readonly captures: string;
      readonly targets: string;
      readonly primitiveReport: string;
      readonly output: string;
    },
  ) {
    const fs = yield* FileSystem.FileSystem, crypto = yield* Crypto.Crypto;
    const manifest = yield* fs.readFileString(`${paths.targets}/manifest.json`).pipe(
      Effect.flatMap(Schema.decodeEffect(Schema.fromJsonString(TargetManifest))),
    );
    const primitiveBytes = yield* fs.readFile(paths.primitiveReport);
    const primitive = yield* Schema.decodeEffect(Schema.fromJsonString(PrimitiveReport))(
      new TextDecoder().decode(primitiveBytes),
    );
    if (
      Hex.encode(yield* crypto.digest("SHA-256", primitiveBytes)) !== manifest.primitiveReportSha256
      || primitive.sourceSceneSha256 !== manifest.sourceSceneSha256 || primitive.cases.some((item) => !item.pass)
    ) {
      return yield* new MeasurementError({
        operation: "measure",
        invariant: "The pinned primitive silhouette check must pass for the target's source scene",
      });
    }
    const captures = yield* fs.readFileString(`${paths.captures}/results.json`).pipe(
      Effect.flatMap(Schema.decodeEffect(Schema.fromJsonString(Schema.NonEmptyArray(Capture)))),
    );
    if (yield* fs.exists(paths.output)) {
      return yield* new MeasurementError({
        operation: "measure",
        invariant: "Choose a new metrics output directory to preserve earlier evidence",
      });
    }
    const rows = yield* Effect.forEach(
      captures,
      (capture) => measureCell(capture, manifest, paths.captures, paths.targets),
    );
    const measured = rows.filter((row) => row.status === "measured");
    const exact = present(measured.map((row) => row.againstTarget.exactF1)),
      tolerant = present(measured.map((row) => row.againstTarget.tolerantF1));
    const output = {
      methodology: {
        groundTruth:
          "Web-owned three-edge-projection CPU visible-edge extraction, matched by source-scene and target PNG hashes; primitive convex silhouettes checked independently",
        threshold: "8-bit grayscale <128 after alpha composition on white",
        tolerance:
          "Euclidean disk radius DPR is exactly one CSS pixel; many-to-many pixel precision/recall, not topology accuracy",
        cylinder:
          "Web adapter supplies the visible half of the paper cylinder, middle half of its height, and its clean right-silhouette sample. The harness erodes the supplied region by two CSS pixels before counting false runs.",
        stroke:
          "Nearest thresholded run within two CSS pixels, measured against one CSS pixel plus or minus 0.25; one clean profile cannot prove every orientation",
        limitations: [
          "No F1 or density art-quality cutoff is invented",
          "Missing evidence is unmeasured",
          "Synthetic targets are not owner approval",
          "Pixel F1 depends on phase, width and occlusion semantics",
        ],
      },
      sourceSceneSha256: manifest.sourceSceneSha256,
      approval: manifest.approval,
      primitiveValidation: { cases: primitive.cases.length, failures: 0, sha256: manifest.primitiveReportSha256 },
      cells: rows.map(measuredJson),
      summary: {
        measuredCells: measured.length,
        unmeasuredCells: rows.length - measured.length,
        exactF1: Option.getOrNull(stats(exact)),
        tolerantF1: Option.getOrNull(stats(tolerant)),
        localStrokeWidthFailures: measured.filter((row) => !row.cylinderWidth.withinOnePlusMinusQuarter).length,
      },
    };
    yield* fs.makeDirectory(paths.output, { recursive: true });
    const encoded = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Json))(output);
    yield* fs.writeFileString(`${paths.output}/metrics.json`, encoded + "\n");
    const csv = [
      "id,status,theme,rung,dpr,exact_f1,tolerant_1_css_f1,local_width_css,width_within_requirement,false_crossings_per_100_css_px",
    ];
    for (const row of rows) {
      if (row.status === "not_measured") {
        csv.push(["", "not_measured", row.config.theme, row.config.rung, row.config.dpr].join(","));
        continue;
      }
      csv.push(
        [
          row.id,
          row.status,
          row.config.theme,
          row.config.rung,
          row.config.dpr,
          Option.getOrElse(row.againstTarget.exactF1, () => ""),
          Option.getOrElse(row.againstTarget.tolerantF1, () => ""),
          row.cylinderWidth.thresholdWidthCssPx,
          row.cylinderWidth.withinOnePlusMinusQuarter,
          Option.getOrElse(row.cylinderInterior.meanFalseCrossingsPer100CssPx, () => ""),
        ].join(","),
      );
    }
    yield* fs.writeFileString(`${paths.output}/metrics.csv`, csv.join("\n") + "\n");
    return measured.length;
  },
);
const command = Command.make(
  "look-metrics",
  {
    captures: Flag.String("captures"),
    targets: Flag.String("targets"),
    primitiveReport: Flag.String("primitive-report"),
    output: Flag.String("out"),
  },
  Effect.fn("LookMetrics.command")(function*(paths) {
    const count = yield* measure(paths);
    yield* Effect.logInfo(`Measured ${count} cells in ${paths.output}`);
  }),
);
if (import.meta.main) {
  // oxlint-disable-next-line effecttsgo/strict-effect-provide -- This metrics executable owns filesystem, digest and CLI platform capabilities.
  BunRuntime.runMain(command.pipe(Command.run({ version: "1.0.0" }), Effect.provide(BunServices.layer)));
}
