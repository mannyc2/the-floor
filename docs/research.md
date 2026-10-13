# Research

The facts behind the Floor's defaults: where memecoin activity is, which launchpads, market data, wallets, funding, custody and costs. What the Floor decided is in the [decision log](decisions.md); this doc holds the evidence and the alternatives.

Almost everything here was checked on 12 October 2026. Market shares and prices move, so recheck anything before relying on it, and treat figures marked *unverified* as leads. Nothing here is legal advice. Legal review before real money is non-negotiable.

## Chains and where memecoin activity is

**Finding.** Launchpad fees by chain, a proxy for memecoin activity, for the week of 6 October 2026 ([DefiLlama fees by protocol](https://defillama.com/fees), read 12 October):

| Chain | Share of launchpad fees |
| --- | --- |
| Solana | 59% |
| BNB Chain | 25% |
| Robinhood Chain | 13%, down from 67% in its peak week (1–7 September) |
| Base | 2% |

Fomo's own fees over the 30 days to 12 October split Solana 53.5%, Robinhood Chain 27%, BSC 7% and Base 2% (source not recorded).

- **Solana is where the volume is.** Pump.fun alone sees tens of thousands of launches a day, which is why no token gets a permanent place on the floor.
- **Robinhood Chain is fading.** It went live on mainnet on 1 July 2026 ([The Block](https://www.theblock.co/news/business/2026-07-01-robinhood-chain-goes-live-mainnet-alongside-24-7-tokenized-stocks-lighter-perps-planned-crypto-agentic-trading-406918)). Pons's weekly fees fell from $52.5M at the peak to $3.5M, and the chain's 90-day gas subsidy ended on 29 September.
- **BNB Chain has the second-largest share,** but no launchpad there offered an integrator SDK with a fee share, and Doppler isn't deployed there.
- **Base is small for memecoins,** but it comes almost free through the EVM adapter, and the existing Doppler construction targets it.

**What the Floor does.** Solana first. An EVM chain comes next, as a second floor; choose it from fresh numbers when it's needed, and recheck BNB Chain's launchpad SDKs then. The shares above come from public data, so confirm them against launch activity by chain before choosing.

## Launchpads

Checked 12 October 2026.

| Chain family | Default | Fallback | Watch |
| --- | --- | --- | --- |
| Solana | Meteora Dynamic Bonding Curve | Raydium LaunchLab, which can't change curve maths or graduation | Pump.fun, which documents no platform fee for integrators |
| EVM | Doppler | Clanker v4 | Zora Coins and Flaunch, both tiny on Base |

- **Meteora's [Dynamic Bonding Curve](https://docs.meteora.ag/developer-guides/dbc)** covers partner fees (80% of trading fees, split between the partner and the creator), anti-sniper fee schedules, locked vesting with a cliff from migration, LP locks, automatic migration into DAMM v2, and state reads. Its 2.0 SDK was due on 16 October 2026 with breaking changes ([changelog](https://docs.meteora.ag/developer-guides/dbc/changelog)). The Floor doesn't ship the SDK. It uses a Codama-generated Kit client from Meteora's program IDL and maths ported from SDK 1.5.13, with the SDK as a dev-only oracle (see [the chains package](../packages/chains/README.md)). Recheck both against 2.0.
- **[Doppler](https://docs.doppler.lol/)** is one SDK for EVM chains, with curves or auctions, vesting, integrator fee shares and migration to Uniswap. The Floor imports only its `/evm` entry and so far constructs only the Base multicurve path.
- **Unverified:** Doppler on Solana mainnet, Clanker on BNB Chain, and the rent cost of Meteora configs.

**What the Floor does.** Launching stays a feature, but the mechanism is still an [open item](decisions.md#open-items): which launchpads, who launches, how a launch is paid for, and what the Floor earns. Meteora on Solana and Doppler on EVM are the starting point.

## Market data

Checked 12 October 2026.

| Role | Provider | Notes |
| --- | --- | --- |
| Default | [Codex](https://docs.codex.io/launchpads.md) (codex.io) | Launchpad and pool events on Solana, Robinhood Chain and Base. A data provider, not the coding app of the same name |
| Fallback | GeckoTerminal | Cheaper. Its WebSocket was in paid beta |
| Watch | Helius LaserStream | Raw Solana streams, if Codex falls short |
| Watch | Bitquery | Robinhood Chain coverage |

**What the Floor does.** Codex is read only for tokens an agent holds or is working on, or that have a piece, so cost tracks the floor rather than the whole market. Direct chain reads cover the Floor's own launches and anything Codex doesn't reach. A Codex account is billed separately, so it needs the owner's approval. It's needed by Stage 3.

## Wallets and the agent's second key

Checked 12 October 2026. Solana policy scope and ownership permissions rechecked against Privy's documentation and installed SDK 0.35.0 on 13 October; no provider API call or sandbox run was used for that review.

**Findings:**
- **Privy** gives sign-in by email, social login or passkey, embedded wallets on Solana and EVM chains, policies on both, gas sponsorship, and card and bank funding through Stripe and Bridge. Stripe owns it, and Fomo runs on it ([Privy on Fomo](https://privy.io/blog/turning-trading-into-a-social-experience-with-fomo)).
- **Its two-of-two arrangement** pairs the agent's key with the Floor's signer, so neither can sign alone ([two-of-two server in the loop](https://docs.privy.io/recipes/wallets/two-of-two-server-in-the-loop)).
- **Solana policy conditions apply per instruction.** The [policy overview](https://docs.privy.io/controls/policies/overview) and [Solana examples](https://docs.privy.io/controls/policies/example-policies/solana) describe program allowlists and direct-transfer amount and recipient conditions. Several individually allowed transfers can exceed one instruction's cap; these conditions do not establish a transaction-wide spending or CPI destination guarantee. Privy documents rejection when an address condition needs an account found only in an address lookup table. Aggregate, CPI and lookup-table behavior remain unproved in the Floor. [Stateful aggregation](https://docs.privy.io/controls/policies/stateful-policies) currently supports Ethereum methods, not Solana; daily loss and position limits remain unverified.
- **The policies are enforced by Privy, not on-chain.** Keys are reconstructed inside AWS Nitro Enclaves, where most policy checks run ([architecture](https://docs.privy.io/security/wallet-infrastructure/architecture), [policy boundaries](https://docs.privy.io/security/wallet-infrastructure/policy-and-controls)). A policy's owner controls its rules, but the wallet's owner controls which policies are attached ([policy updates](https://docs.privy.io/controls/policies/update-a-policy), [owner permissions](https://docs.privy.io/controls/authorization-keys/owners/overview)). Separate policy ownership alone cannot make the owner's limits immutable to a party that owns the wallet: that party can replace the attachment. The Floor has not established the required owner-only control over both paths.
- **Export depends on Privy running,** so it isn't a recovery plan ([export](https://docs.privy.io/wallets/wallets/export)).
- **Turnkey's delegated access** makes the human the only root, with a restricted agent below it ([delegated access](https://docs.turnkey.com/features/policies/delegated-access/overview), [agent wallets](https://docs.turnkey.com/features/policies/delegated-access/agentic-wallets)). Its root bypasses policies, so neither the agent nor the Floor may ever hold root. Moonshot uses it.

The wider comparison was priced for funded, user-owned agents on Base, so it is EVM-centred:

| Provider | Strength | Limitation for the Floor |
| --- | --- | --- |
| Privy | Consumer onboarding, with an owner plus additional-signer model | Hosted signing is costly at volume. Policies are vendor-enforced. Its smart-wallet and export UI are React-first, and the Floor's client is Foldkit |
| Turnkey | The most detailed delegated access and enclave policies; framework-neutral | High posted per-signature prices; root bypasses policies |
| thirdweb | An integrated TypeScript stack with current session-key restrictions | Session features differ by account type, and some account factories keep upgrade power |
| Dynamic | Packaged embedded wallets with delegated access | Production delegation needs Enterprise, and its policy layers are in early access |
| MetaMask Embedded | Cheap per-wallet pricing, with export always on | Unattended authority needs another layer |
| Coinbase CDP | Simple per-operation pricing | Delegated signing scope is broad, with per-transaction rules only |
| Magic, Crossmint, Dfns | Narrower fits: Crossmint for bounded payments, Dfns for institutional custody | Magic's bounded offline delegation wasn't established |

**The recommendation: separate ownership from routine execution.** The owner controls ownership, recovery and permission changes. The agent and the Floor get only explicit, limited authority, and those limits hold even if the Floor's credentials are stolen. The owner's independent way out is configured before any wallet is funded. On EVM chains the limits can live on-chain in a smart account (Kernel, Alchemy Modular Account, Safe); the research didn't cover Solana's equivalents.

### Limits that must survive a compromised agent

These are written for EVM accounts; Solana has its own equivalents, such as token delegates.
- **Bind where money goes.** Proceeds and withdrawals go only to the owner's account; allowlisting a token doesn't bind the recipient.
- **Constrain the actual operation.** An allowed router with an existing approval can move tokens without a direct token call. Revoking a key doesn't remove approvals or close positions, so clear leftover approvals.
- **Budgets can't reset.** They aggregate across calls, batches and concurrent sessions, and rotating a key doesn't refill them.
- **Every trade is bounded.** Supported assets, input limits, a meaningful minimum output and an expiry.
- **No hidden exposure.** Borrowing, leverage and collateral are restricted; a transfer budget doesn't bound a liquidation.
- **Allowlisted contracts can change.** A fixed address doesn't mean fixed behaviour, so check upgrade authority.
- **The agent can't widen its own authority.** No owner changes, module installs, upgrades or permission increases on any path, and no unrestricted message or permit signing.
- **Revocation races pending work.** Bound outstanding authority instead of promising instant reversal.
- **Fleet exposure.** A compromised deployment can use every agent's outstanding permission at once. Separate keys bound each agent, but not the total.

### Before owners' money

The evaluation plan compares three complete configurations: Privy or Turnkey as the owner's wallet with Kernel accounts and a separate agent signer; thirdweb end to end; and a custom AWS Nitro signer beside Cloudflare with user-owned accounts. Each passes only if independent recovery, the agent's exact scope, owner-only policy changes and the real bill all hold. All three are EVM designs, so a Solana version of this comparison is still to do.

Before funded production, prove that:
- a compromised agent runtime and its credential can't redirect proceeds, exceed budgets, replace owners or widen permissions;
- approvals, permits, batches, concurrent signers, key rotation and router calls all stay inside the limits;
- altered signing code, or a single administrator credential, can't get keys released;
- with the Floor's services down, the owner can still revoke and withdraw through other infrastructure;
- normal and burst load, failover and gas per action are measured against managed quotes;
- the deployed contracts match reviewed versions, and the integration has an independent review.

**What the Floor does.** Privy is the default, through the native client in [`packages/wallets`](../packages/wallets/README.md), with Turnkey as the fallback. In the first milestone the Floor owns its own agents' wallets: a handful of agents, and the only money at risk is the Floor's. The sandbox check (wallets, the two-of-two quorum, a policy, an allowed and a refused transaction) is open in [the platform](platform.md#wallets). Before Stage 3 trading, prove the required Solana limits and owner-only control of policy rules and wallet attachments. The [technical design](technical-design.md#the-signer) still requires those limits to survive a compromised signer; a local check does not discharge that requirement. Before owners arrive in the second milestone, also revisit the owner's independent exit and the cost of signing every action. No replacement enforcement architecture has been approved.

## Funding and on-ramps

Checked 12 October 2026.

| Role | Route | Notes |
| --- | --- | --- |
| Default | Privy's Stripe on-ramp, and Bridge bank accounts | Card, Apple Pay, Google Pay and ACH, landing as USDC |
| Fallback | Coinbase Headless Onramp | US only. Its guest checkout ended on 30 June 2026 |
| Watch | MoonPay | Around 3.99% on cards (unverified) |

- **Unverified:** the Stripe on-ramp's US state exclusions, which on-ramp Fomo uses, and Privy's gas sponsorship on Robinhood Chain.
- **Considered and not adopted:** a custodial dollar balance through the wallet provider's licensed partner. It is simpler for owners, with bank-like deposits and withdrawals, but it makes the partner the custodian, needs an enterprise plan, and breaks the non-custodial guardrail.

**What the Floor does.** In the second milestone, owners add money by card or bank transfer and it lands as USDC. Each agent's wallet pays its own gas; the Floor doesn't sponsor it at first.

## Custody and regulatory notes

Checked 12 October 2026. These are not legal advice.
- **What looks custodial.** A signer with no policies, or a server wallet only the Floor controls, looks custodial. A two-of-two quorum, or the owner as the only root, supports the non-custodial claim. A setup where the Floor's key is needed for the owner's own exit weakens it.
- **No safe harbour.** The CLARITY Act, which carried a developer safe harbour, failed its Senate cloture vote 49–50 on 15 September 2026.
- **Where the weight is.** Agents trading owners' money, launching tokens, and publishing notes about tokens all carry regulatory weight that varies by jurisdiction. Paying authors a share of fees when others copy their agents' mandates could look like paid investment advice.

**What the Floor does.** Real money only after legal review; until then, trades run on a fork. The first real money is the Floor's own, which keeps customers' money out of the first milestone, but it still waits for that review.

## Costs

Prices were checked on 12 October 2026, and vendors change them. Billing units differ (signature, request, operation, active user), so compare quotes rather than list prices.

**Wallet signing at volume.** As an illustration, 1,000 agents taking 10 actions a day is 300,000 actions a month:

| Design | Monthly cost | Basis |
| --- | --- | --- |
| Privy hosted signing | About $4,500 | $2,000 base plus $0.01 a signature above 50,000 ([pricing](https://www.privy.io/pricing)) |
| Turnkey Pro | About $15,000 | $0.05 a signature ([pricing](https://www.turnkey.com/pricing)) |
| Coinbase CDP | About $1,475, or $2,975 to sign and broadcast | $0.005 an operation ([pricing](https://docs.cdp.coinbase.com/wallets/pricing)) |
| Magic | About $1,250 to $1,349 | $0.005 a signature after 50,000 ([pricing](https://magic.link/pricing)) |
| Alchemy Wallet APIs | About $750 | Compute units, before the signer and gas ([pricing](https://www.alchemy.com/pricing)) |
| thirdweb | About $200 to $300 | Request bands, provisional ([pricing](https://thirdweb.com/pricing)) |
| Custom: a KMS key per agent | About $1,005 | 1,000 keys at $1 each, plus signing ([pricing](https://aws.amazon.com/kms/pricing/)) |
| Custom: a Nitro signer beside Cloudflare | $300 to $500 in infrastructure | Before engineering, audits and on-call |

At low volume the picture is different. Privy is free below 500 monthly active users, then $299 a month (Core, up to 2,499) or $499 (Scale, up to 9,999), with usage pricing above 10,000 users or 50,000 signatures. It also lists a $1M transaction-volume trigger without a clear calculation; ask Privy about it before agents trade at size. A curated first milestone with a handful of the Floor's own agents should sit in the free tier; that's an inference from the price page, not a quote.

The bill depends on the architecture. If an owner grants a restricted signer authority once, routine actions needn't each be a hosted owner signature; a hybrid of Privy Core and a $400 custom signer would be about $699 a month at the volume above. Ask vendors for quotes that separate owners, wallets, owner signatures, agent signatures, execution calls, policy checks, retries and gas markup. Confirm key export, shutdown recovery, signer revocation, and who can change policies or account code.

**Cloudflare.** On the $5 Workers Paid plan, a month of 1.5 million Worker requests, 300,000 Durable Object requests and a few million D1 rows fits inside the included allowances, so core hosting is about $5 a month ([Workers](https://developers.cloudflare.com/workers/platform/pricing/), [Durable Objects](https://developers.cloudflare.com/durable-objects/platform/pricing/), [D1](https://developers.cloudflare.com/d1/platform/pricing/)). Durable Objects left active around the clock would change that. The plan includes 10 browser-hours of Browser Run a month. The spending rules are in [the platform](platform.md#spending).

**Inference.** OpenAI's [Decisions API](https://developers.openai.com/api/docs/guides/decisions) (`gpt-6-luna`, in public beta) charges $0.10 per million input tokens and nothing for output. An always-on agent asking three 10,000-token questions every five minutes would cost about $26 a month, which is why a cheap agent loop built on it was considered; it wasn't adopted. The default models are Claude Haiku 5.5 for routine steps and Claude Sonnet 5.5 for theses. Their prices weren't part of this research.

**What the Floor could earn.** Meteora gives 80% of trading fees to the partner and the creator, split between them. Fomo charges about 0.5% on spot trades ([Datawallet](https://www.datawallet.com/crypto/fomo-app-explained), updated 17 August 2026). The Floor's lean is a subscription per desk with a model allowance, plus a share of launchpad fees, and no fee on trades, because that would reward churn ([product doc](the-floor.md#open-questions)).
