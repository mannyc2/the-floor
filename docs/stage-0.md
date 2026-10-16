# Stage 0: the skeleton

Stage 0 builds what the first milestone grows on: the toolchain and its fences, CI with a deployed preview, the platform pieces, the look, and the renderer. It is done when every item below is done and verified, and the owner has reviewed it. The [cleanup program](cleanup-plan.md) and the remaining [Stage 0 plan](stage-0-plan.md) are still open. The owner separately authorized [First trade, live](first-trade-plan.md) to proceed alongside them; that exception does not approve Stage 0.

## Done

| Area | Implemented |
| --- | --- |
| Toolchain and fences | Strict TypeScript project references with Effect diagnostics, type-aware Oxlint, import and artifact boundaries, reasoned suppressions, and pinned dependencies |
| Floor runtime | Yielded agent and mailbox Durable Objects on Alchemy, SQL admissions, typed snapshots, an OpenAI model Layer, a predicate-only Decisions adapter and the bounded first-trade loop; scripted Layers live only in tests |
| Web and renderer | Foldkit shell, typed health RPC, scoped renderer lifetime, synthetic desk scene, ID-image picking, camera gestures and quarter turns, camera-relative side tones, cutaway, fixed-ID snapshots, moving-target follow and the live first-trade desk/receipt viewer |
| Live world | One Durable Object per world identity, atomic SQL event/snapshot history, internal publishing and a public read-only RPC stream with sequence-based reconnects |
| Chains and fork signer | Solana launch/swap construction and pool reads, EVM construction, and a separate local signer Worker that journals real fork outcomes and refuses a foreign genesis |
| Wallets | The native Privy client and its offline oracle tests; the [wallet record](../packages/wallets/README.md) retains the test-transport incident and administration blocker |
| Atlas and references | Plain drawing values and a value snapshot, sixteen preserved owner-picked frames, and render-only scene briefs; approval history stays in the decision log and git |
| Verification and CI | Serial shell, first-trade, renderer, approved-frame and asset browser projects, a production-entry camera flow under a stage request budget, native Worker, agent and fork checks, development capture tools, artifact fences, and gated per-PR preview deployment and teardown |

These are implemented surfaces with the evidence described by their commits. They do not establish the open product, art, hosted or provider promises below.

## Left

