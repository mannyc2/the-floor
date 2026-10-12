# The Floor: where to go from here

Oct 12, 2026

The revised docs say what to build. This says how to start: what to decide first, two spikes to run before any feature code, what to carry over from the first build, what to settle before Stage 0, and how to run the build so it doesn't drift again.

## The path

1. **Decide.** The owner's calls, listed below.
2. **Run two spikes in parallel.** About a week:
   - The **look spike** settles how the map is drawn (see The Floor Atlas, as code).
   - The **platform spike** proves the parts the first build ran on Bun will run on Workers.
3. **Stage 0: the skeleton**, built from the carry-over list below and seeded with what the spikes decided. It includes the Floor Atlas package, the workbench and the look-test harness.
4. **Stages 1 to 4**, as in the technical design's first milestone, with the owner reviewing the end of each stage before the next one starts.

## Decide first

| Decision | Recommendation | Why it can't wait |
| --- | --- | --- |
| Fresh skeleton or refactor in place | A fresh skeleton, carrying the list below | Chain-neutral identifiers, the map-first screen and the apps layout would touch nearly every file anyway; only about 80 lines of the first build meet the new standards as they are |
| Who directs the art, and who models | Name one person with art-direction authority, and an artist who paints over reference frames and models in Blender the assets whose quality is in their silhouette (code generates the rest) | The look is now accepted against reference frames with a person's sign-off. Without these two people Stage 2 can't finish, and the first build showed what an agent approving its own visuals produces |
| Islands | Solana and Robinhood Chain for the milestone, with Base through the same EVM adapter | Confirm against the `fomo-analytics` data before Stage 3; the defaults rest on public DefiLlama numbers, and Robinhood Chain's share is falling fast |
| Accounts | Cloudflare (Workers, Durable Objects, Browser Rendering), Privy (sandbox), Codex, and the inference providers. Browserbase only if the platform spike chooses it | The platform spike and Stage 0 need them on day one |

## The platform spike

The technical design puts the Floor on Cloudflare Workers and Durable Objects. The first build never ran there, and several of the parts it did run need Bun or Node. Prove each of these on workerd, and log any deviation (a Container for one piece, say) before Stage 0:

