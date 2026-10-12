# The Floor

A local, working atlas of Base markets, research desks, policy receipts, community designs, and testnet launch preparation. The interface uses Foldkit; the server uses native Effect services, HTTP APIs, RPC streams, SQL repositories and migrations. Three.js draws the instruments.

## Run locally

Requires Bun 1.4.0 or later. Run these commands from this directory:

```sh
bun install --frozen-lockfile
bun run build
bun run start
```

Open **http://127.0.0.1:8787**. The server creates `.data/floor.sqlite` and applies its migrations. No paid service credentials are needed to explore the atlas, replay its recorded day, create desks, confirm limits, or save alerts and moorings. Capturing plates also requires Chromium, as described below.

For development, run `bun run dev` and open **http://127.0.0.1:5173**. This owns both the API process and Vite; Ctrl-C closes both. The development app includes Foldkit time travel and its local developer relay.

Copy `.env.example` to `.env` when adding services. Keep `.env` private. Credentials are decoded as `Config.Redacted` values on the server and are never sent to the browser.

## What the local app does

- Reads actual Base pool state and sampled swap windows. The included recording contains 25 hourly source blocks and 14 indexed markets spanning constant-product pools, concentrated-liquidity pools and a Virtuals bonding curve.
- Shows source blocks, reserves, prices, measured flow and historical readings. Missing measurements stay unavailable. The orange instrument follows the busiest measured market.
- Persists market history, fixed market positions and block-specific district tiers in SQLite. Tier promotion uses actual disjoint flow observations; partial coverage cannot establish inactivity. Replay uses the same client rendering path and historical tier assignments.
- Renders saved plates from retained source data in an isolated browser, with their block hash and observation time. Capturing a plate pins its source block against retention and later replacement; uploaded client images cannot become source evidence.
- Places actual public agent emblems and confirmed receipt marks on the atlas and chart. Replay admits evidence only after its observation time; chain heights are compared only within the same chain, and testnet receipts are labelled as such.
- Creates owner-scoped agent desks with a mandate, emblem, daily inference budget and explicitly confirmed limits. A public desk exposes its public identity and research; private mandates, budgets and account details stay with its owner.
- Records policy decisions and receipts outside the model. Signing is limited to Base Sepolia through an owner-authorized scoped account service, with fresh account facts, simulation, an atomic dispatch reservation and explicit uncertain outcomes.
- Prepares exact ETH withdrawals to the verified owner wallet, including from a paused desk. Every withdrawal requires owner review; the client cannot choose a recipient or claim a dollar valuation.
- Checks submitted designs as data, renders their actual kit geometry in a separate browser page, and uses native Effect `DecisionModel` judgments when visual inference is configured. Missing evidence or unavailable review leaves the submission pending.
- Lets verified token holders propose accepted designs and vote with exact balances from a fixed Base block. Adoption requires a full 72-hour ballot, 1% of token supply participating and a majority in favor. The same wallet cannot multiply its weight across sessions. Adopted geometry retains the protected market instruments.
- Applies the full launch gate to exact proposal metadata before approval or signing. Research assertions are checked against the market reads the agent actually used; public notes also require verified holdings evidence from the bound account's matching chain.
- Serves read-only MCP tools at `/mcp`, the printable tide table at `/api/tide-table`, permanent plate pages at `/plates/:number`, and the `<floor-works>` embed through `/embed.js`. Market and public-desk share pages use the same trusted renderer for cached image previews; private desks return no public page or image.

The first visit establishes a local owner session. A wallet signature can bind an owner address; that signature authorizes no transaction. `FLOOR_LOCAL=true` is intended for the local workspace, whose server binds to loopback by default. This delivery does not provision public hosting.

## Connect services when ready

