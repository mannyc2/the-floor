# The Floor

Use Bun, never npm, yarn or pnpm. No explicit or implicit `any`, type casts or non-null assertions. No assistant attribution in commits.

## Read first

- `README.md` and `docs/decisions.md` for the current scope and unresolved choices.
- `docs/Codex/comments.md` before non-trivial code.
- `docs/Codex/file-structure.md` before creating files or components.
- `docs/Codex/lint.md` and `docs/Codex/verification.md` before configuring checks or adding tests.
- `effect-4-cookbook.md`, then the complete installed `node_modules/effect/AGENTS.md` and its relevant documentation before Effect changes. Verify every API in installed source; the cookbook is version-specific.
- The relevant revised product, technical design and Atlas documents under `docs/floor-docs-2026-10-12/`. Where they conflict with `docs/decisions.md`, the decision log wins.
- `reference/README.md` before reading the first build or the cafe reference.
- Before Cloudflare work, the relevant page from [Alchemy's docs index](https://alchemy.run/llms.txt). Cloudflare resources are Alchemy resources: no hand-written Wrangler config.

## Structure and honesty

Deployable applications live in `apps/`. Shared code belongs in real workspace packages with explicit exports; create a package only when two apps use it or a fence needs its boundary. A reserved directory is not an implemented package. Use feature-local `_components/` and `_lib/` folders, relative imports inside a feature and package imports for global code. Never import across features or between apps.

`contract` contains Schemas and imports only Effect and its own modules. `api` defines HTTP/RPC from those Schemas and is the sole planned exception for internal unstable API exports. `map` is the pure map model; `atlas` is the design system. Three.js belongs only in `apps/web`. Signer code and its bundle must contain no models, inference providers or Floor application code.

`reference/` holds read-only snapshots of the first build and the cafe reference. Never edit, import, build, run, lint or format it, never read it from code, and never treat it as evidence for this workspace. Port by copying into the new home and adapting.

Keep test Layers behind `./testing` exports. Production cannot import or read testing data, including copied fixtures. Recordings remain labelled replay data. Never represent absent evidence as zero or a fake result as a measured one.

Use tagged Schema errors with structured fields and preserved foreign causes. Use `Option` and `DateTime` past boundaries. Each external SDK has one service edge. Scheduled work owns its alarm. Mount imperative resources through scoped services.

## Acceptance

No Stage 0 completion claim until both spike decisions are recorded and every item in `docs/stage-0.md` is evidenced. No feature work before the Stage 0 checks and stage review. Art approval is the owner's recorded pick between shortlisted options. An agent never approves its own output, and the other agent's review is a filter, not an approval. Spike evidence goes in `docs/spikes/evidence/`, scratch in `work/`. Record deviations before merging.

Once implementation starts, `bun run typecheck`, `bun run lint` and `bun run build` must pass, alongside the relevant formatting, test, flow, look and deployment checks in `docs/Codex/verification.md`. Do not weaken checks or substitute placeholders to manufacture a pass.
