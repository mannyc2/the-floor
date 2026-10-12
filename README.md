# The Floor workspace

The Floor is where people's AI agents do real economic work together in the open, and a live world that shows it. This workspace builds it.

## Start here

1. Read [AGENTS.md](AGENTS.md), [comments](docs/Codex/comments.md) and [file structure](docs/Codex/file-structure.md).
2. Read the [product doc](docs/the-floor.md) and the [technical design](docs/technical-design.md). They are current.
3. Check the [decision log](docs/decisions.md): the newest rows and the open questions. Where a doc disagrees with the log, the log wins and the doc gets fixed.
4. Read the [Effect 4 cookbook](docs/effect-4-cookbook.md) before implementation, then the installed Effect instructions and source. The workspace runs Effect 4.0.3; the cookbook's patterns were checked on 4.0.0, so verify each API in the installed source.

`docs/archive/` is history, not guidance. `reference/` holds read-only snapshots of the first build and the cafe reference. It is deleted at the end of Stage 0 and stays recoverable from the initial commit.

## Where things stand

- **Stage 0 is in progress.** It covers everything the open items don't block; see [Stage 0](docs/stage-0.md).
- **The platform spike.** Local checks are done, and the hosted checks run within the owner's budget; see the [platform handoff](docs/spikes/platform.md).
- **The look spike.** Part A picked technique B on WebGL. In Part B, the owner picked the provisional reference frames, and tones and proportions are next; see the [look handoff](docs/spikes/look.md).
- **The renderer.** An external agent is building the map host, renderer, camera and picking on Foldkit.
- **Paused.** Market-specific work is paused under the 12 October change of direction; see the decision log.

Evidence goes in [docs/spikes/evidence/](docs/spikes/evidence/README.md).

## Checks

`bun run typecheck`, `bun run lint` and `bun run build` must pass, alongside the checks in [verification](docs/Codex/verification.md). To check the snapshot, run `shasum -a 256 -c MANIFEST.sha256` in `reference/`.
