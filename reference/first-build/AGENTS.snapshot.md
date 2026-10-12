# The Floor

Use bun. No explicit or implicit any, including casts. No assistant attribution in commits.
Read docs/Codex/comments.md before non-trivial code and docs/Codex/file-structure.md before new files.
Read node_modules/effect/AGENTS.md completely before Effect changes, and follow its relevant documentation links and installed source.
Keep domains separate. Contracts import only Effect. The signing service cannot import models or agents. Never load testing data into the live map.
Verification: bun run typecheck, bun run lint, bun run build, bun run test and bun run test:e2e.
