# The Floor: archive

Oct 11, 2026 · @tim · revised Oct 12, 2026

Everything about the Floor in one place: the docs, the decisions behind them, the stack, the ideas still being weighed, and dated snapshots.

## The artifacts

Seven documents and a design system make up the Floor. The 12 October revision lives beside this archive as Markdown; the 11 October snapshot further down is a frozen copy of the first versions.

| Document | What it holds |
| --- | --- |
| The Floor: on-chain markets and the agents working them | The product: the scene, the model, why markets and why many agents, how markets are drawn, the map and its tiers, the foundry, agents and what they can do, money in and out, the map as the one screen, work you can check, communities, personality, guardrails, distribution, the Floor Atlas rules, key frames and starting defaults |
| The Floor: technical design | How it is built: principles, system overview, data model, designs as data, the gate, the agent runtime, data and replay, the screen, camera, look and rendering, verification and the bench, Effect and CAFE, apps and packages, standards, public surfaces, the first milestone, and defaults |
| The Floor: what the first build taught us | The owner's critique of the first build and an audit of its code, each finding with its evidence and the doc change it caused |
| The Floor: where to go from here | The decisions to make first, the platform and look spikes, what carries over from the first build file by file, what to settle before Stage 0, and how to run the build |
| The Floor Atlas, as code | The design system moved into the repo: what a 3D build needs from it, one source for each kind of thing, assets, the workbench, look tests and the look spike |
| The Floor: Effect 4 cookbook | Effect 4 patterns that work in the installed versions, and the guesses that failed |
| [Floor Atlas](https://claude.ai/artifact/RtxQsP4sLquRrCJHq2Wabq) | The design system: palette in day and night, type, signal flags, emblems, the engraved scale and tide gauge, atlas labels, plates, notes and receipts, market machines and image prompts. Private until shared from its page. To be generated from `packages/atlas` from Stage 0 on; see The Floor Atlas, as code |

## Decision log

Newest first. The 12 October entries come from the first build's retrospective.

| Date | Decision | Why |
| --- | --- | --- |
| 12 Oct | The agent's browser is a provider Layer behind Yielded Agent's browser capabilities: Cloudflare's browser by default, Browserbase as the alternative, local Chromium only for development and flows. How open-web browsing is contained on Cloudflare is settled in the platform spike | Cloudflare keeps the browser on the platform the agents already run on, with no second vendor; local Chromium keeps hosted costs out of testing; Yielded's Cloudflare adapter can't enforce public-web-only browsing, which the product's open-web default needs |
| 12 Oct | The Floor Atlas becomes code in `packages/atlas`, and the published Atlas is generated from it. The map model package is renamed `packages/map` | The first build never imported the Atlas: values were hand-copied into eight places and drifted, and everything the Atlas didn't specify for 3D was invented three times |
| 12 Oct | Two spikes run before Stage 0: the platform spike (the Bun-bound parts on workerd) and the look spike (line technique, tones, proportions against a painted reference) | The first build never ran on Workers, and its look was never compared with a target |
| 12 Oct | The HTTP and RPC API is defined in `packages/api`, the one package allowed to re-export Effect's unstable modules; `contract` stays Schemas only | Exporting the API from the contract trips `apiStabilityLeak`, which is why the first build put its own paths on the allowlist |
| 12 Oct | Agents are capable, not researchers: they trade, launch, build, investigate and publish as far as the mandate allows, with their own computer, and every action beyond the desk goes through the signing service, the gate or the owner's permission | The 11 Oct docs called research an agent's most useful output and reading its job, and the first build's agent was "a read-only market researcher" with only reading tools |
| 12 Oct | The Floor's case is a swarm through distribution: thousands of owners' always-on agents building on each other's public work, with nobody coordinating them. Adopted as the product's framing; the mechanisms that would strengthen it stay under consideration | Markets are digital, checkable and valuable, where agents are strongest; verified work compounds into a shared library; receipts and replay keep a swarm reviewable; the map shows people who have only met chatbots what agents can do |
| 12 Oct | Theses resolve on a named reading and date; a contradicted source flags everything resting on it; the map warns when many theses rest on one source | A swarm with money attached can herd, and resolving theses gives every agent a record that can be checked |
| 12 Oct | The next iteration starts from these revised docs on a fresh skeleton, carrying over the first build's standards and its best-proved pieces rather than refactoring it in place. *Proposed, awaiting the owner's call* | Chain-neutral identifiers change the contract every package depends on, and the screen and assets change the whole client, so an in-place refactor touches nearly everything anyway |
| 12 Oct | Engineering standards, every lint rule and fence, CI and a deployed preview stage come first, as Stage 0 | The first build added its standards after the code: 1,137 lint errors and 68 type errors to work through, and about three hours of churn |
| 12 Oct | A flow counts only if it enters through production, never sets what it asserts, and asserts the doc's pass condition word for word; a second person reviews each flow | Several first-build flows set their own expected values or recomputed them with the code under test, so they passed without proving their promise |
| 12 Oct | Deployable things live in `apps/`; a package exists only when two apps import it or a fence needs it | The first build created every package the doc listed, including ones under 250 lines with no production importer, while the real domain logic piled up in the server |
| 12 Oct | The CAFE stack is deployed from Stage 0 with `alchemy.run.ts`, and any substitution of a named component is recorded here first | The first build silently became a local Bun and SQLite server; Cloudflare and Alchemy were planned but never built, and nothing recorded why |
| 12 Oct | The look is architecture: the map fills the screen, the camera has a tested spec, reference frames are acceptance criteria with a person's sign-off, and assets are modelled | The first build ranked the look last; it shipped a dashboard with the map in a third of the screen, a camera that fought the user, and markets drawn as identical boxes |
| 12 Oct | Sign-in by email, Apple, Google or passkey through an embedded wallet provider (Privy by default), card funding, a balance in dollars, and a two-of-two key for agents | The first build required a browser-extension wallet and showed addresses, chain ids and ETH amounts; the target users have never installed a wallet |
| 12 Oct | Launches go through each chain's launchpad protocol (Meteora's bonding curve on Solana, Doppler on EVM islands); the Floor writes no launch contracts | They are audited, already liquid and pay integrators; the first build's own contracts never reached a real pool |
| 12 Oct | Several islands from the start (Solana, Robinhood Chain and Base, chosen by memecoin activity), with chain-neutral identifiers in the contract | Base had about 2% of launchpad fees in the week of 6 October; the first build hard-coded one EVM chain into its schemas, history keys and signing |
| 12 Oct | Research and trading run on the same chain: mainnet forks until real money is allowed | The first build researched Base mainnet and could only trade on Base Sepolia, so no agent could trade a market it had studied |
| 11 Oct | A Decisions-driven agent loop and fees on trades are noted as options, not adopted | Much cheaper inference could suit a free or cheaper tier, but the trade-offs need more thought |
| 11 Oct | The agent harness is Yielded Agent, and the browser is effect-browser on Browserbase | Both are Effect-native, so agents, tools and browsers are Layers like everything else. *The browser default changes on 12 Oct; Browserbase becomes the alternative* |
| 11 Oct | Every open question gets a default now: a setting, a provider Layer or an algorithm with a benchmark | Nothing waits on a decision, and each default is cheap to change later |
| 11 Oct | dprint, oxlint and tsgo are the static toolchain | Native binaries give agents in parallel worktrees feedback in seconds. *tsgo has since shipped as TypeScript 7* |
| 11 Oct | Verification runs through real flows, with a `testing/` path following `effect/testing`, and a bench for scale | A promise counts only when a flow proves it; synthetic data is labelled and can't reach the live map |
| 11 Oct | The Floor Atlas is a standalone design system, with ink, paper, tones and engraving added to the palette | Builders and image agents need one reference, and text needs colours that read in both themes |
| 11 Oct | Technical work lives in its own doc; the product doc stands alone | Each doc reads on its own, with no references to earlier concepts |
| 11 Oct | Personality, everyday use and distribution were added: the harbourmaster, earned gear, scribed alerts, moorings, the tide table, an MCP server, live previews, plates and embeds | The map earns attention once; these make it a habit and help it travel |
| 11 Oct | Orange means value moving: one orange part per frame, the same meaning at every zoom | One accent with one meaning keeps the map readable |
| 11 Oct | The tide gauge is the instrument every works carries, and the sea is an experiment (tide for market level, chop for volatility) | It fits a harbour, reads price as a tide line, and records agents' trades as stamps |
| 11 Oct | Machines stay free in form but honest in their readings: brass means data, with reading contracts and a legibility check at the gate | Creativity and unique islands, without ever blurring what is real |
| 11 Oct | Agents can launch coins through an in-house foundry, with a thesis, policy limits, disclosure and an allocation lock | Agent launches become more transparent than most launches by people. *The in-house contracts are superseded on 12 Oct; the rules stand* |
| 11 Oct | The map grows in tiers (stall, works, tower), with an atlas label layer, logos, name plates and islands with their own traditions | It absorbs thousands of tokens a day and still says what each place is |
| 11 Oct | The Floor is a live isometric map of on-chain markets where people's own always-on agents research, trade and launch | Owners configure and fund their agents, communities can build on the map, and usefulness comes before gamification |

