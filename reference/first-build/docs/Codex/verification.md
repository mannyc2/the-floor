# Verification

Run `bun run format:check`, `bun run typecheck`, `bun run lint`, `bun run test`, and `bun run build` before handing off changes. CI uses Bun 1.4.0 and a frozen lockfile. Native integration flows require Foundry/Anvil and the Chromium installed by `bunx playwright-core install chromium`; install them before running `bun run test`. The gate flow builds and serves its own temporary rendering entry, and retains its images under `test-results/gate-flow`.

The separate browser journey checks the production build through an isolated local server on port 8791 with an in-memory database. It uses Chrome installed by `bunx playwright install chrome`. Failed runs retain traces, screenshots and video. CI installs the browsers for both pinned Playwright versions, uploads the browser evidence even when a check fails, and runs Solidity tests in a separate Foundry job. `bun run test:contracts` runs that suite locally. `bun run test:demo` shows the browser journey in a visible Chrome window.

## Bundle budgets

`bun run check:bundle` checks the generated Vite manifest after a build. Each HTML entry has a ceiling of **200 KiB gzip for initial JavaScript and CSS**, and **180 KiB gzip for all deferred JavaScript and CSS not already loaded by that entry**. The gate's independent render page does not add to the main page's initial download. Each file is compressed separately with `gzip -9 -n`; source maps are excluded because browsers do not load them as application code. Static imports are followed transitively, shared files are counted once per group, and imports from a deferred renderer back to the initial entry do not count twice.

These are regression budgets selected for this implementation; the design brief did not prescribe byte limits. The first measured JavaScript build was approximately 155 KB initial and 133 KB deferred in Vite's decimal-unit report, leaving room for the completed interaction and accessibility work. The fixed ceilings provide that tolerance explicitly. CI does not silently raise a limit when code grows. An intentional increase should explain its user benefit and include a fresh measured result in the review.

## Renderer bench

`bun run bench --scenario all` runs five sixty-second workloads in Chrome, using a frozen production build of contract schemas, the production district coalescer and the real Three.js renderer. Use `--scenario 1k`, `50k`, `agents`, `launch-storm` or `cascade` to select one, `--headed` to watch, and `--output <directory>` to preserve separate runs. A failed target makes the command exit unsuccessfully after saving the reports. `--baseline <latest.json>` also checks relative regressions; use evidence from the same machine, viewport and browser settings for meaningful comparisons.

| Scenario | Input workload |
| --- | --- |
| `1k` | 1,000 synthetic markets, a validated 800/180/20 stall/works/tower distribution, 2,000 figures, 4,000 readings/second |
| `50k` | 50,000 synthetic markets with 40,000 stalls, 9,000 works and 1,000 towers, 4,000 readings/second |
| `agents` | 10,000 instanced figures among 1,000 markets, 4,000 readings/second |
| `launch-storm` | 500 synthetic markets added across sixty seconds, up to 2,000 readings/second |
| `cascade` | 1,000 synthetic markets with repeated falling-price stress, shaped by recorded pool magnitudes, 4,000 readings/second |

The captured Base day supplies real pool price and reserve magnitudes. Scaling, synthetic IDs, imposed arrivals and synthetic timing are labelled `source: synthetic`. Production entry points cannot import these fixtures, and the live renderer rejects them. The `cascade` workload is **not a verified liquidation replay**: the included recording contains pool observations, not liquidation events. The fifty-thousand-market workload does not prove ten independently streamed islands, and static instanced figures do not prove route animation. These distinctions remain in the report rather than being filled with fabricated evidence.

Each run saves a JSON result, screenshot, browser trace and video under `testing/bench/reports`, plus `latest.json` and a Markdown table. Video and tracing remain enabled for every scenario; their cost is part of the measured setup. Reports include:

