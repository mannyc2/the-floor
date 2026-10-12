# The Floor: what the first build taught us

Oct 12, 2026

The first build of the Floor finished on 12 October. This doc puts the owner's critique (`CRITIQUE.md`) together with an audit of the code. The audit had six parts: package structure, the map and interface, chains and wallets, engineering health, and research on launchpads and on wallet providers. Each finding gives its evidence and the doc change it caused. The revised product doc, technical design and archive sit beside this file; the 11 October originals are unchanged in `docs/floor-archive-2026-10-11(1).zip`.

Paths are relative to the project root. Facts about the outside world were checked on 12 October 2026, and the ones that couldn't be checked are listed at the end.

## The short version

- **The engineering is in good shape, but only because it was retrofitted.** Every check passes in under 15 seconds. Getting there cost 1,137 lint errors and 68 type errors on code that was already written, and about three hours of churn.
- **The map is a third of a dashboard, and it isn't the map that was imagined.** On a desktop the map gets 34% of the screen, and on a phone 16%. Thirteen of the fourteen markets are the same box. The camera's vertical drag is inverted, zoom ignores the cursor, and clicking a market doesn't move the camera.
- **No agent can trade a market it researched.** Research reads Base mainnet (8453), while signing accepts only Base Sepolia (84532). The only trade ever executed is on a local Anvil chain in a test.
- **One EVM chain is wired through everything.** Schemas, history keys, signing, contracts and the interface all assume it. Base had about 2% of memecoin launchpad fees in the week of 6 October; Solana had 59%.
- **The launchpad and the wallet layer were both built by hand, and neither reached the real world.** The curve graduates into a three-line test pool. Sign-in needs a browser extension, and the interface shows chain ids, addresses and ETH amounts.
- **The package list was copied from the doc, not earned.** `settings` has no production importer, and `research` has one live function. Meanwhile the real district, agent and signing logic sits in a flat `server` package.
- **Cloudflare and Alchemy were dropped without a decision.** No Worker, Durable Object or `alchemy.run.ts` exists. Nothing records why.
- **Several flows pass without proving their promise.** They set the value they assert, recompute the expectation with the code under test, or skip the production path.
- **Agents were built as researchers, not as capable agents.** The docs called research an agent's most useful output and reading its job. The build's agent was "a read-only market researcher" with only reading tools.
- **Most of these trace back to the docs, not to the build.** The docs ranked the look last and called it cheap, made research the agent's purpose, and set "Base alone" as the default. They prescribed an in-house foundry and extension-era wallets, listed packages instead of a rule for packages, and never made infrastructure a checkbox. They also left out acceptance criteria for flows and for the look.

## What held up

These parts are worth carrying into the next build:

- **The honesty model.** The policy sits outside the model, every action leaves a receipt, there is a single orange part, brass means data, and synthetic data can't reach the map. None of this was in question; the build just didn't reach most of it.
- **The engineering standards, once they were in.** Type-aware Oxlint with Effect presets fails on warnings. TypeScript runs strict with about 90 Effect diagnostics as errors. Custom import fences live in `scripts/lint/plugin.ts`. Source has no casts and no `async`, and Effect runs only at four entry points.
- **Several good Effect patterns:**
  - `packages/markets/src/runtime.ts:83-105`: a cache that keeps only successes and falls back to retained history with an honest label.
  - `packages/signing/src/execution.ts:6-38`: distinct error types, including `TransactionOutcomeUnknown`.
  - `testing/flows/_fixtures/anvil.ts:47-80`: Anvil as a scoped child process.
  - `packages/frontend/src/scene.ts:48-56`: the renderer mounted with `acquireRelease`.
- **The launch-and-lock flow.** This is the strongest flow. Real Solidity runs on Anvil, and the lock holds against a direct transfer, `transferFrom` and a sale back to the curve.
- **The bench harness.** It drives the real renderer in real Chrome, with readings decoded by the contract. It needs a phone profile (finding 12), not a rewrite.
- **The policy check and receipt journal** in `packages/signing/src/policy.ts` and `execution.ts`. This is the part of signing that stays ours whatever the wallet provider.

## Findings

### 1. The look was ranked last, and it isn't cheap

> "basically everything user-facing is ugly and bad" · "the map is terribly ugly and nothing like we imagined — individual assets are bad but also as a whole"

