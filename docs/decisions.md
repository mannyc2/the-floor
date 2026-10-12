# Workspace decisions

This is the active log for the new workspace. The [copied archive](floor-docs-2026-10-12/archive.md) retains earlier product decisions and proposals. Local platform results are recorded below; hosted results and art approvals remain outstanding.

## Current scope

| Date | Item | Status and basis |
| --- | --- | --- |
| 12 October 2026 | Prepare a fresh local workspace and two spike handoffs | Confirmed by the user's scope selection. The first build remains a reference; preparation does not start Stage 0. |
| 12 October 2026 | Use the revised docs as the starting specification | Requested by the user. Preserve the snapshots and log deviations here. |
| 12 October 2026 | Define HTTP/RPC in `packages/api`, leaving contract Schemas only | Carried from the revised design and archive. This is the sole planned internal unstable-API exception; no compiler allowlist has been configured yet. |
| 12 October 2026 | Keep read-only snapshots of the first build and the cafe reference in `reference/` | Accepted at the owner's request, so links and source references work on any machine, in CI and for cloud agents. Provenance, exclusions, renamed instruction files and checksums are in [reference/README.md](../reference/README.md). Never imported, built, linted or treated as evidence. |
| 12 October 2026 | Commit spike evidence under `docs/spikes/evidence/`; keep scratch in `work/` | Accepted at the owner's request, so evidence can be reviewed and shared across worktrees. Rules are in [the evidence README](spikes/evidence/README.md). |
| 12 October 2026 | No human artist or art director. Agents make reference images (image generation) and assets (three.js, Blender driven by Python, SVG profiles); the agent that didn't make a thing reviews it; the owner approves by picking between shortlisted options | No human artist or art director is available; the owner set this on 12 October. Picking as approval is the default, and it keeps a person's taste as the final check without asking the owner to make art. Supersedes the artist and art-director roles in the copied technical design ("A person signs off"), Floor Atlas plan (painted references, hand modelling, look-spike inputs) and next steps ("Who directs the art"). |
| 12 October 2026 | Build fresh in this workspace; the first build is reference only | Accepted by the owner. |
| 12 October 2026 | Codex's image generation is the only image source for look Part B | Accepted by the owner. Claude reviews and shortlists what Codex generates. |
| 12 October 2026 | Run the platform spike and look Part A now; look Part B follows Part A's report | Authorized by the owner. The platform spike's temporary stage is created and destroyed within the spike; no real funds. |
| 12 October 2026 | Resume with local checks only | **Accepted owner instruction:** “Local checks only for now,” after disk space was restored and a read-only Cloudflare account check succeeded. This narrows the preceding temporary-stage authorization: no hosted workload or deployment in the resumed run. Hosted checks require later scope and a spend limit. |
| 12 October 2026 | `reference/` is temporary: delete it at the end of Stage 0, once the skeleton has ported what it needs | Accepted by the owner, to keep the repository lean. The snapshot stays recoverable from the first commit. |
| 12 October 2026 | Split the look spike into Part A (rendering technique, runnable without art inputs) and Part B (references, tones, proportions, assets, owner picks) | Accepted at the owner's request, so the technique work isn't blocked on references. See [the look handoff](spikes/look.md). |

## Decisions and inputs still needed

