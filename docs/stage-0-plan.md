# Stage 0 plan

This orders the work left before Stage 0 can close. The [cleanup plan](cleanup-plan.md)'s T, R, S, K and W steps, renderer stream and RPC integration have landed locally; the remaining branches rebase onto that implementation and slim before integration. The [first trade plan](first-trade-plan.md) runs alongside Stage 0 under the owner's separate authorization. The [decision log](decisions.md) governs the renderer budgets, hosted check, look finish line, shading, returned asset sheet, rejected exchange compositions and world layout revision. Stage 0 stays open until every item in [Stage 0](stage-0.md#left) is done and verified and the owner has reviewed it.

## Where things stand

Local `main` includes the cleanup's T, R, S, K and W, D1's fixed-ID renderer stream, D3's RPC/MCP boundary, the unattached Privy owner middleware and E's production-entry camera flow. It also includes the separate first-trade slice's durable world journal, isolated fork signer and bounded agent. These integrations approve neither art nor Stage 0. The live viewer's browser proof remains separate from its source review.

### Local execution — 14–15 October 2026

| Workstream | Current implementation | What remains |
| --- | --- | --- |
| A / D1 / W | Fixed-ID snapshots, moving-target follow and shared colour/identity geometry are integrated. Upload accounting and independent lifetime probes live in the workbench | The broader World integration open item and real-phone checks |
| C / D2 | `codex/asset-kit` holds the unmerged generators, preflight and approved-frame suites | Rebase and slim after cleanup, preserve deterministic generation, then integrate. The returned sheet remains unpicked |
| I / D3 | Health RPC, scoped clients and the read-only MCP adapter are integrated. The obsolete HTTP-API allowance is removed | The existing authentication task; do not create a duplicate |
| B | `codex/shading-options` holds the independently filtered option study and blind sheets | Owner shading pick, then the chosen rule and its checks on the integrated implementation |
| E | The production-entry camera flow is in the `shell` project with the RPC/MCP shell flow, under one request budget; the run sheet is in the platform doc | The hosted run itself. Push, admission, preview and allowance remain owner gates |
| F | `codex/world-layout-proposal` holds the isolated seeded-layout proposal and cross-engine property checks | Owner adoption, including the minimum-spacing interpretation and fixed lobby. Production layout and Atlas values stay unchanged |
| G / H | Asset picks and newcomer observations remain open | G waits for B's pick and D2; the owner arranges H's new viewer |

Commands, results and failed evidence belong in commit or pull request bodies; raw logs and captures stay under ignored `work/` directories. B's blind sheets remain in its `work/shading-options/blind-review/`, with the option mapping separate until the owner's pick. F's proposal remains in its branch's `docs/world-layout-proposal.md` and its visual candidates under `work/world-layout-proposal/`. The rejected `codex/exchange-view` stays unmerged; its harness can inform F without adopting either composition.

## Rules for every session

- Read [AGENTS.md](../AGENTS.md) and the docs it lists for your area before starting.
- **One browser suite on the machine at a time.** Ask the orchestrator for the browser slot before `bun run e2e`, branch-local asset/frame suites, the shell flow or a headed demonstration, and release it when the run ends. Concurrent suites have caused timing failures and a phone-budget failure.
- Renderer ports: A 5183, C 5181, B 5184, E 5185, F 5186, G 5187, D 5198. The local shell Worker defaults to 19740; `FLOOR_WORKER_PORT` selects an isolated port without changing the browser-slot requirement.
- Never push, open a pull request, deploy, enable previews, call a provider or spend without the owner's authorization. The separate first-trade authorization permits only its runner's public read-only Solana RPC preparation; it grants no paid or credentialed provider access. Stop at the owner gates below.
- Never weaken a check, relabel a failure or switch a default profile to get a pass. Keep failed runs; put each result with its command in the commit body, and keep raw output in `work/<workstream>/`.
- Edit shared docs, root `package.json` and workbench entry points only on your own branch. Integration (D) assembles `main`, where the owner's current decisions win over older branch wording.
- No agent approves its own output. An independent review is a filter, not an approval.
- Report back with: branch and commit; each command and result, failures included; changes to shared files; questions for the owner.

## Owner gates

The renderer timing decision is resolved: arrival lateness is recorded, not asserted, and no longer blocks integration (15 October row). The deterministic stream budgets and the 16.7 ms CPU limit still apply to D1 and W.

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
| Landed | The [cleanup plan](cleanup-plan.md): T, R, S, K and W; D1's renderer stream and D3's RPC boundary | Remaining branches rebase and slim against this implementation |
| Prepared | C, F's audit and proposal, E's draft, B's options | Their branch records do not approve art or prove current integration |
| Integration | D2 after C; then D4 | D3 has landed; the existing authentication task can proceed |
| Owner picks | B's options, then F's proposal | B can render once C's tooling is available |
| After the picks | B's production change, G, E's hosted run (with the owner's go-ahead), H | G uses single-post and desk views until F is adopted |
| Close | The owner's Stage 0 review | |

Browser slot priority: D, then A, C, B, E, F, G.

## Workstreams

### A. Renderer stream

Integrated through D1 and simplified by W. The renderer reconciles fixed known IDs, preserves moving-target follow, and shares one geometry pass for colour and identity. Production no longer wraps buffer calls for measurement; the workbench retains independent native upload observations and pure reconciliation checks.

The current default `bun run e2e` asserts every revision received and rendered, draw and triangle counts, buffer calls and bytes, no stable-frame uploads, and the 16.7 ms limit for each retained renderer CPU sample. Arrival lateness is reported without a merge assertion under the owner's replacement decision. Earlier failed runs remain evidence in the original worktree; they do not reinstate the retired 250 ms gate. The broader World integration open item remains.

### B. All-corner shading

Branch from `codex/asset-kit`, which carries the preflight and the approved-frame suite; rebase onto `main` after D2.

The original analysis and the isolated option study need to be reconciled with the cleaned renderer before production changes. Its room-fixed rule gives a vertical face the light side tone when `dot(n.xz, normalize(vec2(-1, 1))) >= 0`. Faces toward −x or +z are light; faces toward +x or −z are dark. Each quarter turn shows two adjacent side directions:
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

Branch `codex/asset-kit`. Rebase and slim it against the cleanup before D2; the previous branch checks do not establish the rebased result.

1. Put `test:approved` and `test:assets` into the required sequence, so the seven-frame pixel guard runs locally and in CI. Update `docs/Codex/verification.md` to match.
2. Recheck `bun run check:assets` byte-for-byte on Linux, with Bun 1.4.0 and a frozen install, after rebasing the generator. Preserve its required CI check. If the bytes differ, make generation deterministic; don't loosen the comparison.
3. Apply the cleanup's artifact rule: generated candidates stay under ignored `work/`, code and data hold plain values, and only owner-picked frames enter `testing/reference/`. Replace the branch's older committed-model and approval-tag records with the current ownership boundary.
4. Keep paper-contact contrast and raster line endings as open measurements, matching the look open item on `main`.
5. The kit hard-codes eight stations per post, while the world default is ten (8 to 12 allowed). Parameterise it, or record the mismatch for G. Correct the "45° intervals" wording, which assumes eight stations.
6. Leave the existing sheet and its captures as they are; the owner has returned it without a pick.

**Done when:** the branch passes the full sequence plus `test:assets` and `test:approved`, and the Linux result is recorded.

### D. Integration

Only the orchestrator assembles local `main`. D1, D3 and the cleanup's T, R, S, K and W steps are integrated; the old branch-pair merge simulations no longer describe this tree. D2 must reconcile workbench entry points, verification scripts and docs with the current implementation. Regenerate `bun.lock` only when dependencies change, then confirm `bun install --frozen-lockfile`. Keep the owner's decisions and the remaining World integration item.

1. **D1:** integrated, with its slimming completed in W. Retain the deterministic and CPU budgets and the owner's measurement-only arrival-lateness rule.
2. **D2:** merge asset-kit after C. Run `test:assets`, `test:approved` and the workbench specs that `entry.ts`/`api.ts` affect.
3. **D3:** integrated ahead of D2 for the first-trade slice. The existing authentication task starts from here; don't start a second one.
4. **D4:** run one combined verification with the browser slot held alone: frozen install, `format:check`, `typecheck`, `lint`, `test`, `build`, `test:native` and `e2e`, plus the asset and approved-frame guards when D2 lands. Follow [the verification guide](Codex/verification.md) for current commands. B's option study and F's unadopted proposal are outside D1–D3. Then get an independent review of the decision log, the open items and Stage 0 for consistency.

**Done when:** one clean combined D4 run passes without a retry, with commands and results in the integration commit or pull request body and earlier failed evidence retained. This does not close the owner gates.

### E. Hosted check

The production-entry camera flow, `testing/flows/production-renderer.spec.ts`, runs in the `shell` project against `FLOOR_FLOW_URL`: the local Worker by default, the preview in CI's preview step. It records the renderer string, and checks that a drag moves the world and settles one URL/history commit, that a quarter turn persists through the URL and a reload with identical pixels, that Escape goes up a rung, and that phone touch moves the world without scrolling. Production shows a pick only in a live world's drawer, which a preview has no world for, so picking stays with the local first-trade flow. The [run sheet](platform.md#hosted-renderer-run-sheet) gives the resources, budget, 30-minute cap and teardown.

**Left:** the owner gate for the push, admission and preview, then the hosted run, with its CI run links and teardown proof in the run's commit or pull request.

### F. World layout

Branch from `main`. It edits `packages/contract` world layout and `packages/world`; reconcile those changes with the integrated live-world fold while preserving its identity and checkpoint invariants.

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

D3 integrated the RPC/MCP implementation and removed the unused `effect/http-api` allowance. The **Authentication** open item remains: ES256 `CurrentOwner` verification with web and CLI claim shapes, and a separate owner group because the public MCP adapter cannot carry its middleware. The historical hosted health proof predates RPC. D4 retains the native admission and settlement check; its earlier failed evidence remains with the original branch records.

### The queued authentication task

It already exists, and D3 is now integrated on `main`. Don't start a duplicate. It needs to know:
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
- A's renderer acceptance remains verified, with the broader World integration items explicitly open;
- B's shading rule is picked and in production;
- G's assets are picked;
- H is run or recorded as not run;
- E's hosted check has passed with teardown proof;
- the owner has reviewed the decisions, the flows and the picked frames.

Deferred:
- Broader World integration (moving world events, navigation across occupied floors and snapshot replay): beyond the bounded first-trade viewer. The durable live subscription and single-floor mapping belong to the separately authorized first-trade slice.
- The building rung, level of detail and a new exchange composition: after F, before the building rung is drawn.
- The lobby, wall of screens, bell and podium, whiteboards, cabinets and the interface: Stage 2.
- Brass and engraving: when real instruments exist.
- Wallet administration authority, the sandbox proof, browser containment and live inference: Stage 3.
- Real-phone checks: at each milestone.