**What the audit found:**
- **The world.** It is one rectangular slab with five piers, two sheds and a lighthouse (`packages/renderer/src/layout.ts:195-279`). Markets sit on a square spiral grid (`:601-618`). There is no sea, bridge, district, gate, market hall, plinth, logo, heartbeat, thread or pin.
- **The markets.** Thirteen of the fourteen are stalls drawn from one merged box (`packages/kit/src/index.ts:70-84`).
- **The readings can't be read.** Every level is `value / 10^ceil(log10 value)` (`layout.ts:191`), so a level wraps at each power of ten: 9,999 shows full and 10,001 shows 10%.
- **Orange.** It is a post planted beside the machine (`layout.ts:380, 433, 509, 533, 566`), not the pour or the drained tray. It passes the one-orange count and misses the meaning.
- **Brass.** It is a 0.13-unit bar that appears only at full machine detail, so the default view shows none.
- **Shading and lines:**
  - The four tones run from `#c9c4b8` to `#ffffff` on a `#f4f1ea` ground, which bleaches the map.
  - Edges are detected by an angle threshold that every facet of a 16-sided cylinder exceeds, so the lighthouse renders as barcode stripes.
  - Lines are one device pixel at 66% opacity: grey, and half a CSS pixel on a retina screen.
- **The kit.** Six shapes and eight materials. There is no glass, stone, brick, timber or enamel, so island traditions can't be drawn.
- **No assets at all.** The repo has no glTF or textures. Nothing references the key frames or image prompts. The whole world is about 470 lines of box and cylinder calls.

**Why it happened:**
- **The technical design called the look cheap.** It said "A machine's look is local by comparison: an ugly design gets redrawn and nothing else notices", and put "Content and polish" last.
- **There was no visual target.** The key frames were text prompts, and the "first renders" the doc learned from weren't included. The design system's renders are interface component previews, which is a kit for a dashboard.
- **Every rule was a prohibition.** The build obeyed all of them and was still bare.
- **Verification measured what was specified and nothing else.** Screenshots were saved as "proof" and never compared, and the milestone's newcomer test was never run.
- **No artist was in the loop.** The defaults assume one ("The Floor's artists draft it").

**Doc changes:**
- **Technical design, The order of work:** the look is architecture and comes second, after contracts.
- **Technical design, rendering:**
  - The look, as acceptance: reference frames, side-by-side comparisons, a person's sign-off and the newcomer test.
  - Assets: modelled housings, stalls, landmarks and figures, with sockets for procedural instruments, and a 64-pixel thumbnail test.
  - The renderer: a screen-space edge pass and tones tuned against frames.
- **Technical design, Designs as data:** housings, and a declared scale for every reading.
- **Product doc:** what the first build taught us, new common failures, and the Reference foundation.

### 2. Too much interface, not enough map

> "too much ui frontend wise and not enough reliance on the map — a search button on the maps not a bad idea tho"

**What the audit found:**
- **Desktop.** At 1440×900 the canvas is 1004×440, 34% of the viewport, starting 306 pixels down. Above it sit:
  - a 78-pixel masthead;
  - a 54-pixel navigation row with five tabs, search and a plate button;
  - a heading with a breadcrumb;
  - a lens bar.

  To its right is a 344-pixel "instrument record" panel. Below it are a legend, three stat tiles, a timeline and a footer.
- **Phone.** The map is 366×365 on a page 2,226 pixels tall: 16% of it.
- **Other pages.** There are seven full pages off the map: desk, research, foundry, tide, community, settings and plates. There are also six modals.
- **Duplication.**
  - Price history appears three times: the panel sparkline, the timeline and the tide gauge.
  - Reserves appear as a table of numbers, which is exactly what the brass instruments were meant to show.
  - The desk is a form page, not a drawn desk.
- **Search** sits in the navigation bar, and its results don't move the camera.

**Why it happened.** The product doc described "Three views" as features without saying where they live or how much of the screen the interface may take. Each feature became a page or a tab.

**Doc changes:**
- **Product doc:** "One screen: the map", with the four corners, a floating search, one drawer and what lives off the map. Model idea 8: the map is the interface.
- **Technical design, The screen:** the screen budget, at most three off-map pages, no duplicated numbers, and the map share of the screen as a target.

### 3. The camera

> "camera controls suck"