| Item | Current starting point | Evidence or owner needed | Required by |
| --- | --- | --- | --- |
| Owner's picks | Roles settled above; no picks yet | The owner's picks of reference frames, technique, tones and proportions from shortlisted options | Look spike Part B exit |
| Cloudflare access | Existing OAuth login refreshed successfully; entitlements untested | Local-only scope currently applies. Hosted Workers, Durable Objects and Browser Rendering access; scoped stage, spend limit and cleanup | Hosted platform checks |
| Wallet, inference and market-data accounts | No configured keys found in inspected environment/worktree files | Privy sandbox and co-signing arrangement; selected inference providers; Codex market-data account (codex.io) | Respective platform checks and Stage 0 needs |
| Browser package and containment | Cloudflare default, Browserbase fallback | Package/version exporting the adapters; tested network containment, live view and takeover | Platform spike exit |
| Runtime compatibility | Workers and Durable Objects target | workerd evidence for SDKs, storage, Web Crypto and renderer; logged deviations where necessary | Platform spike exit |
| Rendering technique and Atlas values | Unselected | Part A's measurements, then the owner's picks of technique, tones, kit unit, line spec and proportions | Look spike exit |
| Islands | Revised default: Solana plus Robinhood Chain; Base through the EVM adapter | Validate with `fomo-analytics` before Stage 3; current dataset availability not established | Stage 3 |
| Source control hosting | Local repository with an initial commit | A remote | Parallel worktrees in the cloud and preview CI |

Do not store credentials in this log or the repository. Record only readiness, scope and evidence locations. Browserbase is needed only if selected by the platform spike. Historical provider claims and versions are inputs to verify during that spike, not fresh compatibility findings.

## Local platform findings — 12 October 2026

The [platform report](spikes/evidence/platform/report.md) recommends **hold before Stage 0**. The platform executor produced the experiments; a separate toolchain agent reviewed the code, exact source hashes and final responses. That review accepts the bounded technical findings, not hosted compatibility or stage completion.

| Selection or deviation | Status, alternatives and basis |
| --- | --- |
| Effect and SQL adapters 4.0.3, Yielded agent + Cloudflare adapter 0.1.0-beta.170, effect-cf 0.56.0 | **Used for this spike; product adoption proposed.** Effect 4.0.0 mismatched the SQL peers. The separate Cloudflare package resolves the adapter-location gap. Native local alarms, completed restart and interrupted-turn recovery pass on the pinned set. Hosted provider/session behavior remains unrun. |
| workerd 1.20261006.1, Wrangler 4.149.0, compatibility date 2026-10-06 | **Used for this spike.** The date matches the installed runtime. Bare SQL/crypto explicitly disable Node compatibility; agent/launch enable it. These are measured configurations, not proof every SDK needs that flag. No component was moved to Bun to substitute for Worker execution. |
| SQLite Durable Object journal and D1 history | **Proposed with distinct semantics.** DO transactions support the measured rollback, nested rollback and conditional update. D1 provides atomic batches and rejects interactive transactions; one abstraction promising identical transaction behavior would be incorrect. Full journal and hosted lifecycle coverage remain later work. |
| Meteora 1.5.13 and Doppler 1.0.43 unsigned construction | **Local runtime construction accepted as evidence; product launch support not approved.** Exact fixture inputs, repeat digests and rejecting transports are retained. Meteora's quote-mint read is synthetic; no chain checkpoint, signing, broadcast or launch semantics are established. |
| Browser policy/provider | **Unresolved.** Cloudflare's adapter rejects PublicWeb before acquisition. Allowlist, enforced unrestricted access and alternate open-web provider remain alternatives requiring controlled hosted tests and a policy decision. No fallback selected. |
| Toolchain and API boundaries | **Spike configuration only.** Preserve strict options, all91 Effect diagnostics, prior compiler/lint pins and patch command. External dependency module families are reviewed; no broad internal application exception is added. Eleven reasoned single-line boundary suppressions are counted in the probe README. Stage 0 still owns architecture fence adaptation and the sole planned packages/api exception. |

Earlier failed prerequisite and evidence-review attempts remain retained. Final runtime source is `181bd364ecd64b3e73e64a508d035eac958d668a`; final results use that commit, not unavailable pre-edit source. No production, deployment, art or Stage 0 approval follows from these findings.

## Recording the next decision

For each decision, record its date, status (proposed, accepted, rejected or superseded), accountable reviewer, alternatives considered, reason, exact versions and evidence links. Runtime substitutions must name where the affected component runs. Art decisions must identify the approving person and frames. A proposed option or an experiment's successful command is not approval of the whole stage.

At each stage boundary, the owner reviews deviations, every new flow and the signed-off frames before the next stage begins.
