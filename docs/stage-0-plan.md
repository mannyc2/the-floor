# Stage 0 plan

This orders the work left before Stage 0 can close. The [cleanup plan](cleanup-plan.md)'s T, R, S, K and W steps, renderer stream and RPC integration have landed locally; the remaining branches rebase onto that implementation and slim before integration. The [first trade plan](first-trade-plan.md) runs alongside Stage 0 under the owner's separate authorization. The [decision log](decisions.md) governs the renderer budgets, hosted check, look finish line, shading, returned asset sheet, rejected exchange compositions and world layout revision. Stage 0 stays open until every item in [Stage 0](stage-0.md#left) is done and verified and the owner has reviewed it.

## Where things stand

Local `main` includes the cleanup's T, R, S, K and W, D1's fixed-ID renderer stream, D3's RPC/MCP boundary, the unattached Privy owner middleware, E's production-entry camera flow, D2's slimmed asset kit and B's picked side-tone rule. It also includes the separate first-trade slice's durable world journal, isolated fork signer and bounded agent. These integrations approve neither art nor Stage 0. The live viewer's browser proof remains separate from its source review.

### Local execution — 14–15 October 2026

| Workstream | Current implementation | What remains |
| --- | --- | --- |
| A / D1 / W | Fixed-ID snapshots, moving-target follow and shared colour/identity geometry are integrated. Upload accounting and independent lifetime probes live in the workbench | The broader World integration open item and real-phone checks |
| C / D2 | Integrated: the post and station generators, the face-rule preflight, and the approved-frame and asset browser projects | The returned sheet remains unpicked; G builds the next round |
| I / D3 | Health RPC, scoped clients and the read-only MCP adapter are integrated. The obsolete HTTP-API allowance is removed | The existing authentication task; do not create a duplicate |
| B | Integrated: the owner picked camera-relative side tones on 16 Oct; production uses them, every corner passes, and the seven picked frames are unchanged | Nothing |
| E | The production-entry camera flow is in the `shell` project with the RPC/MCP shell flow, under one request budget; the run sheet is in the platform doc | The hosted run itself. Push, admission, preview and allowance remain owner gates |
| F | `codex/world-layout-proposal` holds the isolated seeded-layout proposal and cross-engine property checks | Owner adoption, including the minimum-spacing interpretation and fixed lobby. Production layout and Atlas values stay unchanged |
| G / H | Asset picks and newcomer observations remain open | G can start now that B and D2 have landed; the owner arranges H's new viewer |

Commands, results and failed evidence belong in commit or pull request bodies; raw logs and captures stay under ignored `work/` directories. F's proposal remains in its branch's `docs/world-layout-proposal.md` and its visual candidates under `work/world-layout-proposal/`. The rejected `codex/exchange-view` stays unmerged; its harness can inform F without adopting either composition.

## Rules for every session

- Read [AGENTS.md](../AGENTS.md) and the docs it lists for your area before starting.
- **One browser suite on the machine at a time.** Ask the orchestrator for the browser slot before `bun run e2e`, branch-local asset/frame suites, the shell flow or a headed demonstration, and release it when the run ends. Concurrent suites have caused timing failures and a phone-budget failure.
- Renderer ports: A 5183, E 5185, F 5186, G 5187, D 5198. The local shell Worker defaults to 19740; `FLOOR_WORKER_PORT` selects an isolated port without changing the browser-slot requirement.
- Never push, open a pull request, deploy, enable previews, call a provider or spend without the owner's authorization. The separate first-trade authorization permits only its runner's public read-only Solana RPC preparation; it grants no paid or credentialed provider access. Stop at the owner gates below.
- Never weaken a check, relabel a failure or switch a default profile to get a pass. Keep failed runs; put each result with its command in the commit body, and keep raw output in `work/<workstream>/`.
- Edit shared docs, root `package.json` and workbench entry points only on your own branch. Integration (D) assembles `main`, where the owner's current decisions win over older branch wording.
- No agent approves its own output. An independent review is a filter, not an approval.
- Report back with: branch and commit; each command and result, failures included; changes to shared files; questions for the owner.

## Owner gates

The renderer timing decision is resolved: arrival lateness is recorded, not asserted, and no longer blocks integration (15 October row). The deterministic stream budgets and the 16.7 ms CPU limit still apply to D1 and W.

Stop and ask the owner for:
- any art pick: the Stage 0 asset round, a later exchange composition;
- adopting the world layout proposal;
- pushing, admitting a pull request, enabling previews, and the allowance check before a hosted run;
- any change to an approved value or scope;
- the newcomer test, which needs a person who hasn't seen the Floor;
- wallet administration authority, which is a Stage 3 matter.

## Order

| Phase | Workstreams | Notes |
| --- | --- | --- |
| Landed | The [cleanup plan](cleanup-plan.md): T, R, S, K and W; D1's renderer stream and D3's RPC boundary | Remaining branches rebase and slim against this implementation |
| Prepared | F's audit and proposal, E's draft | Their branch records do not approve art or prove current integration |
| Integration | D4; D2 has landed | D3 has landed; the existing authentication task can proceed |
| Owner picks | F's proposal | B's shading pick is in production |
| After the picks | G, H | G uses single-post and desk views until F is adopted |
| Close | The owner's Stage 0 review | |

Browser slot priority: D, then A, E, F, G.

## Workstreams

### A. Renderer stream

Integrated through D1 and simplified by W. The renderer reconciles fixed known IDs, preserves moving-target follow, and shares one geometry pass for colour and identity. Production no longer wraps buffer calls for measurement; the workbench retains independent native upload observations and pure reconciliation checks.

The current default `bun run e2e` asserts every revision received and rendered, draw and triangle counts, buffer calls and bytes, no stable-frame uploads, and the 16.7 ms limit for each retained renderer CPU sample. Arrival lateness is reported without a merge assertion under the owner's replacement decision. Earlier failed runs remain evidence in the original worktree; they do not reinstate the retired 250 ms gate. The broader World integration open item remains.

### D. Integration

Only the orchestrator assembles local `main`. D1, D3 and the cleanup's T, R, S, K and W steps are integrated; the old branch-pair merge simulations no longer describe this tree. D2 has landed the slimmed asset kit with B's picked side-tone rule. Regenerate `bun.lock` only when dependencies change, then confirm `bun install --frozen-lockfile`. Keep the owner's decisions and the remaining World integration item.

1. **D1:** integrated, with its slimming completed in W. Retain the deterministic and CPU budgets and the owner's measurement-only arrival-lateness rule.
2. **D2:** integrated. `bun run e2e` includes its `approved` and `assets` projects, and `bun run test` its all-corner face-rule check.
3. **D3:** integrated ahead of D2 for the first-trade slice. The existing authentication task starts from here; don't start a second one.
4. **D4:** run one combined verification with the browser slot held alone: frozen install, `format:check`, `typecheck`, `lint`, `test`, `build`, `test:native` and `e2e`, including the `approved` and `assets` projects, plus `bun run preflight:assets`. Follow [the verification guide](Codex/verification.md) for current commands. F's unadopted proposal is outside D. Then get an independent review of the decision log, the open items and Stage 0 for consistency.

**Done when:** one clean combined D4 run passes without a retry, with commands and results in the integration commit or pull request body and earlier failed evidence retained. This does not close the owner gates.

### E. Hosted check

The production-entry camera flow, `testing/flows/production-renderer.spec.ts`, runs in the `shell` project against `FLOOR_FLOW_URL`: the local Worker by default, the preview in CI's preview step. It records the renderer string, and checks that a drag moves the world and settles one URL/history commit, that a quarter turn persists through the URL and a reload with identical pixels, that Escape goes up a rung, that phone touch moves the world without scrolling, and that a click picks the seeded synthetic desk and opens its labelled drawer. A `pr-<n>` stage seeds that world through its test-built seed Worker before the flow. The [run sheet](platform.md#hosted-renderer-run-sheet) gives the resources, budget, 30-minute cap and teardown.

**Done:** [PR #2](https://github.com/mannyc2/the-floor/pull/2)'s preview passed these flows and its teardown was verified; the run links and inventory are in the pull request.

### F. World layout

Branch from `main`. It edits `packages/contract` world layout and `packages/world`; reconcile those changes with the integrated live-world fold while preserving its identity and checkpoint invariants.

1. Start from the [audit](#world-layout-audit) below and finish it for every rule.
2. Propose seeded integer rules: rooms of varied size and outline with side rooms, and posts off a lattice with a minimum clearance. Keep never-move, no overlap, reachability from the lobby, room-to-floor/chain mapping, fixed-point coordinates and bounded state.
3. Add property tests for those invariants, and a cross-engine coordinate comparison like the one in [Stage 1](stage-1.md).
4. Render one floor and 4, 8 and 12 floors at fixed cameras for the owner. Reuse the exchange-view harness if it helps.
5. Get an independent review. Adopt nothing before the owner reviews it.

**Done when:** the owner has reviewed the proposal. On adoption, update [Stage 1](stage-1.md), the technical design's defaults and the decision log.

### G. Stage 0 asset round

B's pick and D2 have landed, so it can start.

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
