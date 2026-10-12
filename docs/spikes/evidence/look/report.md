# Look Part A complete: owner picked B on WebGL

**The owner picked B, the surface-ID-and-depth pass, on WebGL on 12 October 2026.** A, the normal-and-depth pass, remains the fallback. Both repeat exactly in the required SwiftShader matrix, meet the sampled one-CSS-pixel stroke requirement at all three rungs and DPRs, and remain within the local phone-profile CPU budget. B retains more of the CPU reference's edges at similar cost. C loses parts of thin silhouettes to depth testing and fails eight of eighteen stroke samples per backend, so it is not offered as an option.

**Part A is complete. Technical recommendation: proceed with the owner-picked B/WebGL technique into Part B; hold Stage 0 pending the remaining gates.** The owner saw no visible difference between A and B and chose “whatever’s optimal”; the measured comparison determined B. The pick is recorded in the [decision log](../../../decisions.md) by commit `14501e7`.

The owner has started Part B in the [current handoff](../../look.md). **This branch’s work executed Part A only; it did not execute Part B or Stage 0.** Tones, proportions, kit unit, reference frames and assets remain unpicked. Part A’s stand-in scene is test geometry, not an approved look. No hosted run, deployment, provider spend or push occurred.

## What to review

[Open the comparison sheet](technique-comparison/003/contact-sheet.png): A, B, C and the current CPU edge target on the same district, works, machine and night frames. C is shown to explain its rejection. The full-size A/B frames and the [comparison record](technique-comparison/003/record.json) are committed. The root agent independently reviewed this sheet as legible and suitable for technical comparison. That technical review preceded the owner’s recorded technique pick; it did not approve the stand-in scene’s appearance.

The scene is newly authored code: twelve instanced stalls in three variants, the rack and its trays/float/gauge, two figures from an SVG radial profile, paving, quay and labels. Every mesh carries semantic surface IDs, palette slots and a provisional kit unit. Only original Atlas token data was copied from the first-build archive. No reference renderer or asset code was imported or executed. Labels are hidden in scored captures so the line metrics measure geometry.

## Accuracy and repetition

The current target is [three-edge-projection attempt 003](edge-projection/003/record.json), using the identical exported vertices and orthographic camera. [Independent primitive checks](primitive-silhouettes/002/record.json) compare its box, cylinder and tray exteriors with convex hulls computed directly from projected vertices. All nine checks pass; maximum boundary distance is 0.000012409 CSS pixels. This validates the convex exterior silhouettes, not every internal, hidden or intersection edge.

| Backend / technique | Mean exact edge F1 | Mean F1 within 1 CSS px | Stroke samples passing | False cylinder crossings / 100 CSS px |
| --- | ---: | ---: | ---: | ---: |
| WebGL A | 0.816881 | 0.989325 | 18/18 | 0 |
| **WebGL B** | **0.832197** | **0.999918** | **18/18** | **0** |
| WebGL C | 0.948520 | 0.999460 | 10/18 | 0 |
| Native WebGPU A | 0.831117 | 0.989305 | 18/18 | 0 |
| Native WebGPU B | 0.854236 | 0.999939 | 18/18 | 0 |
| Native WebGPU C | 0.951665 | 0.999428 | 10/18 | 0 |

[WebGL 009](technique-matrix/009/record.json) records all 54 cells, each with twenty independent renderer initializations through page navigation in one browser process: **1,080 captures, zero changed pixels and zero channel difference**. The asserted renderer is SwiftShader in bundled Chromium 156.0.8078.4. These are not twenty separate browser-process launches. There were no recorded browser errors. Every final first frame and mask also matches calibration 007 byte-for-byte.

[Native WebGPU 010](technique-matrix/010/record.json) records a further 54 × 20 captures with zero differences on Apple Metal in system Chrome 155.0.8059.39. This is additional hardware evidence, not a replacement for the required SwiftShader gate. All 54 software-WebGPU cells in [attempt 004](technique-matrix/004/record.json) failed initialization or timed out. A [minimal raw WebGPU clear](webgpu-substrate/002/record.json) reproduces invalid textures/command buffers before candidate shaders run, while native Metal succeeds. **WebGPU is not shortlisted for the required baseline.**

Native C/night also emitted 180 Three console errors, one per initialization, reporting a framebuffer format mismatch (`rgba16float` versus `bgra8unorm`). Its stable captures do not establish error-free support. B's native cells recorded no errors. One favicon 404 appeared at startup in native A and the phone run; an explicit empty favicon fixes the final demo, while the original logs remain intact.

The stroke target is 1 CSS pixel ± 0.25. A and B measured exactly 1 at the clean cylinder profile in every cell. C measured zero at the district DPR 1 profile and 2/3 pixel at every DPR 3 rung, for both themes. [Depth diagnostics](conditional-line-occlusion/001/record.json) show the expanded ribbon is partly occluded by its own surface. Disabling depth testing or applying broad bias restores width but leaks hidden lines, so those changes were rejected. C also builds world-space line buffers for the fixed camera; camera-motion regeneration was not benchmarked.

