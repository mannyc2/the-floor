# The Floor

Use Bun, never npm, yarn or pnpm. No explicit or implicit `any`, type casts or non-null assertions. No assistant attribution in commits.

Use Effect's own modules first. Add a third-party dependency only where Effect can't do the job, and record why in `docs/decisions.md`.

## Read first

- `README.md` for where things stand, and `docs/decisions.md` for the standing decisions and open items.
- `docs/the-floor.md` and `docs/technical-design.md`, the product doc and technical design. Where they conflict with `docs/decisions.md`, the decision log wins and the doc gets fixed.
- `docs/stage-0.md` for what the current stage still needs.
- `docs/Codex/comments.md` before non-trivial code, and `docs/Codex/file-structure.md` before creating files or components.
- `docs/Codex/lint.md` and `docs/Codex/verification.md` before configuring checks or adding tests.
- `docs/effect-4-cookbook.md`, then the complete installed `node_modules/effect/AGENTS.md` and its relevant documentation, before Effect changes. Verify every API in installed source; the cookbook is version-specific.
- `docs/platform.md`, and the relevant page from [Alchemy's docs index](https://alchemy.run/llms.txt), before Cloudflare work. Cloudflare resources are Alchemy resources: no hand-written Wrangler config.
- `docs/look.md` and `docs/atlas.md` before work on the look, the design system or assets.
- `docs/ideas.md` before proposing a feature, since it may already be there with its reasons, and `docs/research.md` before choosing a provider, chain or launchpad.

## Structure and honesty

Deployable applications live in `apps/`. Shared code belongs in real workspace packages with explicit exports; create a package only when two apps use it or a fence needs its boundary. Use feature-local `_components/` and `_lib/` folders, relative imports inside a feature and package imports for global code. Never import across features or between apps.

`contract` contains Schemas and imports only Effect and its own modules. `api` defines HTTP/RPC from those Schemas and is the sole internal exception for unstable API exports. `world` is the world model without three.js; `atlas` is the design system. Contributed pieces import only the world kit and run only in the piece sandbox. Three.js belongs only in `apps/web`. Signer code and its bundle must contain no models, inference providers or Floor application code.

Keep test Layers behind `./testing` exports. Production cannot import or read testing data, including copied fixtures. Recordings remain labelled replay data. Never represent absent evidence as zero or a fake result as a measured one.

Use tagged Schema errors with structured fields and preserved foreign causes. Use `Option` and `DateTime` past boundaries. Each external SDK has one service edge. Scheduled work owns its alarm. Mount imperative resources through scoped services.

## Acceptance

No Stage 0 completion claim until every item in `docs/stage-0.md` is done and verified. No feature work before the Stage 0 checks pass and the owner has reviewed the stage. Art approval is the owner's recorded pick between shortlisted options. An agent never approves its own output, and the other agent's review is a filter, not an approval.

Record each result in the doc or decision it supports, with the command or run link that shows it. Keep raw logs, captures and generated candidates in `work/`, which git ignores; commit only the owner's picked reference frames, under `testing/reference/`. Record deviations in `docs/decisions.md` before merging.

`bun run typecheck`, `bun run lint` and `bun run build` must pass, alongside the formatting, test, flow, look and deployment checks in `docs/Codex/verification.md`. Do not weaken checks or substitute placeholders to manufacture a pass. Hosted work stays within the spending limits in `docs/platform.md`.
