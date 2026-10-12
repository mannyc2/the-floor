# Stage 0: the skeleton

Stage 0 builds what the first milestone grows on: the toolchain and its fences, CI with a deployed preview, the platform pieces, the look, and the renderer. It is done when every item below is done and verified, and the owner has reviewed it. Stages 1 to 5 are in the [technical design](technical-design.md#first-milestone).

## Done

| Area | What's there | Verified by |
| --- | --- | --- |
| Toolchain and fences | Strict TypeScript with all 91 Effect diagnostics as errors, type-aware Oxlint with the Effect presets, custom import and file-read fences, emitted-bundle and source-map checks, a reasoned suppression budget, and pinned packages | The local checks, and Linux CI on 12 October |
| The Floor's Worker | Yielded agent and mailbox Durable Objects on Alchemy, Anthropic and OpenAI Layers, and a predicate-only Decisions adapter | Native tests (admission, restart, Durable Object and D1 storage) and a bounded hosted run |
| Web | A Foldkit shell over the contract Schemas and `@floor/api`, with a typed health check and a scoped map host over labelled synthetic desks | The health flow has local and hosted evidence; the renderer has local browser evidence only |
| Chains | Solana construction (Kit, generated Meteora codecs, `bigint` maths) and EVM construction (Doppler on Base). Nothing signs or broadcasts | 940 SDK oracle cases and exact-byte parity tests |
| Wallets | A native Privy client in `packages/wallets` | Leaf tests. It hasn't reached the sandbox |
| Look harness | Pixel metrics, deterministic capture, the phone profile and impostor checks, connected to the development renderer and independent CPU targets | Leaf tests and real renderer captures; the local results are below |
| CI | Preview deploys per admitted PR, cleanup on close, and scoped credentials | [CI 38295404123](https://github.com/mannyc2/the-floor/actions/runs/38295404123) and [cleanup 38296179460](https://github.com/mannyc2/the-floor/actions/runs/38296179460) |

## Left

- [ ] **Complete renderer acceptance.** The scoped host, technique B renderer, ID-image picking, camera interaction subset, development workbench and independent look targets are implemented. Quarter-turn rotation and camera-dependent wall/ceiling cutaway still need implementation and checks. Moving-target follow, sustained snapshot updates with exact upload accounting, and the drag-through-Model comparison remain explicit [open items](decisions.md#open-items). The updated renderer has not had a hosted run.
- [ ] **The look.** The tradition is picked: a 1980s exchange floor. The owner picks the reference frames and the character sheet, then tones, proportions and the kit unit (see [the look](look.md)). `packages/atlas` holds the values, the stylesheet and palette are generated from it, the picked frames are in `testing/reference/`, and the post, station, figure and token-screen generators are in the web asset kit.
- [x] **Look checks wired in.** The look harness runs against the real renderer as part of `bun run test:flow`, with building, floor and desk zoom names and desk counts. Production build fences exclude the workbench. Synthetic targets remain unapproved; the local results are below.
- [ ] **Owner review** of the decisions, the new flow and the picked frames, before Stage 1 starts.

The provider checks (the agent's browser, Privy's sandbox, live inference and plates) moved to the stages that first need them; see the [decision log](decisions.md#stack-and-platform).

## Local renderer verification

On 12 October 2026, `bun install --frozen-lockfile`, `bun run format:check`, `bun run typecheck` and `bun run lint` passed on macOS with Bun 1.4.0. All 91 Effect diagnostics and the full lint presets remain enabled; the 146 reasoned suppression directives were reviewed, including native browser and test boundaries.

`bun run test:leaf` passed 104 tests with 1,528 assertions, including 38 renderer protocol, ownership, lease and transactional-host tests. The cancellation test reproduces the old publication/finalizer leak as a negative control. `bun run build` passed the web, Worker and chain bundle checks, and `bun run test:native` passed all three native tests.

| Production web artifact | Measured gzip | Budget |
| --- | --- | --- |
| Initial application | 122,501 bytes | 204,800 bytes |
| Deferred renderer and camera | 128,053 bytes | 184,320 bytes |

The production source-map fence inspected 220 mapped sources. The workbench, CPU projection and BVH tooling are outside that graph. Whole-array upload counters are upper bounds for touched attributes; they are not exact GPU traffic measurements.

The look flow generated nine independent primitive targets and captured all 18 day/night, building/floor/desk and DPR 1/2/3 cells through the real `/look/` adapter. All 360 navigations produced repeatable RGBA bytes, all nine primitive checks passed, and every cell supplied actual target, cylinder-interior and stroke measurements. No local stroke-width check failed. Exact F1 averaged 0.814833; one-CSS-pixel tolerant F1 averaged 0.999882 (minimum 0.999601). These are synthetic geometric comparisons, with no invented art-quality cutoff or owner approval.

The 256→64 impostor check retained 15.4% of the high-resolution edges at half darkness. This records thin-line loss; it does not claim production impostors are implemented. The look pipeline is part of `bun run test:renderer`, which `bun run test:flow` runs after the production shell flow.

`bun run test:flow` passed the production shell flow and all 52 renderer browser tests. These include camera gestures and history, DevTools replay at 1× and 10×, context loss/restoration, 10,000 ID picks against an independent BVH at each of DPR 1 and 3, no-hit clearing, real failed-release quarantine, stopped frames after native failure, and 2,000 seeded GPU reconciliations returning memory to baseline. These checks exercise the named behaviors; they do not cover the open product features above.

The phone profile uses 390×844 CSS pixels, DPR 3 and 4× CPU throttling, with 10 warmup frames and 120 retained samples per scene. The default software run and `bun run test:phone:mac` both passed:

| Renderer | Desks | CPU submission p95 | Completed-frame p95 |
| --- | --- | --- | --- |
| SwiftShader on this Mac | 12 | 2 ms | 2 ms |
| SwiftShader on this Mac | 1,000 | 2 ms | 2 ms |
| Apple M1 Pro / ANGLE Metal | 12 | 2 ms | 2 ms |
| Apple M1 Pro / ANGLE Metal | 1,000 | 2 ms | 2 ms |

The CPU budget is 16.7 ms. Completed-frame samples include blocking on `gl.finish`; GPU timer-query durations are explicitly unavailable. Desktop throttling does not certify a real phone, and these timings do not measure a sustained four-per-second snapshot stream or compare two camera architectures.

`bunx --no-install playwright test --config testing/flows/playwright.config.ts --headed` also passed. Its retained screenshot was visually inspected: the production page draws neutral desk rows, labels the scene synthetic, and reaches the real local Worker's health endpoint. Raw logs, captures, phone samples and videos remain in ignored `work/`. No reference frame was approved or committed, and Stage 0 remains open.
