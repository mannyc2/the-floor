import { DateTime, Schema } from "effect";

export const fixedTimeEpochMs = DateTime.toEpochMillis(DateTime.makeUnsafe("2026-10-12T12:01:00Z"));
export const fixedSeed = 0x1a2b3c4d;
const positiveInteger = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));
const nonnegative = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0));
export const Sha256 = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/));
export const CaptureConfiguration = Schema.Struct({
  technique: Schema.Literal("B"),
  backend: Schema.Literal("webgl"),
  theme: Schema.Literals(["day", "night"]),
  rung: Schema.Literals(["building", "floor", "desk"]),
  dpr: Schema.Literals([1, 2, 3]),
  width: positiveInteger,
  height: positiveInteger,
  desks: positiveInteger,
  asset: Schema.Literals(["scene", "rack"]),
  seed: Schema.Int,
  fixedTimeEpochMs: Schema.Finite,
});
export type CaptureConfiguration = typeof CaptureConfiguration.Type;

export const ReadyState = Schema.TaggedStruct("Ready", {
  protocolVersion: Schema.Literal(1),
  config: CaptureConfiguration,
  renderer: Schema.NonEmptyString,
  sourceSceneSha256: Sha256,
  fontManifestSha256: Sha256,
  paletteSha256: Sha256,
});
export const AdapterState = Schema.Union([
  ReadyState,
  Schema.TaggedStruct("Loading", {}),
  Schema.TaggedStruct("Failed", { reason: Schema.NonEmptyString }),
  Schema.TaggedStruct("Unavailable", {}),
]);
export type AdapterState = typeof AdapterState.Type;
export const BenchResult = Schema.Struct({
  frames: positiveInteger,
  warmupFrames: positiveInteger,
  cpuMs: Schema.Array(nonnegative),
  completedFrameMs: Schema.Array(nonnegative),
  gpu: Schema.Union([
    Schema.TaggedStruct("Measured", { samplesMs: Schema.NonEmptyArray(nonnegative), method: Schema.NonEmptyString }),
    Schema.TaggedStruct("Unavailable", { reason: Schema.NonEmptyString }),
  ]),
  drawCalls: nonnegative,
  triangles: nonnegative,
  targetBytes: nonnegative,
  lineBufferBytes: nonnegative,
});
export type BenchResult = typeof BenchResult.Type;

// The web-owned adapter constructs scenes and cameras. This protocol carries
// only observations, so testing/look cannot import three.js.
export interface LookAdapter {
  readonly state: () => AdapterState;
  readonly mask: (enabled: boolean) => Promise<void>;
  readonly bench: (frames: number, warmupFrames: number) => Promise<BenchResult>;
}

declare global {
  interface Window {
    floorLook?: LookAdapter;
  }
}