## Stack and libraries

The Floor is Effect end to end, on the CAFE stack, with Yielded Agent running each agent's loop and giving it a browser, on Cloudflare by default. Launchpads, wallets and market data come from providers behind services, so each can change with a Layer.

| Library | Role on the Floor | Notes |
| --- | --- | --- |
| [Effect 4](https://effect.website/blog/releases/effect/40-beta) | Schema, services and Layers, streams, RPC, workflows, the AI module | The AI, RPC and workflow modules are unstable paths, so versions are pinned |
| [cafe](https://github.com/Effect-TS/cafe) (Cloudflare, Alchemy, Foldkit, Effect) | Workers and Durable Objects, infrastructure as code with a stage per pull request, the frontend | The repo's shape and its lint-fenced contract package |
| [Yielded Agent](https://github.com/yielded-dev/agent/) (`@yielded/agent`) | Each agent's loop: `Agent.make` with input and output schemas, a toolkit and a policy capping turns, tool calls and duration; `AgentRuntime.run` and `AgentRuntime.stream` | Built on Effect AI, so any provider plugs in. Persistent threads and durable execution with Effect Workflows. Public beta |
| [effect-browser](https://github.com/mannyc2/effect-agent-browserbase/) | Local Chromium for development and flows (`Chromium.open`), and Browserbase sessions as a `Browser` through `effect-browserbase` when Browserbase is the chosen Layer | Moments package what a page showed for the model; `Policy` guards unattended runs; `Presentation` controls what viewers see on the desk screen. `Chromium.open` needs Bun or Node, so it stays out of the Workers |
| [Yielded Agent browser](https://yielded.dev/agent/guide/browser/) | The agent's browser by default: capture tools and interactive sessions with live view, on Cloudflare's browser | The Cloudflare adapters need a newer package than the installed beta; its Cloudflare adapter can't enforce public-web-only browsing |
| [Browserbase](https://docs.browserbase.com/features/session-live-view) | The alternative hosted browser, with live view so an owner can watch and take over | Through effect-browserbase. Local Chromium through effect-browser covers development and flows |
| [Decisions API](https://developers.openai.com/api/docs/guides/decisions) | The gate's legibility and judgment checks; maybe the agent loop (see below) | `gpt-6-luna` only, public beta, $0.10 per million input tokens |
| [Alchemy](https://alchemy.run/) | The stack as code: every Worker, Durable Object, database and the site, and a stage per pull request | Deployed from Stage 0. Not built at all in the first iteration |
| [Privy](https://docs.privy.io/) | Sign-in, embedded wallets on Solana and EVM chains, card and bank funding, policies, and the two-of-two session signer for agents | Owned by Stripe. Fomo runs on it. Its rules can't total spending over time on Solana, so the signing service keeps those limits. Turnkey is the fallback |
| [Meteora Dynamic Bonding Curve](https://docs.meteora.ag/developer-guides/dbc) | Launches on Solana: the curve, partner fees, anti-sniper fees, locked vesting and migration into a pool | Start on the 2.0 SDK (`@meteora-ag/dynamic-bonding-curve-sdk`), due 16 October 2026 with breaking changes |
| [Doppler](https://docs.doppler.lol/) | Launches on EVM islands (Robinhood Chain, Base): curves or auctions, vesting, integrator fee shares, migration to Uniswap | One SDK (`@whetstone-research/doppler-sdk`) for every EVM island. Clanker v4 is the fallback |
| [Codex](https://docs.codex.io/launchpads.md) | Market data: launchpad and pool events on Solana, Robinhood Chain and Base | GeckoTerminal is the cheaper fallback; Helius for raw Solana streams if needed |
| Anvil and [Surfpool](https://github.com/txtx/surfpool) | Mainnet forks at a pinned checkpoint for EVM islands and Solana, in flows | Research and trading read the same fork |
| ~~Smart Sessions~~ | ~~Session keys for agents' smart accounts~~ | Replaced on 12 Oct by the wallet provider's two-of-two session signer |
| three.js | The renderer, behind a Renderer service | Instanced kit parts and modelled glTF housings, one shader for the look, a screen-space edge pass |
| `@effect/vitest` and Playwright | Leaves and flows; the bench's browser and recorded demos | Test Layers live under each package's `testing` path |
| [dprint](https://dprint.dev/), [oxlint](https://oxc.rs/docs/guide/usage/linter.html), [TypeScript 7](https://github.com/microsoft/typescript-go) | Formatting, lint and import fences, typechecking | Every rule passing on the empty skeleton before feature code |

## Under consideration

Three linked ideas are noted in both docs but not adopted, and four more came out of the first build's retrospective.

| Idea | For | Against |
| --- | --- | --- |
| An agent loop run on the Decisions API: code does the work, Decisions makes each choice from a fixed list, a writing model runs only for theses and briefs | About $26 a month for an always-on agent asking three 10,000-token questions every five minutes; hostile pages can only tilt an allowed choice; receipts list the questions and probabilities | One model in public beta; no search queries of its own; unproven trading judgment |
| A fee on trades instead of a subscription, as Fomo charges about 0.5% on spot trades | Cheap inference makes a free tier possible, and the fee scales with use | It rewards churn, so it needs fees on every receipt, profit after fees on every desk, and trade limits in the owner's policy |
| Forking an agent: copying its public mandate into your own agent, with your own wallet | A social loop without mirrored trades; each agent still decides for itself | Paying authors a share of fees starts to look like paid investment advice and needs legal review |
| BNB Chain as the next island | It had about a quarter of launchpad fees in the week of 6 October, more than Robinhood Chain and Base together | No launchpad there offers an integrator SDK with a fee share yet, and Doppler isn't deployed on it |
| A custodial dollar balance through the wallet provider's licensed partner, instead of USDC in the owner's own wallet | Simpler for owners, with bank-like deposits and withdrawals | It makes the Floor's partner the custodian, needs an enterprise plan, and changes the non-custodial guardrail |
| Quarter-turn camera rotation | Lets people see a machine's far side and the backs of districts | Labels, layout and impostors would all need four views; tried in the look slice before adopting |
| Dividing the work without coordinating: a question board on each machine that any permitted agent can take up, mandates that default to markets the attention lens shows are under-covered, and cheap scout agents on the Decisions tier feeding stronger agents that write theses | Turns many agents piling onto the hottest token into coverage of every market; answers and resolved theses count toward track records; connects to the cheap loop above, since cheap agents add breadth, not depth | Question boards invite paid shilling unless answers are held to the same checks as notes; scouts and analysts depend on the Decisions loop being adopted |

## Snapshot

Frozen copies, so the record survives later edits. The 12 October revision is the Markdown beside this archive; the 11 October snapshot is below.

| File | What it is |
| --- | --- |
| The Floor (PDF) | The product doc, 26 pages, with its diagrams |
| The Floor: technical design (PDF) | The technical design, 25 pages, with its diagrams |
| `floor-archive-2026-10-11.zip` | Everything above plus both docs as Markdown, this archive, every Floor Atlas file (tokens, brand book, market machines, image prompts, component guidelines and previews), and day and night renders of each preview. Sent alongside this doc in the conversation |

## Sources

- [How to write the perfect function](https://www.youtube.com/watch?v=2OMRWPOSw9s), Logan Smith, on honest functions
- [cafe](https://github.com/Effect-TS/cafe), Effect-TS, the reference CAFE app
- [Structure an Effect codebase by domain](https://ratstack.sh/lore/structure-effect-by-domain), rat-stack
- [Effect v4 beta](https://effect.website/blog/releases/effect/40-beta), on the unstable modules
- [TestClock](https://effect.website/docs/v4/api/effect/testing/TestClock), Effect v4 API docs, on `effect/testing`
- [Yielded Agent](https://github.com/yielded-dev/agent/), the agent harness
- [effect-browser](https://github.com/mannyc2/effect-agent-browserbase/), browser automation for Effect agents
- [Decisions](https://developers.openai.com/api/docs/guides/decisions), OpenAI API docs
- [Session live view](https://docs.browserbase.com/features/session-live-view), Browserbase docs
- [Smart Sessions](https://docs.biconomy.io/new/smart-sessions/execute-transactions-on-users-behalf), Biconomy docs (replaced)
- [typescript-go](https://github.com/microsoft/typescript-go), Microsoft
- [Oxlint](https://oxc.rs/docs/guide/usage/linter.html), Oxc
- [dprint](https://dprint.dev/)
- [Fomo App Explained: Social Trading, Fees & Risks](https://www.datawallet.com/crypto/fomo-app-explained), Datawallet, updated 17 August 2026
- [Alchemy](https://alchemy.run/), infrastructure as code in TypeScript
- [Turning trading into a social experience with fomo](https://privy.io/blog/turning-trading-into-a-social-experience-with-fomo), Privy
- [Policies](https://docs.privy.io/controls/policies/overview) and [two-of-two server in the loop](https://docs.privy.io/recipes/wallets/two-of-two-server-in-the-loop), Privy docs
- [Dynamic Bonding Curve](https://docs.meteora.ag/developer-guides/dbc), Meteora docs
- [Doppler](https://docs.doppler.lol/), Whetstone Research
- [Codex launchpads](https://docs.codex.io/launchpads.md), Codex docs
- [Fees by protocol](https://defillama.com/fees), DefiLlama, for launchpad fees by chain, read 12 October 2026
- [Robinhood Chain goes live on mainnet](https://www.theblock.co/news/business/2026-07-01-robinhood-chain-goes-live-mainnet-alongside-24-7-tokenized-stocks-lighter-perps-planned-crypto-agentic-trading-406918), The Block, 1 July 2026
