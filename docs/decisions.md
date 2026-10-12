# Workspace decisions

This is the active log for the new workspace. The [copied archive](floor-docs-2026-10-12/archive.md) retains the earlier product decisions and proposals. No spike results, deployment results or art approvals have been recorded here.

## Current scope

| Date | Item | Status and basis |
| --- | --- | --- |
| 12 October 2026 | Prepare a fresh local workspace and two spike handoffs | Confirmed by the user's scope selection. The first build remains a reference; preparation does not start Stage 0. |
| 12 October 2026 | Use the revised docs as the starting specification | Requested by the user. Preserve the snapshots and log deviations here. |
| 12 October 2026 | Define HTTP/RPC in `packages/api`, leaving contract Schemas only | Carried from the revised design and archive. This is the sole planned internal unstable-API exception; no compiler allowlist has been configured yet. |
| 12 October 2026 | Keep read-only snapshots of the first build and the cafe reference in `reference/` | Accepted at the owner's request, so links and source references work on any machine, in CI and for cloud agents. Provenance, exclusions, renamed instruction files and checksums are in [reference/README.md](../reference/README.md). Never imported, built, linted or treated as evidence. |
| 12 October 2026 | Commit spike evidence under `docs/spikes/evidence/`; keep scratch in `work/` | Accepted at the owner's request, so evidence can be reviewed and shared across worktrees. Rules are in [the evidence README](spikes/evidence/README.md). |
| 12 October 2026 | No human artist or art director. Agents make reference images (image generation) and assets (three.js generators and SVG profiles); the agent that didn't make a thing reviews it; the owner approves by picking between shortlisted options | No human artist or art director is available; the owner set this on 12 October. Picking as approval is the default, and it keeps a person's taste as the final check without asking the owner to make art. Supersedes the artist and art-director roles in the copied technical design ("A person signs off"), Floor Atlas plan (painted references, hand modelling, look-spike inputs) and next steps ("Who directs the art"). |
| 12 October 2026 | Build fresh in this workspace; the first build is reference only | Accepted by the owner. |
| 12 October 2026 | Codex's image generation is the only image source for look Part B | Accepted by the owner. Claude reviews and shortlists what Codex generates. |
| 12 October 2026 | Run the platform spike and look Part A now; look Part B follows Part A's report | Authorized by the owner. The platform spike's temporary stage is created and destroyed within the spike; no real funds. |
| 12 October 2026 | `reference/` is temporary: delete it at the end of Stage 0, once the skeleton has ported what it needs | Accepted by the owner, to keep the repository lean. The snapshot stays recoverable from the first commit. |
| 12 October 2026 | Dependencies: Effect's own modules first. A third-party library is added only where Effect can't do the job, one per chain family behind one service edge, with a line here saying why. Solana uses `@solana/kit` (one pinned major, RPC over Effect's HttpClient); no `@solana/web3.js`, Anchor or `bn.js` in production. Meteora uses a Codama-generated Kit client from its program IDL and ported `bigint` maths, with the official SDK as a dev-only test oracle at most. EVM uses `viem`, and Doppler is imported through its `/evm` entry only. Privy is reached through a small Effect HttpClient client first, with its SDK as the fallback. Wrangler is dropped in favour of Alchemy. `effect-cf` is allowed only underneath Yielded's Cloudflare adapter, inside the agent's Durable Object | Accepted by the owner. Meteora's SDK alone would bring the whole web3.js v1 and Anchor stack into the Workers. |
| 12 October 2026 | Alchemy v2 is how the Floor is built on Cloudflare, not only how it is deployed. Workers and Durable Objects are Alchemy resources with Effect bindings; scheduled work uses durable callbacks; local runs use `alchemy dev`; hosted tests use Alchemy's harness; credentials are Alchemy profiles. No Wrangler config or `effect-cf` | Accepted by the owner. The first build skipped Alchemy entirely, and the platform spike started on raw Wrangler. Alchemy's runtime is Effect-native, so it fits the Floor's services and Layers directly. Details are in the [platform handoff](spikes/platform.md). |
| 12 October 2026 | No Blender for the MVP. Assets are three.js generators and SVG profiles turned into geometry; the line target is three-edge-projection | Accepted by the owner: Blender is polish for later, not MVP work. The Atlas conventions (`_SURFACE`, `_MAT`, sockets, the kit unit) stay as written, so Blender-made assets can join later without changes. Supersedes the Blender routes in the copied Atlas plan and technical design. |
| 12 October 2026 | Split the look spike into Part A (rendering technique, runnable without art inputs) and Part B (references, tones, proportions, assets, owner picks) | Accepted at the owner's request, so the technique work isn't blocked on references. See [the look handoff](spikes/look.md). |

## Decisions and inputs still needed

| Item | Current starting point | Evidence or owner needed | Required by |
| --- | --- | --- | --- |
| Owner's picks | Roles settled above; no picks yet | The owner's picks of reference frames, technique, tones and proportions from shortlisted options | Look spike Part B exit |
| Cloudflare access | Account readiness unchecked | Workers, Durable Objects and Browser Rendering access; scoped test stage and cleanup | Hosted platform checks |
| Wallet, inference and market-data accounts | Readiness unchecked | Privy sandbox; selected inference providers; Codex market-data account (codex.io) | Respective platform checks and Stage 0 needs |
| Yielded on Alchemy | yielded-dev/agent#557 (open, unpublished) needs a patch on Alchemy beta.80 | The PR merged and `@yielded/agent-platform-alchemy-cloudflare` published, with its Alchemy fixes released upstream, or a decision to carry a pinned build and patch until then | Stage 0 |
| Browser package and containment | Cloudflare default, Browserbase fallback | Package/version exporting the adapters; tested network containment, live view and takeover | Platform spike exit |
| Runtime compatibility | Workers and Durable Objects target | workerd evidence for SDKs, storage, Web Crypto and renderer; logged deviations where necessary | Platform spike exit |
| Rendering technique and Atlas values | Unselected | Part A's measurements, then the owner's picks of technique, tones, kit unit, line spec and proportions | Look spike exit |
| Islands | Revised default: Solana plus Robinhood Chain; Base through the EVM adapter | Validate with `fomo-analytics` before Stage 3; current dataset availability not established | Stage 3 |
| Source control hosting | Local repository with an initial commit | A remote | Parallel worktrees in the cloud and preview CI |

Do not store credentials in this log or the repository. Record only readiness, scope and evidence locations. Browserbase is needed only if selected by the platform spike. Historical provider claims and versions are inputs to verify during that spike, not fresh compatibility findings.

## Recording the next decision

For each decision, record its date, status (proposed, accepted, rejected or superseded), accountable reviewer, alternatives considered, reason, exact versions and evidence links. Runtime substitutions must name where the affected component runs. Art decisions must identify the approving person and frames. A proposed option or an experiment's successful command is not approval of the whole stage.

At each stage boundary, the owner reviews deviations, every new flow and the signed-off frames before the next stage begins.
