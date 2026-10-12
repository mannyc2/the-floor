# The Floor workspace

Prepared on 12 October 2026 for the look and platform spikes. This is a fresh local preparation workspace. Read-only snapshots of the first build and the cafe reference are in [reference/](reference/README.md). Neither spike nor Stage 0 has run.

## Start here

1. Read [AGENTS.md](AGENTS.md), [comments](docs/Codex/comments.md), and [file structure](docs/Codex/file-structure.md).
2. Read the [retrospective](docs/floor-docs-2026-10-12/retrospective.md), [next steps](docs/floor-docs-2026-10-12/next-steps.md), and [technical design](docs/floor-docs-2026-10-12/technical-design.md). The [product document](docs/floor-docs-2026-10-12/the-floor.md) defines the intended experience.
3. Check the [active decision log](docs/decisions.md), then use the [platform handoff](docs/spikes/platform.md) and [look handoff](docs/spikes/look.md) as independent work briefs.
4. Read the [Effect 4 cookbook](effect-4-cookbook.md) before implementation, followed by the installed Effect instructions and source when dependencies are installed.

## Prepared

- Eight revised source documents copied unchanged, with their original paths and checksums in [reference-sources.json](docs/reference-sources.json).
- Working conventions updated for `apps/web`, `apps/floor`, `apps/signer` and shared packages.
- Reserved directories for the intended layout, assets and testing evidence. These are empty locations, not implemented workspace packages.
- Separate spike handoffs, pending decisions and a [Stage 0 readiness checklist](docs/stage-0.md).
- Read-only snapshots of the first build and the cafe reference in [reference/](reference/README.md), with provenance, exclusions and a SHA-256 manifest, so every source reference resolves inside the repository.
- A committed [evidence location](docs/spikes/evidence/README.md) and record template for both spikes.
- Exact prior toolchain pins and the compiler patch command retained as reference data.

The cookbook at the repository root links to the copied source, so there is one local copy. Paths inside that cookbook refer to the **first build**, snapshotted at `reference/first-build/`. Frozen documents can contain historical wording; current working guidance and the explicit corrections in `next-steps.md` take precedence over superseded implementation details. In particular, Effect 4 has no `effect/unstable/*` paths.

## Next work

The [platform spike](docs/spikes/platform.md) is running, local checks only for now. [Look spike](docs/spikes/look.md) Part A is done (technique B on WebGL, picked by the owner); Part B (references, tones, proportions, assets) is next, with Codex generating the reference images and the owner picking. Evidence goes in [docs/spikes/evidence/](docs/spikes/evidence/README.md). Both spikes report before Stage 0 begins.

`reference/` is temporary. It is deleted at the end of Stage 0, once the skeleton has ported what it needs, and stays recoverable from the initial commit.

## Status

Documentation and reserved directories only: no dependencies, entry points or build configuration yet. `bun run typecheck`, `bun run lint` and `bun run build` become required when Stage 0 sets up the toolchain. To check the snapshot, run `shasum -a 256 -c MANIFEST.sha256` in `reference/`.
