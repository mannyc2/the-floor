# Deterministic look harness

Deterministic pixel measurements and capture drivers for the look. It is **not a look approval or a renderer implementation**. Technique B on WebGL is the only promoted path. Scene construction, the map host, camera, picking and three.js projection belong to `apps/web`.

## Provenance and limits

- Pixel measurements (`metrics.ts` and `pixels.ts`): half-darkness masks, exact and one-CSS-pixel tolerant F1, paper-cylinder interior density and local stroke width. Python ties-to-even sample rounding is retained. Missing targets and empty regions remain unmeasured; empty images never produce a perfect score.
- The matrix driver, phone profile and impostor check (`driver.ts`, `performance.ts` and `impostor.ts`): deterministic capture, 390×844 / DPR 3 / 4× CPU throttle, and 256→64 exact area-average mask sampling.
- CPU edge projection and primitive checks remain web-owned to preserve the three.js boundary. `silhouettes.ts` independently checks a convex hull from supplied projected vertices against supplied target segments, with the inherited 0.0001 CSS-pixel engineering tolerance. It does not project a scene.
- Fresh capture and target paths are mandatory; the technique's earlier measurements are summarised in [the look](../../docs/look.md#the-technique) and are not evidence for new runs.

The pure checks cover thresholding and alpha, Euclidean disk tolerance, malformed rasters, empty measurements, false-line runs, region erosion, CSS stroke width, repeatability, thin-line loss, timing percentiles, primitive boundary failures and the exchange schema. No F1, interior-density or impostor acceptance cutoff is invented. Pixel F1 is sensitive to raster phase, width and occlusion; it is not a topology or art-quality score. The local cylinder profile does not prove line width in every orientation.

## Commands

Run from the repository root with its pinned Bun and installed Playwright browser. Choose a **new** output directory each time; attempts are never overwritten.

```sh
bun test ./testing/look/test
bun testing/look/run.ts --help
bun testing/look/measure.ts --help

# Start the built development renderer in another terminal.
bun run build:workbench
bunx --no-install vite preview --config apps/web/vite.config.ts --mode workbench --port 5180

# Capture the real renderer through its development-only look route.
bun testing/look/run.ts --mode matrix --url http://localhost:5180/look/ \
  --renderer swiftshader --repetitions 20 --out work/look/matrix-001
bun testing/look/run.ts --mode phone --url http://localhost:5180/look/ \
  --renderer apple --out work/look/phone-001
bun testing/look/run.ts --mode impostor --url http://localhost:5180/look/ \
  --renderer swiftshader --out work/look/impostor-001

# Generate matching CPU targets and independent primitive evidence.
bun apps/web/workbench/generate-targets.ts --url http://localhost:5180/look/ \
  --out work/look/targets-001
bun testing/look/measure.ts --captures work/look/matrix-001 \
  --targets work/look/targets-001 \
  --primitive-report work/look/targets-001/primitives.json \
  --out work/look/metrics-001
```

`matrix` measures all 18 B/WebGL combinations of day/night, building/floor/desk and DPR 1/2/3, at 480×360 CSS pixels with 12 desks. Each cell performs 20 navigations by default and compares every RGBA byte. At least two navigations are required. Full images, the final edge-only mask, PNG hashes, renderer/browser identity, asset hashes and per-cell results are retained. A missing adapter, configuration mismatch, runtime error or changing pixels fails the run and retains the failed cell. The runner stops at the first failed cell; it does not manufacture rows for later unmeasured cells.

`phone --renderer apple` requires Chrome reporting an Apple renderer. `--renderer swiftshader` runs the same viewport and CPU-throttling profile with software rendering, and labels that distinction in its retained evidence. It measures 12 and 1,000 desks, with 10 warmup frames followed by 120 CPU and completed-frame samples. The report retains raw samples, floor-index p50/p95/p99, memory/call counters, a PNG and a Playwright trace. GPU duration is reported only when the adapter supplies actual timer-query samples. A Playwright trace is browser interaction evidence, not a DevTools GPU trace. Desktop CPU throttling is not evidence of real-phone performance. The 16.7 ms CPU budget is the inherited profile budget.

`impostor` captures the same rack and scene/font bytes at 256 and 64 CSS pixels, DPR 1. It area-averages each 4×4 block without another outline, then records half-darkness edge survival and coverage relative to the direct 64 px render. Empty masks preserve missing measurements. The protocol name `rack` identifies the isolated synthetic interpolation gauge. This assesses raster sampling; it does not claim the renderer has implemented production impostors.

## Web adapter handoff

The isolated look route must expose `window.floorLook` with the `LookAdapter` contract from [protocol.ts](protocol.ts) and one visible `canvas[data-floor-look]` at the requested CSS dimensions. The contract is a test boundary; production code must not depend on this harness. Use a web-owned adapter confined to development/testing and exclude it from production bundles.

The harness passes every field of `CaptureConfiguration` as a query parameter:

- `technique=B`, `backend=webgl`, `theme=day|night`, `rung=building|floor|desk`;
- `dpr=1|2|3`, CSS `width`, CSS `height`, and `desks`;
- `asset=scene|rack`, `seed=439041101`, `fixedTimeEpochMs=1791806460000`.

It fixes the browser wall clock and resets seeded `Math.random` before each document script, without replacing the performance clock. The renderer must apply every requested field and stabilize its frame before returning `Ready`. Fonts must be loaded and content-hashed by the adapter. A configuration field must not be silently ignored.

