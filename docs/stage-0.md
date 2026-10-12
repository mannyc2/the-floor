# Stage 0: the skeleton

Stage 0 builds what the first milestone grows on: the toolchain and its fences, CI with a deployed preview, the platform pieces, the look, and the renderer. It is done when every item below is done and verified, and the owner has reviewed it. Stages 1 to 5 are in the [technical design](technical-design.md#first-milestone).

## Done

| Area | What's there | Verified by |
| --- | --- | --- |
| Toolchain and fences | Strict TypeScript with all 91 Effect diagnostics as errors, type-aware Oxlint with the Effect presets, custom import and file-read fences, emitted-bundle and source-map checks, a reasoned suppression budget, and pinned packages | The local checks, and Linux CI on 12 October |
| The Floor's Worker | Yielded agent and mailbox Durable Objects on Alchemy, Anthropic and OpenAI Layers, and a predicate-only Decisions adapter | Native tests (admission, restart, Durable Object and D1 storage) and a bounded hosted run |
| Web | A Foldkit shell over the contract Schemas and `@floor/api`, with a typed health check and a mount point for the map | The browser flow, locally and against a deployed preview |
| Chains | Solana construction (Kit, generated Meteora codecs, `bigint` maths) and EVM construction (Doppler on Base). Nothing signs or broadcasts | 940 SDK oracle cases and exact-byte parity tests |
| Wallets | A native Privy client in `packages/wallets` | Leaf tests. It hasn't reached the sandbox |
| Look harness | Pixel metrics, deterministic capture, the phone profile and impostor checks, in TypeScript | Leaf tests. Real captures wait for the renderer |
| CI | Preview deploys per admitted PR, cleanup on close, and scoped credentials | [CI 38295404123](https://github.com/mannyc2/the-floor/actions/runs/38295404123) and [cleanup 38296179460](https://github.com/mannyc2/the-floor/actions/runs/38296179460) |

## Left

- [ ] **The renderer.** The map host, renderer, camera and picking in `apps/web`, from the external Foldkit round, porting technique B from `apps/web/spikes/look-a`. Its deferred bundle stays within 180 KiB gzip, the camera rules pass in the running app, and the look harness gets its web adapter and edge-projection targets.
- [ ] **The look.** The owner picks the floor's tradition, then its reference frames, tones, proportions and kit unit (see [the look](look.md)). `packages/atlas` holds the values, the stylesheet and palette are generated from it, the picked frames are in `testing/reference/`, and the desk, figure and ticker-wall plate generators are in the web asset kit.
- [ ] **Look checks wired in.** The look harness runs against the real renderer as part of the checks, with its zoom names moved from the older district, works and machine to building, floor and desk, and the workbench can't reach production bundles.
- [ ] **The agent's browser.** Containment is chosen and tested, and live view and owner takeover are proved (see [the platform](platform.md#the-agents-browser)).
- [ ] **Providers.** Privy's sandbox and live inference are checked within an approved budget (see [the platform](platform.md#open-provider-checks)).
- [ ] **Plates.** Browser Rendering screenshots a real renderer scene.
- [ ] **Owner review** of the decisions, the new flow and the picked frames, before Stage 1 starts.