- Browser frame cadence at p50, p95 and p99, and the timestamp and duration of every frame over 16.7 ms.
- Actual renderer submission count and CPU duration, separate from browser animation callbacks, plus peak draw calls, triangles and WebGL geometry/texture counts.
- Canonical tier counts and the works/tower instruments actually visited by the camera. Overview silhouettes retain their tier identity; only camera visibility and zoom control detail. Every persistent slot reserves room for promotion without moving its address.
- The first presentation opportunity after an atlas frame containing markets. This is the bench's explicit first-meaningful-paint definition.
- Reading receipt to actual renderer submission, and to the following browser presentation opportunity. The latter is a browser-side proxy for read-to-pixel latency; compositor completion and physical display pixels are not observed.
- Submitted/coalesced reading counts, applied batches, superseded batches and completed launches. Every applied batch carries its revision and receipt, submission and presentation timestamps. Falling behind incoming updates or losing an acknowledgment fails the workload check even if browser cadence looks smooth.
- Chrome's JS heap observation when available. WebGL does not expose GPU allocation bytes, so that field is unavailable; geometry and texture counts are reported separately.

The fixed desktop checks are p95 **≤18.5 ms**, p99 **≤33.4 ms**, meaningful atlas paint **≤2 seconds**, reading presentation p95 **≤250 ms**, all 240 scheduled updates over sixty seconds, the complete launch count, the requested tier counts, visits to every zoom level and full works/tower instruments, and no browser/WebGL errors. A supplied baseline additionally rejects a degradation beyond **20% plus 1 ms** in frame p95/p99, atlas paint or reading presentation p95. Thresholds live in `testing/bench/result.ts`; a failing measurement never adjusts them automatically.

CI retains successful default-branch results as the next baseline, publishes the comparison table in the job summary and uploads all benchmark evidence. The first run has absolute thresholds and no relative baseline. There is no connected public preview stage or phone farm in this local delivery. Desktop results do not establish the archive's mid-range-phone 60 fps target, physical display latency or end-to-end network-stream performance.

## Local delivery verification — 12 October 2026

The completed local build passed formatting, the full native Effect/TypeScript check, strict lint, **153 tests across 42 files**, and the production build. The separate Solidity suite passed all **6 tests**, including **256 allocation-lock fuzz cases**. All **3 headed Chrome journeys** passed: the owner workflow, incompatible-design rejection, and the phone-sized layout. The owner journey also verifies a source-rendered plate, market share metadata and its actual preview image, and the read-only embed.

The browser evidence is saved beside the journeys: [atlas](../../testing/e2e/atlas-proof.png), [public market preview](../../testing/e2e/market-preview-proof.png), and [phone-sized layout](../../testing/e2e/phone-proof.png). The narrow layout is a desktop browser viewport, not a physical-phone performance measurement.

| Production entry | Initial JS + CSS, gzip | Deferred JS + CSS, gzip | Result |
| --- | ---: | ---: | --- |
| Main atlas | 182.01 KiB | 138.33 KiB | Pass |
| Design review | 180.73 KiB | 36.88 KiB | Pass |
| Retained plate renderer | 70.23 KiB | 142.32 KiB | Pass |

All five final sixty-second workloads passed in headless Chrome 155 at 1440 × 900, pixel ratio 1. Every scenario acknowledged all 240 scheduled batches, for **1,200 total**, and reported no browser or WebGL errors. The launch workload completed all 500 arrivals. No source changes were made between the full application verification and these benchmark measurements.

| Synthetic workload | Frame p95 / p99 | Atlas paint | Reading presentation p95 | Result |
| --- | ---: | ---: | ---: | --- |
| 1,000 markets | 16.7 / 16.8 ms | 213.5 ms | 35.1 ms | Pass |
| 50,000 markets | 16.8 / 16.8 ms | 670.2 ms | 49.1 ms | Pass |
| 10,000 figures | 16.7 / 16.8 ms | 206.1 ms | 35.2 ms | Pass |
| 500 launches | 16.7 / 16.8 ms | 874.3 ms | 35.2 ms | Pass |
| Falling-price stress | 16.7 / 16.8 ms | 191.5 ms | 35.0 ms | Pass |

These percentile results do not mean every frame met the target: the 50,000-market run's slowest frame was 150.1 ms. The [full result](../../testing/bench/reports/latest.json) retains every slow frame, latency acknowledgment, tier count and stated measurement limit; the [benchmark summary](../../testing/bench/reports/summary.md) provides the comparison table. Current per-scenario JSON and screenshots accompany the source archive. Browser traces and videos remain in the local report directory.

External inference, Browserbase, remote scoped-account authorization and public hosting were deliberately left for the owner to connect. Their configured adapters and local integration boundaries are tested; this delivery does not claim those external services were exercised. The included GitHub workflow has been prepared but has not run on a hosted runner in this local workspace.
