# Stage 0 readiness

Status: **not started**. This checklist carries the revised design into the next work session without treating workspace preparation as a completed skeleton.

## Inputs from the spikes

- [ ] Platform report records exact dependency versions and workerd results for browser/agent alarms, wallets, launch construction, renderer plates, DO/D1 storage, Web Crypto and deploy/destroy.
- [ ] Browser adapter package, containment policy and live-view/takeover choice are settled; any runtime deviation is in the decision log.
- [ ] Anthropic support and the Decisions adapter have been checked against installed source before relying on model defaults.
- [ ] Look report records technique, tone values, kit unit, line specification and figure ratio, with the owner's recorded picks and the picked reference frames, under `docs/spikes/evidence/look/`.
- [ ] Image-generation access, provider access and the replacement implementation decision are settled for the work that needs them.

## Promote the spike code

Stage 0 starts by merging both spike branches and moving their code into its homes, not by starting fresh. Each piece keeps its tests and its evidence link.

| Spike code | Home | Before it moves |
| --- | --- | --- |
| Technique B's edge pass and the colour pass (`look-a/renderer.ts`) | `apps/web` renderer | B only: drop A, C and the WebGPU paths. Rewrite the minified GLSL and 500-character lines as formatted, commented code |
| Mesh attribution: `_SURFACE`, `_MAT`, kit unit (`look-a/scene.ts`) | Conventions and tokens in `packages/atlas`; the three.js helpers in `apps/web` | Same readability pass. Tokens come from Part B's picks, not the first build's |
| SVG profile route (`svg-profiles.ts`, `svg-stall.ts`) | `apps/web` asset kit | Formatting only |
| Part B's stall, rack and figure generators | `apps/web` asset kit | None, if Part B writes them to standard |
| Edge-projection target, primitive silhouettes, the SwiftShader matrix runner, phone profile, impostor check | `testing/look`, as the deterministic look harness | Port `metrics.py` to TypeScript |
| Contact-sheet builder | The workbench | None |
| Meteora client: bounded Codama codecs, `bigint` maths, launch construction (`kit/`) | `packages/chains`, Solana side | Take addresses and amounts as inputs instead of probe constants. Port `bounded-client.py` to a Bun script. The 940 SDK-oracle cases become dev-only tests |
| Doppler and `viem` construction (`kit/evm.ts`) | `packages/chains`, EVM side | None |
| Yielded agent Durable Object on Alchemy (`alchemy-agent/test/fixtures/entry.ts`) and its admission and restart tests | `apps/floor` | Swap the scripted model for the real Layers. Consume Yielded as a package (published, or the pinned build), which retires the clone-and-replay script |
| Alchemy beta.80 patch | Root `patches/`, through Bun's `patchedDependencies` | Drop it once upstream ships the fixes |

What stays behind as evidence only: the retired Wrangler and `effect-cf` probe (its storage findings stand), techniques A and C, the WebGPU paths, the Blender scripts and the Python drivers.

## Build the skeleton around it

- [ ] Initialize only required workspace packages, with manifests and explicit exports; keep app-local code local.
- [ ] Adapt exact toolchain pins, the `prepare` patch, compiler diagnostics, Oxlint and dprint, with `reference/` excluded from every tool; produce and verify the new lockfile.
- [ ] Port and test import, app, signer, three.js, testing-data, Atlas and workbench fences; validate bundle contents as well as imports.
- [ ] Configure the narrow API-package exception and a reasoned suppression budget.
- [ ] Adapt the bundle-budget model and manifest walker, preserving structured failures.
- [ ] Implement `alchemy.run.ts` and CI as in [Alchemy's CI tutorial](https://alchemy.run/cloudflare/tutorial/part-5): a `pr-<number>` stage per pull request, cleanup on close with a guard against `prod`, a PR comment with the preview URL, and a scoped token minted by `stacks/github.ts` under a separate admin profile. Prove both creation and teardown of an isolated stage.
- [ ] Run one production-entry flow against that stage, with an independent review of its assertions and stubs.
- [ ] Fill `packages/atlas` with the picked look values; generate stylesheet and palette from it.
- [ ] Wire the promoted look harness and workbench into the checks; ensure the workbench cannot enter production bundles.
- [ ] Pass formatting, typecheck, lint, build and the stage's relevant tests without placeholder success commands.
- [ ] Delete `reference/` and its tool exclusions once everything Stage 0 ports from it is in place.
- [ ] Obtain owner review of the decisions, new flow and picked frames before starting Stage 1.

Use the file-by-file [carry-over list](floor-docs-2026-10-12/next-steps.md) and [source inventory](reference-sources.json). The old runtime, renderer, dashboard, custom launch/wallet protocols and bench reports stay behind. The old lint plugin and CI require adaptation; their presence in the reference build is not evidence that the new boundaries are enforced.
