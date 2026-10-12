# Look Part A experiment

This local rendering experiment uses synthetic geometry. It does not initialize Stage 0, choose an art direction, or approve tokens or proportions. The report and attempt records live in `docs/spikes/evidence/look/`.

Use Bun from this worktree. `bun install`, `bun run typecheck`, `bun run lint`, `bun run build`, and `bun run test:look` operate only on the spike. `bun run dev` serves the controls at `http://127.0.0.1:5181`.

The page accepts `technique=A|B|C`, `backend=webgl|webgpu`, `theme=day|night`, `rung=district|works|machine`, `dpr=1|2|3`, `width`, `height`, and `stalls`. The stress case frames all 1,000 stalls. `asset=rack` isolates the rack for the static sprite experiment. `window.look` exposes readiness, line masks, shared scene export and measured rendering calls for the local drivers.

## Reproduce the measurements

Build into a fresh output folder and keep it immutable while a matrix runs:

```sh
LOOK_BUILD_OUT='../../../../work/spikes/look/build' bun run build
LOOK_BUILD=work/spikes/look/build LOOK_PORT=5182 bun apps/web/spikes/look-a/serve-static.ts
```

In another terminal, select a new attempt number instead of overwriting an old run:

```sh
LOOK_URL=http://127.0.0.1:5182 LOOK_ATTEMPT=NEW bun apps/web/spikes/look-a/matrix.ts
LOOK_URL=http://127.0.0.1:5182 LOOK_ATTEMPT=NEW-GPU LOOK_BACKEND=webgpu bun apps/web/spikes/look-a/matrix.ts
LOOK_URL=http://127.0.0.1:5182 LOOK_ATTEMPT=NEW-NATIVE LOOK_BACKEND=webgpu LOOK_GPU_MODE=chrome bun apps/web/spikes/look-a/matrix.ts
```

The first two commands assert SwiftShader; the third asserts Apple hardware in system Chrome. Each cell creates 20 independent renderer instances through navigation in one browser process. It is not a 20-process-launch test. Captures hide atlas DOM labels so line scoring measures mesh outlines. Every failed cell remains in `results.json`.

```sh
bun apps/web/spikes/look-a/export-scene.ts
bun apps/web/spikes/look-a/project-edges.ts
LOOK_URL=http://127.0.0.1:5182 LOOK_ATTEMPT=NEW bun apps/web/spikes/look-a/performance.ts
LOOK_URL=http://127.0.0.1:5182 LOOK_ATTEMPT=NEW bun apps/web/spikes/look-a/impostors.ts
bun run test:look --headed
```

The performance and impostor commands accept `LOOK_ATTEMPT`; always use a new identifier to retain earlier results. Run performance with other renderer jobs stopped. It uses 390×844, DPR 3 and four-times CPU throttling on local Apple hardware; that is not a real phone. GPU time comes only from actual timer queries. End-to-end completion includes synchronization and is reported separately from renderer CPU submission time.

`metrics.py` uses NumPy and Pillow to score a capture folder against both targets. Its `--captures`, `--targets`, `--projection`, `--scene` and `--out` arguments make the input paths explicit; the scene checksum must match the Blender report. Use the configured bundled Python runtime when system Python lacks these libraries.

The Blender evidence's `commands.txt` contains the exact official binary path and Python commands. Its record explains the classifier-only epsilon needed for this Blender version's exact-angle silhouette degeneracy, and retains the uncorrected renders. The raster camera is unchanged. The separate stall script constructs geometry independently; it does not import the shared scene triangles.

## Scope and measurement limits

The palette JSON is original Atlas token data copied from the archived source; no first-build renderer or asset code is imported. The scene, semantic surface IDs, generators and render pipelines are newly authored. Orthographic matrices and mesh vertices are exported to the target tools.

A uses smooth normals plus depth; B uses semantic surface IDs plus depth; C uses hard edges and camera-dependent silhouette classification. C merges line segments in world coordinates for this fixed-camera experiment, while surfaces are instanced. Camera changes would require recomputing C's silhouette buffer; it is not a validated dynamic production line shader. The native WebGPU path uses Three's separate node-based line material.

Render-target bytes count the two RGBA8-plus-depth targets, excluding the screen, driver overhead and other resources. C allocates no render-target storage, but its merged line buffer grows with scene size. Static sprite measurements area-average a 256-pixel isolated rack to 64 pixels without adding an outline after sampling; they do not validate the future gate's animated impostors.

All derived files, raw matrices, traces and builds remain under ignored `work/spikes/look/`; committed evidence identifies their sizes, hashes and regeneration commands. The required final headful interaction demo closes its browser; stop the local servers after use.