Pixel F1 depends on rasterizer phase and width; no unsupported numerical acceptance cutoff was invented. The tolerant score uses many-to-many pixel matching within a one-CSS-pixel disk and is not a topology test. Cylinder density excludes target lines in a narrow interior region. One clean silhouette sample does not prove every orientation or join. These limits explain why C's higher exact F1 does not outweigh its measured width failures.

## Cost and distant detail

[Phone profile 003](phone-profile/003/record.json) runs 120 frames after ten warmup draws at 390 × 844, DPR 3 and four-times CPU throttling on a local Apple M1 Pro with 16 GiB. The 1,000-stall camera frames every stall. These are renderer submission times; the 16.7 ms proxy follows the technical design's 60 fps target. All twelve CPU cases pass. **A real mid-range phone was not run.**

| Backend / technique | CPU p95, 12 / 1,000 stalls (ms) | GPU p95, 12 / 1,000 stalls (ms) | Draw calls, 1,000 stalls |
| --- | ---: | ---: | ---: |
| WebGL A | 1.9 / 1.8 | 3.03 / 4.21 | 17 |
| **WebGL B** | **1.6 / 1.5** | **3.08 / 4.13** | **17** |
| WebGL C | 2.0 / 1.2 | 1.12 / 4.45 | 9 |
| Native WebGPU A | 2.4 / 3.0 | 5.70 / 8.26 | 18 |
| Native WebGPU B | 2.1 / 2.6 | 8.85 / 8.13 | 18 |
| Native WebGPU C | 2.0 / 1.6 | 3.54 / 9.44 | 10 |

WebGL GPU numbers come from non-disjoint timer queries; completion uses an explicit GPU fence and includes synchronization/polling. Native WebGPU timestamps are the sum returned by Three's pass-query machinery. Some exceed separately measured queue-completion latency, so they are retained as uncalibrated diagnostics and **do not support a cross-backend GPU-speed ranking**. Desktop CPU throttling does not emulate a phone GPU, thermal behavior, production simulation or interaction.

At this profile, A and B allocate 47,399,040 bytes (about 45.2 MiB) for two RGBA8-plus-depth render targets. C has no such targets but allocates 3,533,952 bytes of line-position data at 1,000 stalls, versus 87,792 bytes at twelve. These counts exclude framebuffer, driver and other resource overhead.

[Impostor attempt 003](impostors/003/record.json) bakes an isolated rack at 256 pixels and reduces it to 64 with exact area averaging. Only 31–50% of original edge locations retain half darkness; B/WebGL's baked threshold coverage is 15.7% of a direct 64-pixel render. Thin lines do not reliably survive this reduction. A dedicated distant LOD or final-size outline remains necessary. This static experiment does not validate animated gate impostors.

## The two code routes

The [independent SVG stall route](svg-stall/002/record.json) and the Three generator produce exactly matching vertex sets, triangle counts (192 / 132 / 204), palette slots and semantic boundary edges. Each corresponding native 64-pixel color image is byte-identical; edge-mask IoU is 1. Attributes and kit unit survive geometry export/reload. The SVG construction does not import the Three generator; that import appears only in separate comparison code. The [paired sheet](svg-stall/002/comparison.png) passed independent technical review.

The observed SVG authoring and validation task took **12 minutes 39 seconds**, including shared profile/parser work, all three variants, the figure helper and validation. Per-variant labor was not instrumented. The original Three authoring effort was not instrumented either, so a defensible per-asset time comparison or speed winner is unavailable. Construction milliseconds are reported separately as runtime observations. Neither route has been judged against Part B reference frames yet.

Switching the figures' input representation to an SVG path left the complete shared scene/camera JSON byte-identical (SHA-256 `205b02ecb29c717cbd3fb5bf7a9289565e7c47dafa650c1e85d2fee67f27b638`). Final render evidence therefore still describes the current geometry.

## Verification, promotion and remaining gates

[Runtime verification](runtime-prerequisite/002/record.json) records successful scoped typecheck, lint, build and the final headed control interaction, plus source fingerprints and cleanup. The spike bundle includes both backends and emits Vite's large-chunk warning; it is not a production bundle-budget result. All experiment servers and driver browsers were closed. This does not establish the Stage 0 Effect diagnostics, production build or deployed acceptance flow.

Initial setup was delayed by a full disk before rendering could run; it resumed after disk space was restored. Executed calibration, interrupted runs and superseded Blender experiments remain historical evidence from the earlier handoff. They are excluded from current acceptance; Blender is not an MVP dependency. Historical source fingerprints resolve through the preserved experiment commit identified in the runtime provenance audit. Pre-execution blocked records were removed under the revised evidence policy.

The measured limitations remain: distant sprite line survival, untested real-phone behavior, C width/native-night defects, software-WebGPU startup failure, and unavailable comparable per-asset authoring time. Tone sets, proportions, kit unit, reference picks and newcomer testing belong to Part B. The technique pick does not settle those choices or establish Stage 0 readiness.

The [Stage 0 promotion plan](../../../stage-0.md), recorded in commit `d583f33`, carries the existing B renderer, mesh attribution, SVG route and look harness into their permanent homes with the specified readability, token and TypeScript-driver work. A, C, WebGPU and the historical Blender experiments remain evidence. This reconciliation changes documentation only; it preserves every source file and recorded measurement and performs none of that promotion work.