- [ ] **Finish cleanup and branch integration.** T, R, S, D1, RPC, K, W, the owner middleware, the hosted-flow branch, the slimmed asset kit and the picked side-tone rule are on local `main`. The world-layout branch still follows its plan and owner gate. Its merge still needs combined verification and the cleanup's final size accounting.
- [ ] **Complete renderer acceptance.** The production-entry camera, seeded-desk pick and RPC/MCP flows passed against [PR #2](https://github.com/mannyc2/the-floor/pull/2)'s preview, with teardown proof; owner review remains open. Current desktop phone-profile checks do not establish real-phone performance. The live viewer handles one occupied canonical floor; multi-floor navigation, moving-world events and snapshot replay through the Model remain open.
- [ ] **Finish the Stage 0 look.** One post with its stations, one figure and one token screen must be built through the generator and SVG-profile routes, shortlisted and picked in day and night at all four quarter turns. The first asset sheet was returned without a pick. Side tones now follow the camera (16 Oct pick), so the generated post and stations pass the visible-body rules at every corner in day and night, and the seven picked renderer frames are unchanged. Paper-contact and line-ending measurements belong to the real assets.
- [ ] **Run the newcomer test, or record it as not run.** This requires a person who has not seen the Floor.
- [ ] **Owner review.** The decisions, integrated flow and picked frames must be reviewed before Stage 0 closes. The first-trade exception does not waive this gate.

Brass and engraving still need real instrument geometry. Figure and asset design, skin/hair/clothing materials, newly exposed underside bands, station/population counts, physical scale, final clearances and the interface remain unapproved. The lobby, wall of screens, bell and podium, cabinets, whiteboards, building rung, level of detail and interface implementation belong to Stage 2. The rejected exchange compositions remain unmerged; the world-layout proposal needs the owner's adoption before further multi-post, floor or exchange review.

The agent's browser containment, Privy's sandbox and quorum administration, live inference, market data and plates retain their later-stage gates in the [decision log](decisions.md#open-items). Fork execution does not prove Privy enforcement or authorize real money. No hosted renderer run, push, preview admission or new provider spending is authorized by this status page.

## Local renderer verification

The active browser checks cover camera gestures/history, quarter turns and cutaway, ID picking, context loss/restoration, scoped acquisition and release, quarantine after failed retirement, instance reconciliation, replay diagnostics and the desktop phone profile. The [verification guide](Codex/verification.md) defines the required checks and their limits.

Finished tone/proportion studies, the large capture matrix and the obsolete host-protocol tests have left the suite. The `approved` project reproduces the seven picked renderer frames at zero tolerance and checks the top, dark and light side tones at all four corners; the `assets` project renders the generated post and stations through the `/look/` adapter. Production builds exclude the workbench and its diagnostics. The default desks and palette remain visibly labelled synthetic.

### Renderer stream

Indexed geometry writes colour and identity attachments in one pass with shared depth. Authored sRGB palette bytes remain unconverted in RGBA8. The composite copies pixels outside outlines and preserves linear blending for fractional strokes.

Complete revisioned snapshots reconcile fixed known IDs atomically. Unknown or duplicate IDs, stale revisions and Float32 overflow leave accepted state unchanged; omitted slots can return without allocating geometry. Position interpolation and recorded gauge playback share one clock implementation with separate intervals. Moving follow retains its initial flight and releases on input or target removal; the settled camera commits to the Model and URL.

One Effect semaphore permit owns each mounted renderer through acquisition, use and scoped retirement. Native failure reaches the mount through a Deferred, and failed retirement quarantines later acquisition. Upload/listener/frame probes and DevTools replay controls live in the workbench. Their counters describe native calls, submitted source bytes and allocations, not physical bus traffic or GPU duration.

The sustained snapshot checks retain every revision, deterministic draw/triangle/upload budgets, no stable-frame uploads and the 16.7 ms per-frame CPU limit. Arrival lateness is measured without gating integration. The camera comparison covers serial small-drag submission through the real Model and presentation pump; it does not establish compositor latency or general event throughput. These limits remain independent of the pending hosted and real-phone checks.

### RPC and MCP

`FloorRpcs` serves health at `/api/rpc`; its server-only MCP adapter exposes unary read-only operations at `/mcp`. `WorldRpcs` serves the separate stream at `/api/world`. The production Floor Worker has no public mutation or model-run route, and all three routes are credential-free. The `AuthenticateOwner` RPC middleware and its `PrivyTokens` verifier exist for a future owner RPC group, but no RPC uses them and there is no browser sign-in or CLI login. Owner operations or hosted first-trade exposure must wait for that protected group,. The RPC/MCP health surface passed on [PR #2](https://github.com/mannyc2/the-floor/pull/2)'s preview.

### Live world

A world's physical floors share one allocation authority. Its SQL journal commits each join, state or receipt event with its exact resulting snapshot. Readers receive a snapshot and ordered deliveries over HTTP NDJSON; the delivery sequence is separate from the evidence's chain checkpoint. Reconnects resume from the requested sequence. Journal identity deduplicates earlier receipt retries, and terminal receipt outcomes cannot be replaced or downgraded.

The fork signer separately journals uncertainty before broadcasting once and resolves later retries from the chain. Its receipts identify their local fork authority and actual initiating intent. The isolated native world test uses explicitly synthetic receipt evidence. The combined first-trade flow uses the actual pool reader, signer and world: a labelled scripted model researches and trades, the production viewer shows its state through approved material values, and clicking its desk opens the receipt. The browser flow checks that receipt's transaction and checkpoint on the fork and recovers it after reload.

The viewer preserves canonical station coordinates and stable desk IDs, ignores obsolete renderer commands and reconnects from its last delivery sequence. It explicitly refuses additional occupied floors or capacity beyond its fixed renderer allocation. The geometry remains labelled synthetic; this slice approves no art, interface or world-layout proposal.

## Picked references and approval scope

The sixteen picked frames are preserved under [testing/reference](../testing/reference/). Scene [briefs](../testing/look/scenes/README.md) contain the values needed to render them. The [decision log](decisions.md#the-look) and git retain the owner's picks, their limits and the earlier review evidence; approval metadata is not shipped in Atlas or renderer values.

The nine image-generation references establish the exchange tradition and faceless characters. They do not approve executable geometry or complete the original scene briefs' pending cameras, placements, night views or thresholds. No new image round is required.

### Day material study and colour audit

Corrected day A covers the shown timber and floor faces, ground, paper, line, steel, glass and jacket colours in [materials-day.png](../testing/reference/materials-day.png). Text checks belong to their actual surfaces; paper is compared with its supports, and brass with each actual mount. Brass and engraving remain provisional. Hidden faces, proportions, instrument geometry and an unseen interface are outside this material pick. Atlas records the [current values and limits](atlas.md#approved-day-materials-and-provisional-instruments--13-october-2026).

### Night material study and approved B

Night B covers the shown materials, pale ordinary outlines, dark surface/instrument contours and flat lit lamp/screen faces in [materials-night.png](../testing/reference/materials-night.png). It preserves the day pick's scope. It does not approve hidden faces, geometry, lamp design, proportions, the kit unit, instruments or the interface. Brass and engraving remain provisional; the [Atlas scope](atlas.md#approved-night-materials--13-october-2026) retains the distinction.

### Proportion study and approved Roomy

The owner picked Roomy only for `K = H/8` and the [nine dimension ratios](atlas.md#approved-proportions-and-kit-unit--13-october-2026). `H` is a nominal standing height without a physical unit. The preserved views are the [day post](../testing/reference/proportions-post-day.png), [floor](../testing/reference/proportions-floor-day.png), [cast](../testing/reference/proportions-cast-day.png), [native readability](../testing/reference/proportions-readability-day.png) and [night post](../testing/reference/proportions-post-night.png).

Those views do not approve skin, hair or clothing materials, new underside assignments, figure/asset design, eight stations per post, the shown population, physical units, brass, final clearances or additional construction dimensions. Atlas holds the picked values; production asset work remains unfinished.

<a id="clean-full-flow-before-local-integration--14-october-2026"></a>

Historical local checks, corrections, failed attempts and retakes remain in this file's git history and the implementation commit bodies. Raw logs, captures and candidates stay in ignored `work/`. Local integration preserved the recorded picks and did not close Stage 0 or its hosted/provider gates.
