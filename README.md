# The Floor workspace

Prepared on 12 October 2026 for the look and platform spikes. This branch now contains the bounded local platform probes and their [result report](docs/spikes/evidence/platform/report.md). The owner limited the resumed run to local checks; hosted gates remain open. Read-only snapshots are in [reference/](reference/README.md). Stage 0 has not started.

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

Review the [platform result](docs/spikes/evidence/platform/report.md): local checks are complete, while hosted checks await renewed scope and a spend limit. [Look Part A](docs/spikes/look.md) is complete with the owner’s technique B/WebGL pick recorded; the decision log now starts Part B. This platform task did not execute Part B. Stage 0 remains gated on both complete spike results and promotes their tested code into the product.

`reference/` is temporary. It is deleted at the end of Stage 0, once the skeleton has ported what it needs, and stays recoverable from the initial commit.

## Status

The [local platform probes](apps/floor/spikes/platform/README.md) use Alchemy’s local test harness, a pinned native Yielded Alchemy adapter, and Kit-generated launch instructions. Raw Wrangler examples are retired from active source and retained in history. The result report distinguishes the current target from those historical measurements. This does not establish Stage 0's product packages, architecture fences or CI. To check the immutable snapshot, run `shasum -a 256 -c MANIFEST.sha256` in `reference/`.