**What the audit found** (★ = confirmed in the running app):
- ★ **Vertical drag is inverted.** The grabbed point isn't kept under the cursor: it is recorded at `packages/renderer/src/index.ts:534` and never used.
- **Dragging lags.** A drag only sets a target that the camera eases toward over 90 ms, and releasing has no inertia.
- ★ **Wheel zoom centres on the view, not the cursor.** Two-finger trackpad scrolling zooms instead of panning.
- **No pinch zoom.** Only one pointer is tracked. On a phone, a finger on the map pans it inside a long scrolling page.
- ★ **Clicking a market or a search result doesn't move the camera.**
  - Selection only redraws an outline (`packages/frontend/src/model.ts:104-111`).
  - "Follow the current" pulls the camera back every ten seconds even after the user has panned away.
- **No glide between views.** Every page change replaces the canvas, and ★ the camera resets when you come back.
- **Panning and settings changes stall.** Panning across a grid cell rebuilds the whole scene, and so does changing lens, theme or explode.
- **The frame-time counter never resets.** Once its running average passes 20 ms, detail drops for good.

**Why it happened.** The docs specified the projection (orthographic, 30°) and nothing about interaction. The renderer is a single closure with about 40 mutable variables (`index.ts:100-826`), so the camera can't be isolated or tested.

**Doc changes:**
- **Technical design, The camera:** nine rules (grab, release, zoom, bounds, flight, up a rung, links, following, phone), each with a pass condition tested in the running app.
- **Product doc:** "Moving around".
- **Technical design, Standards:** imperative code is a scoped resource behind a service.

### 4. One chain, hard-coded

> "we should of planned to support more than one chain at start. solana, base, robinhood. it can be decided by where memecoins are most popular atm"

**What the audit found:**
- **The contract's chain types are dead.** It defines `Chain`, `Token`, `District` and `Market` schemas (`packages/contract/src/index.ts:475-505`), but nothing imports them. The only reader is `BaseChain`.
- **Chain ids are literals throughout:**
  - `Schema.Literal(8453)` for provenance (`packages/markets/src/types.ts:4`);
  - `Schema.Literal(84532)` in the signing protocol;
  - `[84532, 31337]` in policy (`packages/signing/src/policy.ts:88`);
  - and the same in the executor, account context, note positions, foundry and application.
- **Identifiers are EVM regexes.** `Hex`, `Address` and `TransactionHash` are `0x` patterns (`contract/src/index.ts:4-9`). These feed proposals, receipts, readings, evidence, sources, elections, events, plates, the policy's contract allowlist and sign-in.
- **History can't hold two chains.** It is keyed on a bare `blockNumber INTEGER PRIMARY KEY` (`packages/server/src/sqlite-store.ts:37-38`), so two chains would overwrite each other.
- **Block time is assumed.** Flow windows multiply by 2 seconds per block, and capture assumes 1,800 blocks an hour.
- **The extent of the work:**
  - Robinhood Chain would be a mechanical change across about 15 files.
  - Solana would need a rewrite of the contract identifiers and the markets package, and nothing in signing or foundry carries over.

**What the data says.** These are launchpad fees by chain, from DefiLlama, for the week of 6 October. Fees are a proxy for activity:

| Chain | Share |
| --- | --- |
| Solana | 59% |
| BNB Chain | 25% |
| Robinhood Chain | 13% (67% at its peak, 1–7 September) |
| Base | 2% |

Fomo's own fees split over the last 30 days as:

| Chain | Share |
| --- | --- |
| Solana | 53.5% |
| Robinhood Chain | 27% |
| BSC | 7% |
| Base | 2% |

Robinhood Chain's boom is fading fast: Pons's weekly fees fell from $52.5M at the peak to $3.5M, and the chain's 90-day gas subsidy ended on 29 September.

**Doc changes:**
- **Technical design, Identifiers:**
  - CAIP chain, account and asset refs, a transaction ref, and a checkpoint (block or slot) replacing every bare block number.
  - History keyed by chain and height and ordered by time.
  - No `0x` patterns outside an adapter.
- **Defaults:** islands at launch are Solana, Robinhood Chain and Base, rechecked against activity at each stage, with BNB Chain next.
- **Product doc, Which chains first?:** changed from "Base alone".
- **First milestone:** proves Solana and one EVM island together, so the chain-neutral contract is real from the start.

### 5. Research and trading on different chains

**What the audit found.** Agents research Base mainnet markets, but policy refuses anything that isn't on Sepolia (`policy.ts:80-91`), so every real proposal is refused on "Allowed chain". `docs/scoped-accounts.md:40` admits the mismatch. The trade-with-a-receipt flow researches the Base recording and trades on chain 84532.

