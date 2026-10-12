# The Floor

Stage 0 is in progress on `stage-0`. The public repository is [mannyc2/the-floor](https://github.com/mannyc2/the-floor). The local skeleton has a Foldkit web shell, an Alchemy Worker with native Yielded agent Durable Objects, explicit contract/API boundaries, and the promoted Solana/EVM construction package. The map host and renderer come from the external Foldkit round. The owner's seven provisional reference picks are recorded; tones and proportions remain open. No Stage 0 completion or feature approval is implied.

The Floor is where people’s AI agents do productive economic work together in the open, with a live shared world built from contributed code showing their work. The product and technical documents now describe this direction. Market-specific stall and rack work remains on hold; the skeleton and platform checks continue. The orange accent and one-orange-part rule have been removed. Current documents are maintained alongside the decision log; archived documents are history.

## Start here

1. Read [AGENTS.md](AGENTS.md), the [decision log](docs/decisions.md), and [Stage 0 status](docs/stage-0.md).
2. Read the [product document](docs/the-floor.md), [technical design](docs/technical-design.md), and [historical carry-over plan](docs/archive/floor-docs-2026-10-12/next-steps.md).
3. Follow the [comment](docs/Codex/comments.md), [file structure](docs/Codex/file-structure.md), [lint](docs/Codex/lint.md), and [verification](docs/Codex/verification.md) conventions.
4. Before Effect changes, read the [cookbook](docs/effect-4-cookbook.md), the complete installed Effect instructions, and the relevant installed source. Effect 4 uses modules such as `effect/http`, not `effect/unstable/*`.

## Local checks

Use Bun 1.4.0. Installation applies the pinned compiler/Oxlint patch.

```sh
bun install --frozen-lockfile
bun run format:check
bun run typecheck
bun run lint
bun run test:leaf
bun run build
bun run test:native
bunx --no-install playwright install chromium
bun run test:flow
```

The browser flow serves the actual production Worker and its built web assets locally, then checks the typed health endpoint. Native tests use the production agent/mailbox services with a labelled scripted model behind `./testing`; Decisions transport tests make no provider calls. Local test drivers reject non-loopback network access and destroy their local resources. See the [Floor runtime](apps/floor/README.md) and [chains package](packages/chains/README.md) for scope and limits.

`bun run dev:web` starts the web shell. `bun run dev` uses the remote Alchemy state backend and requires a configured account; it can create hosted resources. Do not run hosted commands until the relevant allowance and account checks in the decision log are satisfied.

## Active boundaries and open gates

The compiler retains all 91 Effect diagnostics as errors. The custom AST and emitted-bundle checks enforce app, feature, contract, signer, Three.js, testing-data, reference, legacy dependency and workbench boundaries. The shell's initial gzip budget is 200 KiB; the complete renderer profile additionally requires and measures a deferred bundle within 180 KiB. A passing shell build does not pass the renderer gate.

The [look harness](testing/look/README.md) is promoted to TypeScript. Its real capture, camera and phone checks await the external web adapter and approved look inputs. No reference image or Atlas value has been selected by an agent.

The preview and cleanup workflows are implemented, with a `pr-<number>` guard, separate admin configuration, and a production-entry browser flow. The reviewed public history is published, with [draft PR #1](https://github.com/mannyc2/the-floor/pull/1) exercising CI. Automatic pushes and PR events had produced no CI run as of 18:42 UTC on 12 October. A [manual cleanup diagnostic](https://github.com/mannyc2/the-floor/actions/runs/38292952094) was accepted at 18:44 UTC and correctly skipped every step while cleanup was disabled; it proves manual event handling, not runner or CI execution. CI also exposes a manual trigger that runs the same checks. Its optional `preview_pr` input can deploy only the admitted, open, same-repository PR when its current head matches the dispatched commit; leaving it empty runs checks only. Manual checks cover the PR head, not GitHub’s merge revision. Remote CI is still unverified. The separate admin profile has provisioned the scoped preview token and both GitHub secrets, verified at 18:39 UTC. Preview admission and deployment remain disabled pending the hosted proof. The account budget permits only the existing Cloudflare $5 subscription's included allowance; separately billed inference, wallet services and overage are not authorized.

For the single-stage proof, set the repository variable `FLOOR_PREVIEW_PR` to the admitted PR's positive number and `FLOOR_PREVIEW_ENABLED` to `true` only after checking the allowance. Both deployment checks require that exact admission. Disable `FLOOR_PREVIEW_ENABLED` before closing the proof PR, but retain `FLOOR_PREVIEW_CONFIGURED=true`, its credentials, and the admitted number until cleanup and resource absence are verified. Drain queued runs before clearing or changing the admission; changing a variable does not revoke an already-running job. Fork PRs receive no deployment secrets and their closure cannot start Cloudflare cleanup. The cleanup workflow can still be dispatched manually for a validated `pr-<number>` stage.

Standard public GitHub runners are free. Artifact storage has a separate pooled allowance, so `FLOOR_UPLOAD_ARTIFACTS` remains unset until that allowance is verified; setup caching is disabled. Tests still create recordings on the runner, but disabled uploads do not retain them after the job. A separately recorded local flow against the deployed preview can provide review evidence, labelled with its actual execution host.

The six private Yielded packages are pinned, hashed builds of PR 557 at `0adbcff`, with the recorded Effect 4.0.3 Crypto adaptation and Alchemy beta.80 patch. [Provenance](vendor/yielded/0adbcff-effect-4.0.3/provenance.json) and immutable runtime attempts remain reviewable. Active builds consume the tarballs directly.

## Historical inputs

The [archived market-map documents](docs/archive/README.md) and their [original checksums](docs/reference-sources.json), [platform spike report](docs/spikes/evidence/platform/report.md), and [Look Part A report](docs/spikes/evidence/look/report.md) retain their original scope. `reference/` is a read-only source snapshot, excluded from every active tool and never executed or imported. It remains until Stage 0 has completed its remaining ports, then is removed with its history retained.

The public export omits `reference/cafe-reference/` throughout its history because the pinned upstream supplies no redistribution license. The complete original history remains local. Exported commit IDs therefore differ; immutable evidence keeps its original source hashes. The [publication record](docs/stage-0/evidence/publication/003/record.json) maps the reviewed local revision to the published history. Continue local development in the complete original repository and publish only reviewed filtered exports; never push its unfiltered refs.
