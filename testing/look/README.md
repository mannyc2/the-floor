# Deterministic look harness

This is the Stage 0 promotion of the look-a pixel measurements and capture drivers. It is **not a look approval or a renderer implementation**. Technique B on WebGL is the only promoted path. The external Foldkit round owns scene construction, the map host, camera, picking and three.js projection in `apps/web`.

## Provenance and limits

- [Pixel measurements](../../apps/web/spikes/look-a/metrics.py): half-darkness masks, exact and one-CSS-pixel tolerant F1, paper-cylinder interior density and local stroke width. Python ties-to-even sample rounding is retained. Missing targets and empty regions remain unmeasured; empty images never produce a perfect score.
- [Matrix driver](../../apps/web/spikes/look-a/matrix.ts), [phone profile](../../apps/web/spikes/look-a/performance.ts) and [impostor check](../../apps/web/spikes/look-a/impostors.ts): deterministic capture, 390×844 / DPR 3 / 4× CPU throttle, and 256→64 exact area-average mask sampling.
- [CPU edge projection](../../apps/web/spikes/look-a/project-edges.ts) and [primitive checks](../../apps/web/spikes/look-a/primitive-silhouettes.ts): projection remains web-owned to preserve the three.js boundary. `silhouettes.ts` independently checks a convex hull from supplied projected vertices against supplied target segments, with the inherited 0.0001 CSS-pixel engineering tolerance. It does not project a scene.
- [Look evidence](../../docs/spikes/evidence/look/) records the original work; it is not evidence for this promotion. Fresh capture and target paths are mandatory.

The pure checks cover thresholding and alpha, Euclidean disk tolerance, malformed rasters, empty measurements, false-line runs, region erosion, CSS stroke width, repeatability, thin-line loss, timing percentiles, primitive boundary failures and the exchange schema. No F1, interior-density or impostor acceptance cutoff is invented. Pixel F1 is sensitive to raster phase, width and occlusion; it is not a topology or art-quality score. The local cylinder profile does not prove line width in every orientation.

## Commands

Run from the repository root with its pinned Bun and installed Playwright browser. Choose a **new** output directory each time; attempts are never overwritten.

```sh
bun test ./testing/look/test
bun testing/look/run.ts --help
bun testing/look/measure.ts --help

# Requires the real external web adapter described below.
bun testing/look/run.ts --mode matrix --url http://localhost:5180/look \
  --renderer swiftshader --repetitions 20 --out work/look/matrix-001
bun testing/look/run.ts --mode phone --url http://localhost:5180/look \
  --renderer apple --out work/look/phone-001
bun testing/look/run.ts --mode impostor --url http://localhost:5180/look \
  --renderer swiftshader --out work/look/impostor-001

# Requires matching capture, target and independent primitive evidence.
bun testing/look/measure.ts --captures work/look/matrix-001 \
  --targets work/look/targets-001 \
  --primitive-report work/look/primitive-001.json \
  --out work/look/metrics-001
```

`matrix` measures all 18 B/WebGL combinations of day/night, district/works/machine and DPR 1/2/3, at 480×360 CSS pixels with 12 stalls. Each cell performs 20 navigations by default and compares every RGBA byte. At least two navigations are required. Full images, the final edge-only mask, PNG hashes, renderer/browser identity, asset hashes and per-cell results are retained. A missing adapter, configuration mismatch, runtime error or changing pixels fails the run and retains the failed cell. The runner stops at the first failed cell; it does not manufacture rows for later unmeasured cells.

`phone` requires Chrome reporting an Apple renderer. It measures 12 and 1,000 stalls, with 10 warmup frames followed by 120 CPU and completed-frame samples. The report retains raw samples, floor-index p50/p95/p99, memory/call counters, a PNG and a Playwright trace. GPU duration is reported only when the adapter supplies actual timer-query samples. A Playwright trace is browser interaction evidence, not a DevTools GPU trace. Desktop CPU throttling is not evidence of real-phone performance. The 16.7 ms CPU budget is the inherited profile budget.

`impostor` captures the same rack and scene/font bytes at 256 and 64 CSS pixels, DPR 1. It area-averages each 4×4 block without another outline, then records half-darkness edge survival and coverage relative to the direct 64 px render. Empty masks preserve missing measurements. This assesses raster sampling; it does not claim the external renderer has implemented production impostors.

## Web adapter handoff

The isolated look route must expose `window.floorLook` with the `LookAdapter` contract from [protocol.ts](protocol.ts) and one visible `canvas[data-floor-look]` at the requested CSS dimensions. The contract is a test boundary; production code must not depend on this harness. Use a web-owned adapter confined to development/testing and exclude it from production bundles.