**Why it happened.** The milestone said "one agent on a testnet", and testnets have no real memecoin markets.

**Doc change.**
- **Technical design, Agents act on the chain they read:** mainnet forks at a pinned checkpoint, with Anvil for EVM chains and Surfpool for Solana.
- **The trade flow:** it now asserts that the agent trades the same market it studied.

### 6. An in-house launchpad

> "instead of writing our own foundry theres likely 'create your own launchpad' helpers for each chain"

**What the audit found:**
- **`FloorCurve.sol`** is a virtual-ETH curve with no fees.
  - Graduation only calls an `IGraduationPool.seed` interface, and the test pool is three lines that hold the funds.
  - Anyone can call `graduate()`, and buys aren't capped at the threshold.
  - Price is read from `balanceOf`, so tokens donated to the curve move it.
- **The cooling-off period is fixed in code.** It is hard-coded to seven days in `FloorToken.sol:23`, and rate limits are hard-coded in `FloorFoundry.sol:32-34`. The docs promised settings that change without a rebuild.
- **Launched coins never appear on the map.** Nothing indexes `Cast`, `Bought` or `Graduated`.
- **Some TypeScript is dead.** `curveBuy`, `curveSell`, `allocationCanTransfer` and `voteResult` are copies of the Solidity used only by their own test.

**What the research found:**
- **Meteora's Dynamic Bonding Curve on Solana** covers partner fees (80% of trading fees, split between partner and creator), anti-sniper fee schedules, `lockedVesting` with a cliff from migration, LP locks, automatic migration into DAMM v2, and state reads. Use its 2.0 SDK, due 16 October with breaking changes.
- **Doppler on EVM chains** is one SDK covering Base and Robinhood Chain, with vesting and integrator fee shares. Clanker v4 is the fallback.

**Doc changes:**
- **Product doc, The foundry:** the foundry runs on each chain's launchpad protocol, and "No quiet selling" now relies on the protocol's lock plus the policy.
- **Technical design:** a launchpad adapter per protocol, and launches through the signing service to the protocol. Launch limits are settings, never constants.
- **Defaults:** Meteora on Solana, Doppler on EVM islands.

### 7. Wallets: extension-only, crypto everywhere

> "we should have researched different wallet providers. ideally we can abstract away crypto ui ux … make it feel like you just use a credit card or some 'credits'/balance"

**What the audit found:**
- **Sign-in needs a browser extension.** It requires an injected `window.ethereum` (`packages/frontend/src/_lib/wallet.ts:5-13`). The server verifies EOA signatures only (`packages/server/src/auth.ts:86`), so passkey and smart wallets would fail.
- **There is no funding flow.** Scoped accounts need the owner to deploy their own smart account and session module on Base Sepolia, and the signing service itself isn't in the repo.
- **The interface shows the crypto:**
  - "Connect owner wallet";
  - raw `0x` addresses;
  - "Allowed contract addresses 0x…" and "Allowed methods";
  - slippage in basis points;
  - "Base Sepolia testnet ETH";
  - "Base Sepolia · 84532";
  - basescan links.
- **The model writes raw calldata.** It outputs whole proposals, including a contract address, method and chain id (`packages/agents/src/runtime.ts:40`).

**What the research found:**
- **Privy** gives login by email, social or passkey, embedded wallets on Solana and EVM chains, policies on both, gas sponsorship, and card, Apple Pay and bank funding through Stripe and Bridge. It is owned by Stripe, and Fomo runs on it.
- **Privy's two-of-two session signer** pairs the agent's key with the Floor's signing service, so neither can move funds alone. That keeps the non-custodial claim.
- **What stays with the Floor.** Privy's rules can enforce allowed programs, a cap per trade and allowed recipients. They can't total spending over time on Solana, or express a daily loss or position limit. Those stay in the signing service.
- **Turnkey's delegated access** is the fallback, with the user as the only root. Moonshot uses it.

**Doc changes:**
- **Product doc:** "Money in and out" (sign in, add money, fund an agent, withdraw, an advanced view for the crypto), model idea 9, guardrails, and defaults.
- **Technical design, The signing service:**
  - The service is rewritten as the second key.
  - Fixed limits are enforced by the provider and limits that need state by the service.
  - A signer with no quorum or no rules is refused.
