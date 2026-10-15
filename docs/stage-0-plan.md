# Stage 0 plan

14–15 October 2026. This orders the work left before Stage 0 can close. The [cleanup plan](cleanup-plan.md) runs first, with renderer-stream merging as D1 once its tooling step lands; the other branches then rebase onto the cleaned `main` and slim before integration. It is written for an orchestrating agent that runs each workstream in its own session. The owner's decisions behind it are the 14–15 October rows in the [decision log](decisions.md): local integration and its unchanged renderer timing gate, the hosted check, the Stage 0 look finish line, all-corner shading, the returned asset sheet, the rejected exchange compositions and the world layout revision. Stage 0 stays open until every item in [Stage 0](stage-0.md#left) is done and verified and the owner has reviewed it.

## Where things stand

Before this execution, `main` was at `ae45e35`, including the wallet-authority blocker and this plan. Nothing is pushed; `origin/main` is still `835a28c`. The four original branches start from `b1bc6b2`. These were their starting records:

| Branch | Adds | Status | Before it merges |
| --- | --- | --- | --- |
| `codex/renderer-stream` at `a441f50` | Fixed-ID snapshot stream, buffer accounting, moving-target follow, drag comparison | The default SwiftShader run fails (see [A](#a-renderer-stream)); its 81/81 run used the Apple GPU profile | Workstream A |
| `codex/asset-kit` at `5edefdf` | Atlas asset/scene Schemas, post and two station generators, compressed models, preflight, asset and approved-frame suites | Sheet returned without a pick; corner three fails through the shading rule | Workstream C |
| `codex/rpc-api` at `12b5399` | One health RPC group, scoped web client, read-only MCP adapter | Its record allowed only a local commit; the 14 Oct decision now allows the merge | Workstream I |
| `codex/exchange-view` at `24fd50a` | Whole-exchange composition study | Both compositions rejected | Stays unmerged as the record; its harness and the `canonicalFloorOrigin` export can be reused by F |

`git worktree list` shows each branch's worktree.

### Local execution — 14–15 October 2026

The authorized local work retained each branch's evidence and kept the browser suites serial. No implementation has merged into `main`. A passed the unchanged SwiftShader gate on 15 October, so D1 runs once the cleanup's T lands. The existing authentication task remains queued behind D3; no duplicate was started. Nothing was pushed, deployed or sent to a provider. These results do not close Stage 0 or approve art.

| Workstream | Local result | What remains |
| --- | --- | --- |
| A | `codex/renderer-stream` at `f0310c9`: colour and identity share one geometry pass. The default SwiftShader full flow passed the Worker shell and all 82 renderer checks; the 1,000-desk stream's worst arrival lateness was 194.1 ms against the unchanged 250 ms, with 9.8 ms worst frame CPU. The seven approved frames stayed exact and an independent audit passed. The commit body has the commands | D1 after T. World integration remains open |
| C | `codex/asset-kit` at `c3c6f1f`: full sequence, 72 renderer checks, six asset cases and seven exact approved frames passed. Linux amd64 with Bun 1.4.0 and a frozen install reproduced all three committed models byte-for-byte. Required asset/frame checks are wired into local and CI sequences; station-count mismatch is explicitly deferred to G | Wait for D1 before D2. The returned asset sheet remains unchanged and unpicked |
| I | `codex/rpc-api` at `26354a0`: obsolete HTTP-API allowlist entry removed; complete sequence, real local RPC/MCP shell and all 72 renderer checks passed | Wait for D1/D2 before D3, then the existing authentication task |
| B | `codex/shading-options` at `b53242b`, based on C: both workbench-only rules passed all 24 preflight reports; 48 final view/theme/corner cells and 24 exact paired line masks were independently audited. Ordinary checks passed, including 72 renderer, six assets and seven exact approved frames; the headed demonstration passed 12 cases | Owner shading pick. Camera-relative reproduced all seven approved frames exactly; axis-fixed failed all seven, changing 454 of 6,672,000 pixels. Production and references are unchanged |
| E | The production-entry camera flow and hosted run sheet on `codex/hosted-renderer-flow` at `c6d741c` passed the full local sequence: 365 leaves, three native checks, three production-entry cases and 72 renderer cases; three headed cases also passed. Independent trace/PNG review confirmed real requests, exact reload pixels and one resting commit | After D3, rebase and include the RPC shell's eight direct MCP requests in the separate non-browser budget, then rerun the combined checks. Push/admission/preview and hosted allowance remain owner gates |
| F | The isolated candidate on `codex/world-layout-proposal` at `68d3910` passed 376 leaf tests, three native checks, the live Worker check, all 89 renderer checks and seven exact approved frames; two headed cases also passed. Eleven numerical properties passed; Bun/JavaScriptCore and Node/V8 produced identical bytes for 24 plans and 80 allocation states. All 16 corrected scene/plan views were independently reviewed, and the final run reproduced those PNGs exactly; the original failed visual packet is retained | Owner adoption remains open, including the 4.25H minimum-spacing interpretation and large fixed lobby. No production layout or approved Atlas value has changed |

Detailed commands and limitations are in each worktree's `docs/stage-0.md`; F's rule audit and proposal are in its `docs/world-layout-proposal.md`. Raw logs and captures stay under each worktree's ignored `work/` directory. B's independently filtered blind sheets are `work/shading-options/blind-review/{post,desk,materials}.png`; the option mapping remains separate until the owner's pick. F's navigation sheets are `work/world-layout-proposal/contact-sheet-{scene,plan}-003.png`, with full-size images in `review-final/` in that directory. G waits for B's pick and D2. The newcomer test has not run and needs the owner to arrange a new viewer.

## Rules for every session

- Read [AGENTS.md](../AGENTS.md) and the docs it lists for your area before starting.
- **One browser suite on the machine at a time.** Ask the orchestrator for the browser slot before `test:flow`, `test:renderer`, `test:assets`, `test:approved`, `test:phone:mac`, the shell flow or a headed demonstration, and release it when the run ends. Concurrent suites have caused timing failures and a phone-budget failure.
- Renderer ports: A 5183, C 5181, B 5184, E 5185, F 5186, G 5187, D 5198. The local shell flow always uses Worker port 19740, so it also needs the browser slot.
- Never push, open a pull request, deploy, enable previews, call a provider or spend. Stop at the owner gates below.
- Never weaken a check, relabel a failure or switch a default profile to get a pass. Keep failed runs; put each result with its command in the commit body, and keep raw output in `work/<workstream>/`.
- Edit `docs/decisions.md`, `docs/stage-0.md`, `scripts/lint/suppression-budget.json`, root `package.json` and `apps/web/workbench/{api,entry}.ts` only on your own branch. Integration (D) assembles `main`, where the owner's 14 October rows win over branch wording.
- No agent approves its own output. An independent review is a filter, not an approval.
- Report back with: branch and commit; each command and result, failures included; changes to shared files; questions for the owner.

## Owner gates

The renderer timing decision is resolved: on 15 October the owner required integration to remain blocked until the unchanged 250 ms SwiftShader check passes. A failing check does not reopen a request to waive it. A passed it at `f0310c9`; it still applies to D1's rerun and to W.

Stop and ask the owner for:
- any art pick: the all-corner shading options, the Stage 0 asset round, a later exchange composition;
- adopting the world layout proposal;
- pushing, admitting a pull request, enabling previews, and the allowance check before a hosted run;
- any change to an approved value or scope;
- the newcomer test, which needs a person who hasn't seen the Floor;
- wallet administration authority, which is a Stage 3 matter.

## Order

| Phase | Workstreams | Notes |
| --- | --- | --- |
| First | The [cleanup plan](cleanup-plan.md): T; then D1, R and S; then K and W; then rebase and slim the remaining branches | Agreed 15 October; D1 moved ahead of K and W once A passed |
| Before the cleanup | A, C, I, F's audit and proposal, E's draft, B's analysis | Local results above |
| Integration | D1 inside the cleanup, then D2 after C, D3 after I, then D4 | The queued authentication task starts when D3 lands |
| Owner picks | B's options, then F's proposal | B can render once C's tooling is available |
| After the picks | B's production change, G, E's hosted run (with the owner's go-ahead), H | G uses single-post and desk views until F is adopted |
| Close | The owner's Stage 0 review | |

Browser slot priority: D, then A, C, B, E, F, G.

## Workstreams

### A. Renderer stream

Branch `codex/renderer-stream`. Done on 15 October at `f0310c9`; see the table above.

Prep run on 14 October, idle machine, default SwiftShader: `FLOOR_RENDERER_PORT=5183 bun run test:renderer testing/flows/renderer/snapshot-stream.spec.ts testing/flows/renderer/snapshot-phone.spec.ts`. The 12-desk stream and the three snapshot-stream checks passed. The 1,000-desk stream failed its 250 ms arrival bound in all four runs, with first late arrivals of 263.4, 273.8, 250.6 and 260.6 ms; a failed run doesn't report the later assertions. The logs are under `work/renderer-stream/prep-swiftshader-001/` and `-002/` in that worktree. Plain `bun run test:flow`, and therefore CI, fails on this branch.

1. Find where the 1,000-desk arrival delay comes from (snapshot construction, reconciliation or frame scheduling under 4× throttling) and meet the unchanged 16.7 ms CPU and 250 ms arrival limits on SwiftShader. Until that passes, integration remains blocked under the owner's 15 October decision. Don't relax the bound or change the default profile.
2. Done in prep (`a441f50`): open items for **World integration** and **Sustained stream on SwiftShader**, and plain-text paths instead of links to ignored logs. Still to do: call the measurement buffer-call accounting wherever "GPU upload" overstates it, and remove the SwiftShader item once the default run passes.
3. Keep the World integration item when updating the records; it carries the work the fixed-ID stream leaves open.
4. Decide, and record why, whether `trackUploads` stays in production. It currently wraps `bufferData` and `bufferSubData` on every production engine; the alternative is to move it behind diagnostics.
5. Check the reported change that `busy()` now includes `following`: after a finished fixed follow (the production follow button), queued presentations may not move the camera until the next input. Fix it or record it.
6. Add leaf tests for any part of `instances.ts` that doesn't need a browser; today it is covered only by browser tests.

**Done when:** the default `bun run test:flow` passes on an idle machine with the unchanged timing limits; the docs are corrected; and an independent source review has run.

### B. All-corner shading

Branch from `codex/asset-kit`, which carries the preflight and the approved-frame suite; rebase onto `main` after D2.

Prep analysis, not yet verified in a renderer: `colorFragment` in `apps/web/src/map/_lib/renderer/shaders.ts` gives a vertical face the light side tone when `dot(n.xz, normalize(vec2(-1, 1))) >= 0`. Faces toward −x or +z are light; faces toward +x or −z are dark. Each quarter turn shows two adjacent side directions:
- At the default corner they are +x (dark) and +z (light).
- The asset preflight reports both sides dark at turn 1, so the range passes but the sides can't be told apart.
- Turn 2 shows one of each.
- Turn 3 shows both sides light, which fails 2.5:1.

- **Option (a): room-fixed, no new colours.** Split side tones by axis rather than by half-plane, for example ±x dark and ±z light. Opposite faces then share a tone, and every quarter turn shows one dark side and one light side. For vertical faces in the default view this gives today's tones, so the approved frames should not change. Sloped or curved faces that tilt upward near a silhouette can change tone, so `test:approved` decides. Exact diagonal ties keep today's rule as a tie-break. The visible trade-off: whether the screen-left or screen-right side is dark alternates with each quarter turn.
- **Option (b): camera-relative.** Take the side tone from the view-space normal, so the same screen side is always dark. Every corner then matches the approved default corner, but a wall changes tone as the camera turns. This would replace the 12 Oct room-fixed rule.

1. Implement both options behind a development-only switch that production builds exclude.
2. Run `bun run preflight:assets` for all 24 model/theme/corner reports under each option, and `test:approved` under option (a).
3. Render the post, desk and approved-material scenes at all four corners, day and night, for each option.
4. Get an independent review, then build a blind sheet for the owner's pick.
5. Change production only after the pick, with the full sequence.

**Done when:** the owner has picked; the chosen rule is in production; all 24 preflight reports pass; and the seven approved frames are still pixel-exact (or any change has been shown to the owner and recorded).

### C. Asset kit before merging

Branch `codex/asset-kit`.

1. Put `test:approved` and `test:assets` into the required sequence, so the seven-frame pixel guard runs locally and in CI. Update `docs/Codex/verification.md` to match.
2. Run `bun run check:assets` byte-for-byte on Linux, in a container with Bun 1.4.0 and a frozen install. `bun run build` runs it in CI, and the models have only been built on macOS. If the bytes differ, make generation deterministic; don't loosen the comparison. Not done in prep, because the Docker daemon wasn't running.
3. Done in prep (`5edefdf`): a decision row recording the generated models as committed `SyntheticUnapproved` build outputs with authored budget ceilings, and the matching `assets` row in `docs/Codex/file-structure.md`.
4. Keep paper-contact contrast and raster line endings as open measurements, matching the look open item on `main`.
5. The kit hard-codes eight stations per post, while the world default is ten (8 to 12 allowed). Parameterise it, or record the mismatch for G. Correct the "45° intervals" wording, which assumes eight stations.
6. Leave the existing sheet and its captures as they are; the owner has returned it without a pick.

**Done when:** the branch passes the full sequence plus `test:assets` and `test:approved`, and the Linux result is recorded.

### D. Integration

Done on local `main`, in the order the decision sets. Expected conflicts from read-only merge simulations:

| Pair | Conflicting files |
| --- | --- |
| `main` (with the 14 Oct records) with renderer-stream or asset-kit | `docs/decisions.md`, `docs/stage-0.md` |
| `main` (with the 14 Oct records) with rpc-api | `docs/decisions.md` |
| renderer-stream with asset-kit | `docs/decisions.md`, `docs/stage-0.md` |
| asset-kit with rpc-api | root `package.json`, `docs/Codex/verification.md`, `docs/stage-0.md` |
| renderer-stream with rpc-api | `docs/stage-0.md` |

These merge cleanly as text but need a hand check: `apps/web/workbench/entry.ts` and `api.ts` (renderer-stream wraps every workbench run in its comparison submodel, and asset-kit changes camera selection and the look adapter), and the suppression budget, which should be the union of all entries. Regenerate `bun.lock` with `bun install`, then confirm `bun install --frozen-lockfile`. The 14 October edits on `main` also touch the open-items table that the branches edit. Keep the owner's rows, add the branches' facts, and keep A's World integration item.

1. **D1:** once the cleanup's T lands, rebase renderer-stream onto `main`, run the full sequence on the SwiftShader default with the unchanged limits, and merge. `main`'s decision rows win over the branch's 15 October integration row. Its slimming is W's.
2. **D2:** merge asset-kit after C. Run `test:assets`, `test:approved` and the workbench specs that `entry.ts`/`api.ts` affect.
3. **D3:** merge rpc-api after I. The queued authentication task starts from here; don't start a second one.
4. **D4:** run one combined verification with the browser slot held alone: frozen install, `format:check`, `typecheck`, `lint`, `test:leaf` (about 402 tests: 365 base + 26 C + 7 I + 4 A), `build`, `test:native`, `test:flow` (82 renderer checks in the current A tree, subject to further gate repairs), `test:assets` (6) and `test:approved` (7). B's option study and F's unadopted proposal are outside D1–D3. Then get an independent review of the decision log, the open items and Stage 0 for consistency.

**Done when:** one clean D4 run passes without a retry, and it is recorded in Stage 0 with its commands.

### E. Hosted check

Branch from `main`; rebase after D3.

1. Write a production-entry renderer flow in `testing/flows` that runs against `FLOOR_FLOW_URL`: the local Worker by default, the preview when remote. It checks that:
   - the map canvas mounts, with the renderer string recorded;
   - a drag moves the world and settles one Model/URL commit;
   - a quarter turn persists through the URL and a reload;
   - a click picks;
   - Escape goes up a rung;
   - on the phone viewport, touch moves the world without scrolling the page.
2. Add the flow to CI's preview step next to the shell flow, which now runs over RPC.
3. Prepare the run sheet from [the platform](platform.md#spending): allowance check, stage resource list, request budget, 30-minute cap, and teardown with inventory proof.

**Done when:** the flow passes locally against the local Worker and the run sheet is in `docs/platform.md`. Then stop at the owner gate for the push, admission and preview. After the hosted run, record the CI run links and the teardown proof.

### F. World layout

Branch from `main`. It edits `packages/contract` world layout and `packages/world`; none of the four branches touches those, apart from exchange-view's export.

1. Start from the [audit](#world-layout-audit) below and finish it for every rule.
2. Propose seeded integer rules: rooms of varied size and outline with side rooms, and posts off a lattice with a minimum clearance. Keep never-move, no overlap, reachability from the lobby, room-to-floor/chain mapping, fixed-point coordinates and bounded state.
3. Add property tests for those invariants, and a cross-engine coordinate comparison like the one in [Stage 1](stage-1.md).
4. Render one floor and 4, 8 and 12 floors at fixed cameras for the owner. Reuse the exchange-view harness if it helps.
5. Get an independent review. Adopt nothing before the owner reviews it.

**Done when:** the owner has reviewed the proposal. On adoption, update [Stage 1](stage-1.md), the technical design's defaults and the decision log.

### G. Stage 0 asset round

Starts after B's pick and D2.

1. Build one post with its stations (count as a parameter), one figure (posture and clothing as parameters, per the character decisions) and one token screen (emblem and a single price line, with labelled synthetic readings only).
2. Make each by both the three.js generator and SVG-profile routes, and compare them as [the look's step 6](look.md#the-steps) describes.
3. Show day and night at all four quarter turns, in single-post and desk views. Leave out multi-post floors until F is adopted.
4. Get an independent shortlist. The owner picks where the routes differ visibly.
5. Preserve picked frames with scoped briefs and add them to the approved-frame suite.

**Done when:** the owner's picks are recorded.

### H. Newcomer test

The owner arranges someone who hasn't seen the Floor. Show the render, then record their answers about what is going on and which agent is doing what, as observations. If nobody is available, record it as not run.

### I. RPC before merging

Branch `codex/rpc-api`.

1. Done in prep (`12b5399`): an **Authentication** open item. It names the token check the API row waits for (ES256 `CurrentOwner` verification with web and CLI claim shapes) and the public/owner group split the MCP adapter forces. The branch's Stage 0 record already says the hosted health proof predates RPC.
2. Remove `effect/http-api` from the unstable-API allowlist if nothing uses it.
3. The earlier admission check failed its three-second settlement check: the callback completed inside the request-free interval, but `SubmissionSettled` arrived 1,025 ms after its observation boundary. The retained log does not establish host load as the cause. I's new unchanged run passed, with callback completion after 313 ms and settlement after 646 ms; keep the failed evidence and recheck this promise in D4.

**Done when:** the corrections are committed and the branch passes the full sequence.

### The queued authentication task

It already exists, and it starts when rpc-api lands on `main`. Don't start a duplicate. It needs to know:
- The group split described in I.
- `jose` is present only through the Privy SDK, which is fenced out of production. A direct dependency needs a decision row; Web Crypto alone can verify ES256 with configured keys.
- The verifier must stay out of the web bundle.
- The sandbox claim shapes are observations, not documented guarantees.

## World layout audit

First pass on 14 October, comparing the current rules in `packages/contract/src/world.ts` with the picked [floor](../testing/reference/floor-day.png), [lobby](../testing/reference/lobby-day.png) and [building](../testing/reference/building-day.png) frames:

| Rule now | What it protects | The picked frames show | Disposition |
| --- | --- | --- | --- |
| Posts on a square spiral at spacing 8 | Fixed anchors that never move; new posts open at the edge | The floor has five or six posts at uneven spacing and offsets, none on a lattice; the lobby view shows three at different distances | Change: seeded placement off a lattice with a minimum clearance. Keep never-move and edge-first growth |
| Station rings at radius 2, evenly spaced | Fixed stations, identical on every engine | Stations ring each octagonal counter evenly | Keep; the post is a designed object. The count is unapproved (the kit has 8, the world default is 10) |
| A square floor sized for a full spiral plus one aisle | No overlap between full neighbours | A notched, stepped outline with side rooms: a file room with cabinets, an elevator alcove, a raised podium and bell behind a rail, a whiteboard wall | Change: rooms of varied size and outline, with side rooms; the fixed places sit at room edges |
| Floors on a grid one footprint apart, edges before corners | Compact growth, a shared wall with the lobby or an earlier floor, no movement | An L-shaped lobby whose wall opens onto the floor through doorways. The building frame's stacking is excluded; its density is kept | Change the grid. Keep shared walls, compactness, reachability from the lobby and never-move. The proposal states the new order |
| Exactly one blueprint floor at the next index | Bounded future state; nothing unused drawn as finished | Blueprint volumes beyond the occupied floors (filled volumes are excluded) | Keep |
| Fixed-point coordinates and integer arithmetic | Identical replay on every engine | — | Keep. Seeded variation uses integer rules |
| A fixed number of curated lobby plots (8 by default) | A plot count that can be curated | Plinths, a sculpture and an instrument placed irregularly around the hall | Keep the count; place plots by the same seeded rules |

## Closing Stage 0

Stage 0 can close when:
- D4 has passed on the integrated `main`;
- A's renderer acceptance is resolved, with the World integration items open for Stage 2;
- B's shading rule is picked and in production;
- G's assets are picked;
- H is run or recorded as not run;
- E's hosted check has passed with teardown proof;
- the owner has reviewed the decisions, the flows and the picked frames.

Deferred:
- World integration (live subscription, dynamic growth, snapshot replay): Stage 2.
- The building rung, level of detail and a new exchange composition: after F, before the building rung is drawn.
- The lobby, wall of screens, bell and podium, whiteboards, cabinets and the interface: Stage 2.
- Brass and engraving: when real instruments exist.
- Wallet administration authority, the sandbox proof, browser containment and live inference: Stage 3.
- Real-phone checks: at each milestone.