- **The agent's browser.** An agent Durable Object with alarms runs a Yielded Agent loop that reads pages with capture tools and drives an interactive session with a live view, on Cloudflare's browser through [Yielded's Cloudflare adapters](https://yielded.dev/agent/guide/browser/). Three things to settle:
  - **Which package and version export the adapters.** The installed `@yielded/agent` 0.1.0-beta.166 has the generic capabilities (`web-capture`, `interactive-browser`, `browser-use`, plus `code-executor` for the agent's computer) but no `CloudflareBrowser` export.
  - **How open-web browsing is contained.** The Cloudflare adapter can't enforce `PublicWeb`, so the choice is a host allowlist, `Unrestricted` behind the Floor's own denylist, or open-web sessions on another provider.
  - **Whether live view and takeover meet what a desk needs.** Sessions keep alive at most ten minutes between commands.

  Browserbase, through effect-browserbase, is the fallback Layer. Local Chromium, through effect-browser's `Chromium.open`, stays for development and flows, so tests never pay for hosted sessions.
- **Wallets and launches.** Privy's server SDK co-signs a transaction in the sandbox, and the Meteora and Doppler SDKs build a launch, all inside a Worker.
- **The headless renderer.** Browser Rendering produces a plate from the real renderer.
- **Storage.** `@effect/sql-sqlite-do` (Durable Object storage) and `@effect/sql-d1`, both at 4.0.3, are in `node_modules` but not the lockfile. Prove them as the history and journal stores.
- **Crypto.** The first build took it from `BunServices`; replace it with Web Crypto.
- **The deploy.** `alchemy.run.ts` deploys a stage and destroys it, using the working example in `imp-2/work/cafe-reference/` (`Cloudflare.Website.Foldkit` and a GitHub comment preview).

## Settle before Stage 0

- **Effect 4 has no unstable paths.** The modules are `effect/ai`, `effect/http-api`, `effect/rpc`, `effect/sql` and so on, marked with `@stability unstable` tags. The technical design is corrected to say so.
- **Where the API is defined.** HttpApi and RPC definitions exported from `contract` trip the `apiStabilityLeak` check; that is why the first build put its own paths on the allowlist. The fix is a small `packages/api` that defines the API from the contract's Schemas, as cafe does. It is the one logged exception to "the Floor's own code is never on the unstable-API allowlist". `contract` stays Schemas only.
- **Missing providers.**
  - No Anthropic provider for the AI module is installed; add it and verify it before relying on the Claude defaults.
  - `@effect/ai-openai` 4.0.0 has no Decisions provider, so the first build's own adapter is the working one.
- **The recorded Base day.** It converts cleanly to checkpoints and CAIP refs: 25 hourly snapshots of 14 pools, with block hashes, so it can be re-derived from the chain. But swap windows exist only in its last 6 snapshots, so it can't carry a full-day "One orange part" flow. Record a fresh day per island early in Stage 3, with swap windows throughout.

## What carries over

Very little copies across as it is. About a third is worth adapting, a quarter is a useful reference, and the most valuable single thing is the set of Effect 4 patterns that are known to work. Those are written up in `effect-4-cookbook.md`.

| Verdict | Lines | Share |
| --- | --- | --- |
| Carry as is | about 80 | under 1% (config and docs) |
| Adapt | about 8,500 | about a third; expect half of it rewritten in practice |
| Keep as a reference | about 6,300 | about a quarter |
| Drop | about 10,600 | about 40%, plus 463 MB of old bench reports |

### By where it lands

| Lands in | From the first build | Verdict and changes |
| --- | --- | --- |
| Root config | `tsconfig.json` | **Adapt.** Keep the compiler options and the roughly 90 Effect diagnostics. Drop `paths`, the Workers types and the Floor's own entries in `allowedUnstableApis` |
| | `.oxlintrc.json` | **Adapt.** Keep the presets, type-aware rules and rule block. Point the Foldkit override at `apps/web`. Drop the null-rule overrides |
| | `dprint.json`, `.gitignore` | **Carry**, with new globs |
| | `package.json` | **Adapt.** Keep the exact toolchain pins, which are known to work together: TypeScript 7.0.2, oxlint 1.87.0, tsgolint 7.0.2003, `@effect/tsgo` 0.51.1 and its `prepare` patch, effect-oxlint 0.4.0, oxlint-plugin-effect 0.28.1 |
| | `.github/workflows/verify.yml` | **Adapt.** Reorder to the new CI sequence, adding the Alchemy deploy and destroy. Keep the Bun pin, the frozen lockfile and the bench baseline cache |
| `scripts/` | `scripts/lint/plugin.ts` and its tests | **Adapt.** Retarget to `apps/` and `packages/`, turn signing isolation into signer isolation, and add the new fences: three.js only in web, apps never importing apps, and testing paths in file reads |
| | `scripts/bundle-budget*` | **Adapt.** Budgets as data, structured errors, and reuse its manifest walker as the bundle fence |
| `packages/contract` | `contract/src/index.ts` | **Adapt.** CAIP refs and checkpoints; `Option` and `DateTime` in place of 45 nullable fields and ISO strings; proposals become action intents. Keep the phase-keyed Receipt union, the allowlisted public projections, the recursive driver expression, the reading contracts and `ExactAmount` |
| | Settings definitions | **Adapt.** The definitions move into the contract, and the service into `apps/floor` |
| `packages/policy` | `signing/src/policy.ts`, the transitions in `execution.ts`, and `policy.test.ts` | **Adapt.** This is the core of the honesty model. Use `DateTime`, which fixes a bad timestamp silently stopping a receipt from expiring. Drop the contract, method and testnet checks. Limits become settings. Hash the fingerprint, which today embeds private mandate text. Keep causes on errors. Add property tests |
| `packages/map` | `districts/src`, `server/src/district-tiers.ts`, `gate/src/checks.ts`, `drivers.ts`, `renderer/src/evidence.ts` | **Adapt.** Tiers, the orange part, movement limits, the gate's ordered checks and drivers, and the replay visibility rule are honest leaves. Key them by checkpoint and read Settings. Drop the always-pass Schema check row, and add housings and sockets |
| `packages/chains` | `markets/src/normalizers.ts`, `base-chain.ts`, `runtime.ts`, `capture.ts` | **Adapt.** The concentrated-liquidity price correction, same-block reads with a header recheck, "measured zero" against "absent", and the cache that keeps only successes become the EVM adapter. Fix the testing layer that relabels a recording as `source: "chain"` |
| | `testing/flows/_fixtures/anvil.ts` | **Adapt.** Becomes a scoped mainnet fork at a pinned checkpoint, with a Surfpool sibling for Solana |
| `apps/signer` | The dispatch and journal in `execution.ts`, `server/signing-journal.ts`, `signing/test/dispatch.test.ts` | **Adapt.** Keep the compare-and-set rules (reservation compares receipt, policy, proposal and exposure; settlement compares the receipt) and the repo's best concurrency, restart and power-loss tests. Storage moves to Durable Object transactions, and execution to adapter, simulate, Privy co-sign |
| `apps/floor` | `agents/src/providers.ts`, `gate/src/review.ts`, the Decisions adapter in `design-review.ts`, `launch-reviews.ts`, the MCP server in `public-surfaces.ts`, `research/src`, `observability.ts` | **Adapt.** `permittedResearchUrl` is carry quality. These are the only working wiring for the Decisions model and MCP. `verifyClaim` and calibration are pure |
| `apps/web` | `frontend/src/entry.ts`, `scene.ts`, `subscriptions.ts`, `preferences.ts`, `api.ts` | **Adapt.** The Foldkit runtime wiring and the scoped Mount for three.js, split into Renderer and Camera services. Delete the ten-second tick |
| `testing/` | `bench/run.ts`, `result.ts`, `main.ts` and their tests | **Adapt.** Add the phone profile, gate on renderer CPU time, add `--stage`. Keep the Schema'd report, baseline, trace, video and read-to-pixel timing |
| | The launch-and-lock, approval-expires, funds-only-go-home and design-through-the-gate flows | **Adapt.** Enter through production, expire on its own alarm, and assert the bounced check's name |
| | `_fixtures/recorded-research.ts` | **Adapt.** Key by a hash of the request, and fail on an unrecorded one |
| | `recordings/base-day.json` | **Adapt (data).** Convert to checkpoints and CAIP refs, and strip the derived dollar fields |
| `docs/` | `AGENTS.md`, `docs/Codex/comments.md`, `docs/Codex/lint.md` | **Carry** comments; **adapt** the other two with new paths, signer wording and a link to the cookbook |

### Keep as a reference, don't copy

- **Patterns to read before writing their replacements:**
  - `agents/src/runtime.ts`: the only working Yielded Agent wiring. Drop its researcher prompt and calldata output.
  - `server/src/agent-runner.ts`: budget reserved before any provider call, one run per agent.
  - `server/src/store.ts` and `sqlite-store.ts`: Model.Class, repositories and the reorg trigger.
  - `signing/src/scoped-accounts/accounts.ts`: how to wrap an HTTP edge, with timeouts, idempotency keys, dispatch never retried, and fresh evidence.
- **Small rules that took effort to get right:**
  - `server/src/community.ts`: vote weights fixed at a pinned block.
  - `public-preview.ts`: preview cache keyed by block hash, with a visibility recheck.
  - `proposals.ts`: an id can't be reused with different contents.
  - `note-positions.ts`: "unavailable" never becomes zero.
- **Renderer performance:**
  - `renderer/src/incremental.ts`: its plan-and-commit diff took the 50,000-market p95 from 83 ms to 10 ms.
  - `visibility.ts`: overscan in power-of-two cells.
- **Market data:**
  - `markets/src/pools.ts` and `virtuals.ts`: Base addresses and the Virtuals curve.
  - `docs/Codex/market-data.md`.
- **Tests and docs:**
  - `foundry/test/Foundry.t.sol`: the lock-evasion checklist (direct transfer, `transferFrom`, selling back to the curve, fuzz) for testing the launchpads' locks.
  - `_fixtures/scoped-signer-edge.ts`: a call-counting fake for "One key isn't enough".
  - `docs/Codex/verification.md`: the bench's measurement definitions.
  - `docs/scoped-accounts.md`: the recovery rules.

### Leave behind

- **The renderer, kit and gate geometry.** The box world, the wrapping gauge, the 40-variable closure, and three.js in the server.
- **The server's `application.ts`, `atlas.ts` and `local.ts`.** A 590-line handler, approval expiry inside the market poll, and testing data loaded into live history.
- **The bespoke launch and wallet code.** The foundry contracts and their TypeScript copies, the scoped-account executor and protocol, the extension-wallet sign-in, and holder evidence.
- **The dashboard.** Every view, form, stylesheet and HTML page.
- **The tautological flows.** Hostile page, notes, replay, map-stays-put and one-orange-part. Keep the hostile page's text as the seed of the fixture site.
- **The e2e "proof" screenshots.** They are anti-references.
- **The old bench scenarios and reports, and `data/base-day.json`.**

## Porting order

| Stage | What to port |
| --- | --- |
| 0 | Toolchain pins and the `prepare` patch, tsconfig diagnostics, oxlint, dprint, the adapted lint plugin and bundle fence, the reordered CI with Alchemy, `AGENTS.md`, the comments and lint docs, and the cookbook. Also the API-package exception in the decision log, the Floor Atlas package seeded from the look spike, the workbench entry, and the look-test harness |
| 1 | The contract, with property tests, then `packages/policy` |
| 2 | The web entry and Mount pattern around new Renderer and Camera services, the incremental-update ideas, the look tests, and the converted Base day as the recorded district |
| 3 | `packages/chains` with the forks and capture, `packages/map`, the district Durable Object's history, and the bench on the phone profile |
| 4 | The signer and its dispatch tests, the wallets package, the launch-lock checklist against the launchpads, the approval and funds flows, the agents, the gate review and MCP |

## How to run the build this time

- **One stage at a time.** At the end of each, the owner reviews three things before the next starts:
  - the decision log, for any deviation;
  - every new flow, against the "What makes a flow count" criteria;
  - the look's signed-off frames.
- **No guessed APIs.** Agents work from the cookbook and the installed source.
- **Deviations go in the log before they merge.**
- **The look can't drift from the Atlas.** Lint bans colour and pixel literals outside the generated stylesheet, and the renderer reads only the palette texture.
- **People approve the art.** The art director signs off frames weekly, not at the end. The agent never approves its own visuals.