- **Technical design, data model:** action intents in dollars and assets, with adapters, not the model, writing transactions.
- **Defaults:** Privy, with Turnkey as the fallback.

### 8. Packages: a list instead of a rule

> "too many packages and poor utilization of them … folder structure is poor for the ones we heavily utilize" · "we should have an 'apps' split with packages"

**What the audit found:**
- **The fourteen packages aren't packages.** None has a `package.json`; they are tsconfig path aliases re-declared by hand in `scripts/build-paths.ts`.
- **`docs/Codex/file-structure.md` just lists them,** copied from the technical design.
- **Export usage, counting production code only:**

  | Package | Production importers | Exports used | Notes |
  | --- | --- | --- | --- |
  | `settings` | 0 | 0/9 | |
  | `research` | 1 | 1/9 | |
  | `districts` | — | 5/16 | The planned Voronoi layout was never wired in |
  | `agents` | — | 5/20 | `privacy.ts` is dead |
  | `foundry` | — | 3/13 | |
  | `contract` | — | 44/55 | The chain, district, token and market types are unused |

- **The real logic lives in `server`.** It has 22 flat files:
  - the district object is in `server/atlas.ts`, the tier algorithm in `server/district-tiers.ts`, and placement in `renderer/layout.ts`;
  - `application.ts` injects 13 services and handles 18 action variants in one 590-line generator;
  - `store.ts` holds repositories for 13 tables, and `sqlite-store.ts` holds every domain's migrations.
- **Duplication:**
  - `MarketKind` is defined three times.
  - Three separate viem clients read the chain.
  - three.js leaks into the server bundle through `gate/geometry.ts`.
- **Tests reach across packages.** They import server internals by relative path 46 times, and domain tests import flow fixtures.

**Why it happened.** The technical design listed packages by domain before any code existed, and the build honoured the list.

**Doc changes:**
- **Technical design, The repo: apps and packages:**
  - `apps/web`, `apps/floor` and `apps/signer`.
  - Five packages: `contract`, `chains`, `wallets`, `atlas` and `policy`.
  - The rule: a package exists only if two apps import it or a fence needs it, and is deleted if nothing in production imports it.
- **Technical design, Where it lives:** tests reach other code only through `testing` exports.
- **Technical design, Fences:** bundles are checked, three.js is allowed only in `apps/web`, and apps never import each other.

### 9. Cloudflare and Alchemy dropped without a decision

> "alchemy seems completely unused depsite being planned?"

**What the audit found:**
- **None of the planned infrastructure exists:** no `alchemy.run.ts`, `stacks/`, wrangler config, Worker or Durable Object.
- **What actually runs** is one Bun process with SQLite. Agents are in-process fibres, and districts are one in-memory PubSub.
- **Signing runs in-process**, so the "separate Worker with no model" is reduced to a lint rule.
- **Leftovers:**
  - `.gitignore` still lists `.alchemy/` and `.wrangler/`.
  - `@cloudflare/workers-types` pollutes the globals.
  - `--external=cloudflare:workers` is dead build configuration.
- **CI has no deploy, preview stage or teardown.**
- **Agents aren't always on.** They run only when the owner clicks, because there are no Durable Object alarms (`packages/server/src/application.ts:376-392`).

**Why it happened.** The milestone's checklist had no infrastructure item, though its "done" condition needed a preview stage, so the stage was never built.

**Doc changes:**
- **Technical design, Effect and CAFE:** the stack is deployed from the first day, and Browser Rendering is named as the headless renderer.
- **Stage 0:** `alchemy.run.ts` and a stage per pull request.
- **Principles, Deviations are written down:** any substitution is logged first.
- **Defaults:** infrastructure is a provider whose change needs a decision-log entry.

### 10. Standards arrived after the code

> "initially i had to do a lot of work in ensuring proper effect usage, engineering standards — i think it helped a lot"

