# Capture adapter and phone profile

The development-only `/look/` route supports deterministic renderer captures and the required phone benchmark. The finished tone/proportion studies, capture matrix, pixel metrics and CPU target generator are retired. Approved frames and their scene briefs remain under `testing/reference/` and `testing/look/scenes/`; the asset branch supplies their zero-tolerance screenshot checks.

## Commands

The normal acceptance command starts its own built workbench and runs the phone profile with the other renderer checks:

```sh
bun run e2e --project renderer
```

For a separate measurement, start the built development renderer and choose a new output directory. Existing attempts are never overwritten.

```sh
bunx --no-install vite build --config apps/web/vite.config.ts --mode workbench
bunx --no-install vite preview --config apps/web/vite.config.ts --mode workbench --host 127.0.0.1 --port 5180

bun testing/look/run.ts --url http://127.0.0.1:5180/look/ \
  --renderer swiftshader --out work/look/phone-001
```

The profile measures 12 and 1,000 desks at 390×844 CSS pixels, DPR 3 and 4× CPU throttling: 10 warmup frames followed by 120 CPU and completed-frame samples. Its 16.7 ms CPU p95 limit is unchanged. Reports retain raw samples, floor-index p50/p95/p99, memory/call counters, a PNG and a Playwright trace. GPU duration is reported only if the adapter supplies actual timer-query samples; missing measurements are never zeroes.

`--renderer apple` requires Chrome reporting an Apple renderer and creates separate evidence. Desktop throttling and software rendering do not prove performance on a real phone. The default SwiftShader check remains required. Only one browser suite may run on the machine at a time.

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
