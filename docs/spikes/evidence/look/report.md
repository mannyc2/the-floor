# Look Part A: execution blocked by disk space

**Recommendation: HOLD.** Dependency installation failed with `ENOSPC` on a volume reporting 100% capacity. The first measurement showed 32 MiB available; limited cleanup of this task's newly created installation left 91 MiB at 13:00 UTC on 12 October 2026. Blender is not installed. No rendering or performance measurement ran, so there is no supported technique recommendation or shortlist for the owner.

This report covers **Part A only** on branch `spike/look-a`. No Part B image generation, art approval, Stage 0 implementation, publication, merge or push occurred.

## Evidence

- [Runtime prerequisite attempt 001](runtime-prerequisite/001/record.json), with [the actual setup errors](runtime-prerequisite/001/attempt-log.txt).
- [All 108 requested matrix cells](runtime-prerequisite/001/matrix-status.csv): 54 WebGL and 54 WebGPU cells, each explicitly `not_run`, with zero of twenty repetitions completed.
- [Blender Line Art prerequisite attempt 001](blender-line-art/001/record.json): Blender absent; initial folder creation failed; no binary download, render, `.blend` or `.glb` was produced.

| Requirement | Result |
| --- | --- |
| Three line techniques, two themes, three rungs, three DPRs | Not run on either backend |
| Twenty SwiftShader repetitions per cell | Not run |
| Blender Line Art target and three-edge-projection cross-check | Not run |
| Edge F-score, cylinder density and CSS stroke width | Not run |
| Phone profile CPU/GPU time, 1,000-stall draw calls and target memory | Not run |
| Impostor line survival | Not run |
| Real mid-range phone | Not run; no device supplied or used |
| Asset-route effort comparison | Not measured; preparation time is not asset-production evidence |
| Working example, headed demonstration, typecheck, lint and build | Not run; runtime installation did not complete |
| Owner's technique pick | Pending; no options presented |

## Source observations, not runtime results

The original Atlas tokens were read from the snapshot archive as data. No code in `reference/` was imported, built or executed. A fresh parametric scene and rendering experiment were drafted, but remain unvalidated local scratch under `work/spikes/look/prototype/`, with [paths and hashes recorded](runtime-prerequisite/001/prototype-manifest.json). They are not committed implementation or evidence of rendering behavior.

The existing Three.js source contains `LDrawConditionalLineNodeMaterial.js` for WebGPU, so the handoff's blanket statement that conditional lines are WebGL-only needs qualification. That source finding does not establish support for the required fixed CSS-width line pipeline; the actual selected package, backend and line width still require execution.

An initial registry request for `three-edge-projection@0.0.8` failed. Inspection of its upstream source found revision `3ac00e1d7bb87bf417ddbd93a5cc7c683a2d0567` and package version `0.0.10`; the subsequent installation attempt hit `ENOSPC`. No installed compatibility claim is made.

## Resume

1. Restore several GB of available disk space. No unrelated files have been deleted by this spike.
2. Restore the provisional source from ignored scratch to its intended spike-only location, resolve dependencies with Bun and validate the actual browser example. Read and adapt installed APIs before relying on them.
3. Produce exact shared geometry/camera data, then execute the Blender Line Art target and independent edge-projection cross-check. Build the stall independently by both required routes; loading shared triangle data into Blender alone is not a route comparison.
4. Run every matrix cell and twenty repetitions, collect phone-profile and backend measurements, and preserve failed attempts. Put the next result in attempt `002`; do not rewrite the failed prerequisite history.
5. Commit validated source, reproducible commands, records and measured comparisons on this branch. Present only techniques that satisfy the required gates, with the owner's pick still explicit.

Both spikes must report and the owner must make the required picks before Stage 0. This report does not waive any of those gates.