**What the audit found** (from the build logs in `imp-2/work/`):
- **Turning on strict checks** found 1,137 lint errors across 282 rules, plus 68 type errors, all on code already written.
- **Over about three hours,** typecheck ran 35 times (24 failed) and lint ran 23 times (13 failed).
- **Checks ran in the wrong order.** End-to-end tests ran before the typecheck and crashed on an error the typecheck reported 14 seconds later.
- **Formatting was enforced late,** producing a 6.6 MB diff.
- **The rules kept moving.** The rule count grew from 282 to 392 mid-build, and the typecheck command switched compilers.
- **The agent guessed Effect 4 APIs that don't exist,** such as `Encoding` and `Data.struct`.
- **Problems that remain:**
  - All 18 production error types carry only a message, and 15 catch sites throw away the cause.
  - The contract has 45 nullable fields, costing 84 manual `Option` conversions.
  - Times pass as ISO strings, and a bad one silently stops a receipt from ever expiring (`policy.ts:290-299`).
  - Approval expiry runs inside the market refresh.
  - 87 of the project's own exports are tagged unstable to get around a lint rule.

**Doc changes.**
- **Technical design, Standards from the first commit:** twelve rules, from every rule passing on the empty skeleton through typed errors, `Option` and `DateTime` at the boundary, and own schedules, to suppression budgets.
- **CI:** checks run in order, and nothing later runs while an earlier step fails.
- **Stage 0:** the skeleton comes before any feature.

### 11. Flows that pass without proving their promise

**What the audit found:**
- **Hostile page:** the fixture sets `injectionWarning: true` itself. The refusal comes from the chain check, not from judging the page. Recorded model answers are served by index, so an unrecorded request doesn't fail.
- **One orange part:** it recomputes `chooseOrange` on the server's inputs and compares the result to the server's output, which is a tautology. It covers one snapshot, not a recorded day.
- **Map stays put:** the test assigns the newcomer's slot itself, then checks the layout keeps the slots it was given.
- **Notes are checked:** the claim and its evidence are built from the same value, and the test calls `verifyClaim` directly instead of the production path.
- **Replay matches live:** both sides come from the same file, and no frames are compared.
- **Design through the gate:** the model's probabilities are fixed per design id, and "bounces, naming the check" became `readings: []` with no check-name assertion.
- **Trade with a receipt:** it asserts the receipt is *not* stamped on the tide gauge (line 148), the opposite of the promise.
- **What's missing:** there are no property tests, and nothing runs on workerd or a preview stage.

**Doc changes:**
- **Technical design, What makes a flow count:** five conditions, plus a second-person review of what is stubbed and what is asserted.
- **Recordings:** model calls are keyed by a hash of the request.
- **Pass conditions:**
  - over full spans;
  - frame hashes for replay;
  - an independent measure for the orange part.
- **New flows:** "Money in, money out" and "One key isn't enough".

### 12. Agents became researchers

> "I also think there's too much of a focus on 'research'. Unsure where this came from? Maybe because we give it a browser. But really we just want the agents to be capable."

**Where it came from.** Not from how often the word appears: the 11 October product doc says "research" 12 times and "trade" 59 times. It came from a few sentences that set what an agent is for:

- **"An agent's research is its most useful output, often more useful than its trades"**, which opened the section "Research you can read".
- **"Reading is the job; everything else is a way to lose money"**, the reason given for the browser default.
- **"Research is the useful output"**, the reason agents are public, and "what people share is research, not wallets".
- **The receipt chain:** "Sources lead to notes, notes to a thesis, a thesis to a trade or a launch". That made research the first link of every action.
- **The guardrails left reading as the only unrestricted capability.** The browser is read-only, trading and launching were testnet-only, and the agent was modelled on dots, whose defining features are a cloud computer and a browser.

So the browser is part of it, but mostly because the docs made reading the safe, open-ended thing and everything else a gated exception.

**What the build made of it:**
- **The system prompt** opens "You are a read-only market researcher on The Floor" (`packages/agents/src/runtime.ts:130`).
- **The only toolkit** is `ResearchToolkit`: `ReadMarket`, `ReadPublicNotes` and `ReadPage` (`:54-72`).
- **The naming.** The desk's main button is "Run research" (`packages/frontend/src/desk/view.ts:198`), desks are labelled "Research desk" (`packages/renderer/src/layout.ts:772`), and the README describes "research desks" and "metered research".
- **Research was all an agent could do.** Trading was blocked by the chain mismatch (finding 5), so the app became a research product in practice.

**Doc changes:**
- **Product doc, what an agent is:**
  - Model idea 3: agents are capable.
  - "What an agent can do": trade, launch, build, investigate and publish, each switched on or off by the mandate.
  - Mandates name goals, not just what to watch.
  - New Working and Building states, and a desk screen that shows any work.
  - The lighthouse in the scene is drafted by an agent.