| Capability | Configuration |
| --- | --- |
| Base state and logs | `BASE_RPC_URL`, `BASE_LOG_RPC_URL`; public read-only endpoints are supplied by default |
| Metered agent inference | `OPENAI_API_KEY`, `INFERENCE_MODEL`, `INFERENCE_INPUT_USD_PER_MILLION`, `INFERENCE_OUTPUT_USD_PER_MILLION`; optionally `INFERENCE_API_URL` |
| Read-only research browser | `BROWSERBASE_API_KEY`, optionally `BROWSERBASE_PROJECT_ID` and `BLOCKED_BROWSER_DOMAINS` |
| Visual design review | `OPENAI_API_KEY` and `GATE_MODEL`, an image-capable model; optionally `GATE_BROWSER_EXECUTABLE` |
| Scoped testnet accounts | `FLOOR_SIGNER_URL`, `FLOOR_SIGNER_TOKEN`, and per-owner account authorization described in [the signing protocol](docs/scoped-accounts.md) |
| Testnet casting | `FLOOR_FOUNDRY_ADDRESS` plus exact supply, fee, graduation threshold and virtual liquidity using the `FLOOR_FOUNDRY_*` fields in `.env.example` |

Rates are explicit configuration so the budget does not depend on a guessed model price. An unconfigured provider reports its missing setup in the service ledger. Endpoint configuration alone is not proof that an account has authorized a policy or that an external provider is reachable.

The design and plate renderers need Chromium. Install its bundled browser with `bunx playwright-core install chromium`, or set `GATE_BROWSER_EXECUTABLE` to an installed Chrome executable. The browser suite uses the Chrome channel: `bunx playwright install chrome`.

## Verification

```sh
bun run format:check
bun run typecheck
bun run lint
bun run test
bun run build
bun run check:bundle
bun run test:e2e
bun run test:contracts
bun run bench --scenario all
```

The test suite requires Foundry (including Anvil) and Chromium: the named flows mine real transactions on an isolated local chain and render submitted designs in a real browser. `bun run test:contracts` runs the additional Solidity suite. Browser tests launch an isolated local server and database; failures retain screenshots, traces and video. `bun run test:demo` shows the browser journey in a visible Chrome window. See [verification and bundle budgets](docs/Codex/verification.md), [market sources](docs/Codex/market-data.md), and [lint rules](docs/Codex/lint.md).

The tests use native `@effect/vitest` layers, controlled time, real SQLite transactions and actual browser rendering. A local collector also verifies that the configured native OTLP tracer flushes its service span on shutdown. Test provider layers live beside their production services. Import rules keep fixture data out of production and inference out of signing.

External inference, Browserbase, an authorized remote signing account, public preview hosting, and physical-phone performance require their respective services or devices. Local fixture, Anvil, and Chrome results do not establish those external outcomes. No mainnet funds are used by this application.

## Code layout

| Package | Responsibility |
| --- | --- |
| `contract`, `settings` | Shared schemas, policy states, typed defaults |
| `markets`, `districts` | Base reads, normalization, durable history, aggregation and stable positions |
| `agents`, `research` | Metered research, browser policy, notes, theses and verification |
| `signing`, `foundry` | Owner policy, approvals, single-dispatch signing, token and allocation-lock contracts |
| `gate`, `kit`, `renderer` | Declarative designs, review checks, instrument geometry and rendering |
| `surfaces`, `server` | Shared HTTP/RPC contracts, authentication, SQLite repositories and local composition root |
| `frontend` | Feature-based Foldkit views, commands, subscriptions and scoped drawing/audio lifetimes |

The server entry point composes production layers in `packages/server/src/local.ts`; domain services capture their dependencies when their layer is built. Config, clock, crypto, HTTP, SQL, browser lifetimes and streaming come from Effect or its platform packages. Third-party boundaries decode through Schema and turn failures into named domain errors.

## Diagnostics

`FLOOR_DEVTOOLS=true` connects the server to an Effect inspector, defaulting to `ws://localhost:34437`. OpenTelemetry uses native `OTEL_*` configuration; set the desired exporters to `otlp` and provide the collector endpoint. Exporters are scoped and flush when the server shuts down. `NODE_ENV=production` selects structured JSON logs. Credentials are not trace attributes.