The current scene is explicitly synthetic and unapproved. Its camera extents are 21, 12 and 7 kit units for the three rungs, with 380 units for the 1,000-desk building profile. The scene contains no random geometry and accepts only the protocol’s fixed seed and clock. Its wordless canvas uses no fonts, so the font digest covers an explicit empty canvas-font manifest; interface text is outside the captured canvas.

The adapter methods are:

- `state()` returns `Loading`, `Failed` with a reason, `Unavailable`, or `Ready`. `Ready` includes protocol version 1, the applied configuration, the actual renderer identity, `sourceSceneSha256`, `paletteSha256` and `fontManifestSha256`. Scene hashes cover immutable scene/geometry bytes independent of theme, rung and raster resolution; configuration is recorded separately. Palette hashes cover the day/night colour table and line opacity. Font hashes identify the exact font manifest/bytes. Use lower-case SHA-256 hex.
- `mask(enabled)` returns a promise that resolves only after the edge-only black-on-white frame (or restored colour frame) has finished rendering. It must preserve camera, geometry, viewport and line semantics.
- `bench(frames, warmupFrames)` returns `BenchResult` after the requested warmup. `cpuMs` and `completedFrameMs` must each contain exactly `frames` samples. Report GPU timers as `Measured` with method and nonempty actual samples, or `Unavailable` with a reason. Do not estimate GPU time from frame or CPU time. The current adapter measures CPU submission with the Effect monotonic clock and completed rendering by waiting for `gl.finish`; its GPU timer result is `Unavailable`.

The runner checks returned values and the observed canvas raster. `Ready` is not a substitute for named owner approval. The URL must be the development-only `/look/` renderer route. The production shell exposes neither `floorLook` nor `floorTest`.

## Tone studies

The optional `tones` query contains the JSON encoding of the workbench's `ToneStudy`: an `id` and a validated `palette` with day/night `colors` and `lineOpacity`. Candidates stay in ignored `work/`; the application never imports them. Only `asset=scene`, `rung=building` and `desks=12` admit this fixed study. Its initial Model and renderer both use a 14-unit camera extent, and the scene hash records its blockout and hidden synthetic geometry. The study has independent four-slot ramps for timber, timber floor, paper, steel, glass, brass and three jacket colours. Three horizontal brass dials have static synthetic readings and engraved scales on timber, steel and glass mounting blocks; they do not claim live data or final instrument geometry. Paper remains its own material.

The same engine uploads candidate colours to the linear palette texture and draws its normal colour and surface-id/depth passes. The room-relative four-band shading keeps horizontal tops lightest through quarter turns and uses a small tie tolerance on diagonal side faces. The slope bands, camera and geometry are provisional diagnostic choices until the Atlas is built from the owner's picks. Shape probes expose broad faces and curved bands; they are not proposed characters or production assets.

Tone captures retain the sample provenance, exact palette, shader/source hashes, actual renderer identity and repeated RGBA comparisons. An unlabelled contact sheet supports independent shortlisting and the owner’s choice. Day and night have separate picks: corrected day A is approved, with brass and engraving provisional; the requested night options will be shown beside that approved day render. Numerical contrast checks and another agent's review do not approve art. Reference-image picks are preserved separately in [the scene briefs](scenes/README.md).

## Target and primitive handoff

The web-owned [target generator](../../apps/web/workbench/generate-targets.ts) produces CPU edge targets from the exact source scene using the pinned `three-edge-projection` generator. It navigates the real look route, expands the renderer’s actual instance transforms, and retains the source projection and raster files. It must also export each primitive's projected vertices and target segments for `validateConvexSilhouette`. The same scene’s cylinder, box and sphere are checked at each rung against independently computed convex hulls. Its primitive report contains at least `sourceSceneSha256` and a nonempty `cases` array with `pass` and `samples` for every checked primitive. Each sample count must be positive and every case must pass. Retain full hull/distance/primitive identity details alongside these required fields for review. Run the independent check; never fill these fields from assumptions.

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
      rung: "building" | "floor" | "desk",
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

`measure.ts` reads the matrix `results.json`, verifies the source scene and all target/primitive hashes, preserves failed captures as `not_measured`, and writes `metrics.json` and `metrics.csv`. Undefined numeric measurements become JSON `null` or empty CSV fields. It rejects absent or failing primitive evidence and mismatched scene bytes. Synthetic targets stay labelled `SyntheticUnapproved`; changing that label is not a human sign-off workflow. Approved references require the owner's actual named decision and selected frames in the decision log.

The renderer flow suite runs target generation, all 360 matrix captures, measurement, impostor sampling and the configured phone profile against a built workbench. `FLOOR_PHONE_RENDERER=apple` selects the separate Mac hardware receipt; the default software profile is portable. Each report retains its renderer identity and measurement limits.

No live matrix, phone, impostor or art acceptance is implied by passing the pure tests or a synthetic CLI smoke check. Each requires retained observations from the real web renderer and target tooling; owner art picks remain a separate gate.

## Runtime exceptions

The three harness `effecttsgo/strict-effect-provide` suppressions identify executable boundaries in `run.ts`, `measure.ts` and `driver.ts`. The single `effect/noGlobals` suppression seeds the isolated browser's native `Math.random` before renderer startup. No Effect runtime, platform services, three.js or test assets leak into an application package through this harness.