- **Product doc, the public record:** "Research you can read" becomes "Work you can check", now with designs, theses that resolve on a named reading and date, and "Sources carry their weight".
- **The Floor's case:** the swarm through distribution, in "Why markets, and why many agents" and model idea 10, with the herding risk and its guards:
  - a contradicted source flags everything resting on it;
  - the map warns when many theses rest on one source.
- **Technical design, agent runtime:**
  - the agent's own sandboxed computer;
  - the public record;
  - three doors (the signing service, the gate, the owner's permission) for anything that reaches beyond the desk;
  - new capabilities added as new kinds of intent or submission.
- **Technical design, flows and milestone:** new flows "Theses resolve", "Sources carry their weight" and "An agent builds". The milestone's agent resolves a thesis and drafts the lily-pond design.
- **Archive, under consideration:** ways to divide the work without coordination: question boards, mandates that default to under-covered markets, and scouts feeding analysts.

### 13. Smaller gaps

- **The phone target is unmeasured.** The bench runs at 1440×900, pixel ratio 1, unthrottled, and hard-codes `phoneVerified: false`. Its p95 of 16.7 ms is just the screen refresh, and the slowest frame in the 50k run was 150 ms.
  - Change: CI gates on a phone profile and renderer CPU time.
- **Testing data reaches the live map by file copy.** `data/base-day.json` is byte-identical to `testing/recordings/base-day.json` and is loaded into live history at startup. That gets around a fence that checks only import paths.
  - Change: fences cover file reads and copies, and recordings reach the map only as labelled replay.
- **Inference is OpenAI-only,** though the defaults name Claude models.
  - Change: a Layer per provider, so the owner's choice is real.
- **The Settings service was never built.** Settings are a compile-time constant read directly.
  - Change: settings are never constants compiled into code or contracts.
- **The doc's own errors:**
  - "This is how Doc gets built" (fixed);
  - `pnpm` in the flow example (now `bun`);
  - tsgo described as a preview (it shipped as TypeScript 7).

## The research behind the new defaults

| Question | Default | Fallback | Watch |
| --- | --- | --- | --- |
| Islands | Solana, Robinhood Chain, Base | | BNB Chain: 25% of launchpad fees, but no launchpad there offers an integrator SDK yet |
| Launchpad on Solana | Meteora Dynamic Bonding Curve, SDK 2.0 | Raydium LaunchLab, which can't change curve math or graduation | Pump.fun documents no platform fee |
| Launchpad on EVM islands | Doppler | Clanker v4 | Zora Coins and Flaunch, both tiny on Base |
| Market data | Codex: launchpad events on all three islands | GeckoTerminal, whose WebSocket is in paid beta | Helius LaserStream for raw Solana; Bitquery for Robinhood |
| Wallets and the agent's second key | Privy, two-of-two session signer with policies | Turnkey delegated access | Coinbase CDP for embedded and server wallets, with per-transaction rules only |
| Funding | Privy's Stripe on-ramp (card, Apple Pay, Google Pay, ACH) and Bridge bank accounts | Coinbase Headless Onramp, US only, whose guest checkout ended 30 June 2026 | MoonPay, around 3.99% on cards (unverified) |

Two regulatory notes, which are not legal advice:

- **Custody.** A session signer with no policies, or a server wallet only the Floor controls, looks custodial. A two-of-two quorum, or the owner as the only root, supports the non-custodial claim.
- **No safe harbour.** The CLARITY Act, which carried a developer safe harbour, failed its Senate cloture vote 49–50 on 15 September 2026. Legal review before anything touches real money stays non-negotiable.

The full notes, with a source for each fact, are in the research agents' reports. The key sources are in the archive.

## Inform the docs, or iterate?

The critique leans towards informing the docs. That is the right first step, and it is done here. But the two options aren't either/or, because the findings point to where the next iteration should start.

Most of what went wrong was decided in the docs before any code: Base alone, an in-house launchpad, extension-era wallets, the look last, a package list, and infrastructure that was never a checkbox. Fixing the docs fixes the cause.

The fixes don't fit the current code:
- **Chain-neutral identifiers change the contract that every package depends on,** and Solana support rewrites the markets package.
- **Map-first changes the whole client.** The screen, camera and assets all change.
- **The packages become apps.**

Refactoring in place would touch nearly every file, so the recommendation is to start the next iteration from the revised docs on a fresh skeleton (Stage 0), carrying over:

- `.oxlintrc.json`, the tsconfig diagnostics, `dprint.json`, and the custom lint plugin with its tests, extended to check bundles and data paths.
- `AGENTS.md` and the conventions in `docs/Codex/`, with `file-structure.md` rewritten around the apps and packages rule.
- `policy.ts` and the receipt journal in `execution.ts`, which seed `packages/policy`.
- The gate's pure checks and drivers, which seed `packages/map`.
- The scoped Anvil fixture, the launch-and-lock flow's structure and the bench harness.
- The contract schemas, as a starting point to convert to CAIP identifiers, `Option` and `DateTime`.

The file-by-file version of this list, the porting order and the two spikes to run first are in `next-steps.md`. The Effect 4 patterns that work in the installed versions are in `effect-4-cookbook.md`.

This is the one recommendation in this doc that is a judgment rather than a finding. It is logged as proposed in the archive, pending the owner's decision.

## Changes the Floor Atlas needs

A second audit, of the design system itself, found it was never imported. `tokens.json` is referenced nowhere, its values were hand-copied into at least eight places and drifted, and every value it left out was invented separately by the kit, the renderer and the gate. The gate's material map is the worst case: it renders brick as rust and enamel-green as water, so every brick mill draws as a dead market and the lily-pond stems as liquidity. The Atlas defines what the map means well, but says almost nothing a 3D build needs: no kit unit, proportions, material ramps, tested tones, line spec in CSS pixels, camera rungs, motion timings or reading scales. Its only pictures of the world are boxes on a slab, which is what got built.

`floor-atlas-plan.md` turns the Atlas into code (`packages/atlas`), with a generated stylesheet and palette, asset manifests, reference scenes, a workbench, deterministic look tests and a published artifact generated from the repo. A one-week look spike settles the line technique, tones and proportions first.

## What this pass couldn't check

- **The `fomo-analytics` dataset** the critique mentions (`/mnt/models/dev/fomo-analytics`) isn't on this machine. The chain shares above come from public DefiLlama data instead, and the dataset should confirm or replace them.
- **The live doc artifacts** linked from the 11 October archive couldn't be opened from this account, so the revision starts from the 11 October snapshot. Edits made to the live artifacts after that snapshot aren't included.
- **Phone performance, the external providers, and a signing service with real authorization** weren't exercised.
- **Unverified research items:**
  - Robinhood Chain's sequencer setup;
  - Doppler on Solana mainnet;
  - Clanker on BNB Chain;
  - Privy gas sponsorship on Robinhood Chain;
  - Privy's spending totals over time on Solana, which aren't available today;
  - the Stripe on-ramp's US state exclusions;
  - which on-ramp Fomo uses;
  - rent costs for Meteora configs.

## Where each change landed

| Finding | Product doc | Technical design | Archive |
| --- | --- | --- | --- |
| 1. The look | Model 8; what the first build taught us; common failures; foundations | Order of work; the look, as acceptance; the Floor Atlas in the repo; assets; renderer; designs as data; the look spike | Decision log; `floor-atlas-plan.md` |
| 2. Interface | One screen: the map; what lives off the map | The screen; targets | Decision log |
| 3. Camera | Moving around | The camera; targets; look layer | Under consideration (rotation) |
| 4. One chain | Which chains first? | Identifiers; data model; defaults; first milestone | Decision log; under consideration (BNB Chain) |
| 5. Same chain | | Agents act on the chain they read; trade flow | Decision log |
| 6. Launchpad | The foundry; no quiet selling; whose launch contracts? | Signing service (launches); adapters; defaults | Decision log; stack |
| 7. Wallets | Model 9; money in and out; guardrails; defaults | System overview; signing service; action intent; Money in, money out flow | Decision log; stack; under consideration (custodial balance) |
| 8. Packages | | The repo: apps and packages; fences; where it lives | Decision log |
| 9. Infrastructure | | Deviations are written down; Effect and CAFE; Stage 0; defaults | Decision log; stack |
| 10. Standards | | Standards from the first commit; CI order; Stage 0 | Decision log |
| 11. Flows | | What makes a flow count; the flows | Decision log |
| 12. Agents as researchers | Intro; model 3, 4 and 10; why markets, and why many agents; what an agent can do; work you can check; defaults; under consideration | Agent runtime; data model (notes, theses, receipts); flows; first milestone | Decision log; under consideration (dividing the work) |
| 13. Smaller gaps | | Bench; fences; agent runtime; defaults | |