The harness passes every field of `CaptureConfiguration` as a query parameter:

- `technique=B`, `backend=webgl`, `theme=day|night`, `rung=district|works|machine`;
- `dpr=1|2|3`, CSS `width`, CSS `height`, and `stalls`;
- `asset=scene|rack`, `seed=439041101`, `fixedTimeEpochMs=1791806460000`.

It fixes the browser wall clock and resets seeded `Math.random` before each document script, without replacing the performance clock. The renderer must apply every requested field and stabilize its frame before returning `Ready`. Fonts must be loaded and content-hashed by the adapter. A configuration field must not be silently ignored.

The adapter methods are:

- `state()` returns `Loading`, `Failed` with a reason, `Unavailable`, or `Ready`. `Ready` includes protocol version 1, the applied configuration, the actual renderer identity, `sourceSceneSha256` and `fontManifestSha256`. Scene hashes cover immutable scene/geometry bytes independent of theme, rung and raster resolution; configuration is recorded separately. Font hashes identify the exact font manifest/bytes. Use lower-case SHA-256 hex.
- `mask(enabled)` returns a promise that resolves only after the edge-only black-on-white frame (or restored colour frame) has finished rendering. It must preserve camera, geometry, viewport and line semantics.
- `bench(frames, warmupFrames)` returns `BenchResult` after the requested warmup. `cpuMs` and `completedFrameMs` must each contain exactly `frames` samples. Report GPU timers as `Measured` with method and nonempty actual samples, or `Unavailable` with a reason. Do not estimate GPU time from frame or CPU time.

The runner checks returned values and the observed canvas raster. `Ready` is not a substitute for named owner approval. The URL must be the real renderer route; the Stage 0 shell does not provide this adapter.

## Target and primitive handoff

The web-owned test tooling produces CPU edge targets from the exact source scene using `three-edge-projection`. It must also export each primitive's projected vertices and target segments for `validateConvexSilhouette`. Its primitive report contains at least `sourceSceneSha256` and a nonempty `cases` array with `pass` and `samples` for every checked primitive. Each sample count must be positive and every case must pass. Retain full hull/distance/primitive identity details alongside these required fields for review. Run the independent check; never fill these fields from assumptions.

The target folder contains `manifest.json` with this shape (values below are explanatory, not usable evidence):

```text
{
  sourceSceneSha256: lower-case SHA-256 of the immutable scene bytes,
  generator: "three-edge-projection",
  generatorVersion: exact installed package version,
  primitiveReportSha256: lower-case SHA-256 of the primitive report file bytes,
  approval: { _tag: "SyntheticUnapproved" }
            or { _tag: "OwnerApproved", owner: name, decisionReference: recorded decision },
  cases: [
    {
      rung: "district" | "works" | "machine",
      dpr: 1 | 2 | 3,
      image: local target PNG filename,
      imageSha256: lower-case SHA-256 of that PNG,
      cylinderRegion: local region PNG filename,
      cylinderRegionSha256: lower-case SHA-256 of that PNG,
      silhouetteSampleRaster: { x: raster x, y: raster y },
      regionSpecification: exact geometry/projection description
    }
  ]
}
```

PNG names must match `[a-zA-Z0-9_-]+.png` and stay in the target folder. Each captured rung/DPR must have exactly one matching target. Target, region and capture dimensions must agree. Target PNGs have black edges on white. The region PNG is black inside and white outside the visible half of the paper cylinder, using the middle half of its height; generate it from the actual camera/geometry. Supply the clean right-silhouette sample in **raster** pixels. The harness erodes the region by two CSS pixels, excludes target lines within one CSS pixel, then counts contiguous false runs along scan rows spaced one CSS pixel apart.

`measure.ts` reads the matrix `results.json`, verifies the source scene and all target/primitive hashes, preserves failed captures as `not_measured`, and writes `metrics.json` and `metrics.csv`. Undefined numeric measurements become JSON `null` or empty CSV fields. It rejects absent or failing primitive evidence and mismatched scene bytes. Synthetic targets stay labelled `SyntheticUnapproved`; changing that label is not a human sign-off workflow. Approved references require the owner's actual named decision and selected frames in the evidence log.

No live matrix, phone, impostor or art acceptance is implied by passing the pure tests or a synthetic CLI smoke check. Those steps remain blocked until the external renderer and target adapter exist; owner art picks remain a separate gate.

## Runtime exceptions

The three `effecttsgo/strict-effect-provide` suppressions identify executable boundaries in `run.ts`, `measure.ts` and `driver.ts`. The single `effect/noGlobals` suppression seeds the isolated browser's native `Math.random` before renderer startup. No Effect runtime, platform services, three.js or test assets leak into an application package through this harness.
