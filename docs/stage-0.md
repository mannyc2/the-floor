# Stage 0 readiness

Status: **not started**. This checklist carries the revised design into the next work session without treating workspace preparation as a completed skeleton.

## Inputs from the spikes

- [ ] Platform report records exact dependency versions and workerd results for browser/agent alarms, wallets, launch construction, renderer plates, DO/D1 storage, Web Crypto and deploy/destroy.
- [ ] Browser adapter package, containment policy and live-view/takeover choice are settled; any runtime deviation is in the decision log.
- [ ] Anthropic support and the Decisions adapter have been checked against installed source before relying on model defaults.
- [ ] Look report records technique, tone values, kit unit, line specification and figure ratio, with the owner's recorded picks and the picked reference frames, under `docs/spikes/evidence/look/`.
- [ ] Image-generation access, provider access and the replacement implementation decision are settled for the work that needs them.

## Build the skeleton after those inputs exist

- [ ] Initialize only required workspace packages, with manifests and explicit exports; keep app-local code local.
- [ ] Adapt exact toolchain pins, the `prepare` patch, compiler diagnostics, Oxlint and dprint, with `reference/` excluded from every tool; produce and verify the new lockfile.
- [ ] Port and test import, app, signer, three.js, testing-data, Atlas and workbench fences; validate bundle contents as well as imports.
- [ ] Configure the narrow API-package exception and a reasoned suppression budget.
- [ ] Adapt the bundle-budget model and manifest walker, preserving structured failures.
- [ ] Implement `alchemy.run.ts` and CI deployment/cleanup using the cafe reference; prove both creation and teardown of an isolated stage.
- [ ] Run one production-entry flow against that stage, with an independent review of its assertions and stubs.
- [ ] Seed `packages/atlas` from the approved look result; generate stylesheet and palette from it.
- [ ] Add the real-renderer workbench and deterministic look harness; ensure the workbench cannot enter production bundles.
- [ ] Pass formatting, typecheck, lint, build and the stage's relevant tests without placeholder success commands.
- [ ] Delete `reference/` and its tool exclusions once everything Stage 0 ports from it is in place.
- [ ] Obtain owner review of the decisions, new flow and picked frames before starting Stage 1.

Use the file-by-file [carry-over list](floor-docs-2026-10-12/next-steps.md) and [source inventory](reference-sources.json). The old runtime, renderer, dashboard, custom launch/wallet protocols and bench reports stay behind. The old lint plugin and CI require adaptation; their presence in the reference build is not evidence that the new boundaries are enforced.
