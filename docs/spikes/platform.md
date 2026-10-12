# Platform spike handoff

Status: **authorized 12 October 2026; not yet run.** Results go in [`evidence/platform/`](evidence/README.md).

## Purpose and scope

Prove the runtime-sensitive parts of the revised Floor on Cloudflare Workers and Durable Objects before Stage 0. Read-only inspection of the first build establishes useful starting versions; it does not establish Workers compatibility. The platform and [look spike](./look.md) can run in parallel once their prerequisites are settled.

A bounded spike may establish the smallest real examples needed to answer the questions below. It does not start Stage 0, port the old app, build the product, approve the art, or authorize real funds. A successful import, typecheck, local Bun run or mocked response never counts as a hosted compatibility result.

## Build it the Alchemy way

Alchemy v2 (`alchemy@2.0.0-beta.81`, the current release) is Effect-native. It is how the Floor's Workers, Durable Objects, bindings, local runs, tests and deploys are written, not only how they are deployed. The spike doesn't use `wrangler.jsonc` or `wrangler dev`. `effect-cf` appears only underneath Yielded's Cloudflare adapter (`@yielded/agent-platform-cloudflare` requires it), inside the agent's Durable Object. The Floor's own Workers and Durable Objects are Alchemy resources. If Alchemy can't do something the spike needs, that is a finding for the decision log, not a reason to drop down to Wrangler.

**Where to look:**
- **Docs.** Look up the page you need in [llms.txt](https://alchemy.run/llms.txt), and use the [Cloudflare tutorial](https://alchemy.run/cloudflare/tutorial/part-1) parts 1–5 for the basics. The cafe snapshot is an example, not the source.
- **Credentials.** The owner signs in once with `bun alchemy profile edit --add Cloudflare`, and the profile is saved to `~/.alchemy/profiles.json`. There are no `CLOUDFLARE_*` variables locally. State is remote, through `Cloudflare.state()`.

**How the Floor is built on it:**
- **Stacks.** One root `alchemy.run.ts` holds the Floor and the web app. The signer is its own Stack, deployed separately, and the Floor reaches it through a typed cross-stack reference.
- **Workers and Durable Objects.** Write them as `Cloudflare.Worker` and `Cloudflare.DurableObject`. Their outer Effect runs at plan time as well as at runtime, so it stays free of side effects. Bindings (D1, R2, Durable Object namespaces, the browser) come in as Layers.
- **Scheduled work.** Agent wakes and approval expiry use durable callbacks (`Alchemy.makeCallback`), scheduled inside a storage transaction so the write and the job commit together. Delivery is at least once, so side effects carry idempotency keys.
- **Browsers.** The `Cloudflare.Browser` binding provides quick actions, including `screenshot`, for plates. Its `raw` binding feeds Yielded's Cloudflare adapter (`@yielded/agent-platform-cloudflare`) for agents' sessions.
- **The agent's Durable Object.** Yielded's thread object, built on `effect-cf`, is the agent runtime. The spike proves Alchemy deploys it and binds it to the Floor's Worker.
  - If Alchemy can't, there are two ways forward, and the choice and its reason go in the decision log:
    - build the agent object as an Alchemy Durable Object on Yielded's core and SQL storage;
    - or run the agent Worker on `effect-cf`, with Alchemy deploying it as a plain module.
  - Two Cloudflare runtimes elsewhere in the app is not an option.
- **Web and API.** The web app is `Cloudflare.Website.Foldkit`. The Effect HttpApi and RPC are served from the Worker as in the Effect HTTP API guide.

**Running it:**
- **Locally.** `bun alchemy dev` runs Workers in local workerd and other resources in a cloud stage.
- **Tests.** Use Alchemy's test harness (`Test.make`), with `dev: true` for local runs and `deploy(Stack)` and `destroy(Stack)` for hosted ones.
- **Deploys.** `bun alchemy deploy --stage <name>` shows the plan before it applies, and `bun alchemy destroy --stage <name>` tears the stage down.

## Read first

1. [Next steps](../floor-docs-2026-10-12/next-steps.md), especially the platform spike and the items to settle before Stage 0.
2. [Technical design](../floor-docs-2026-10-12/technical-design.md): the agent runtime, CAFE, app boundaries, verification and Stage 0.
3. [Effect 4 cookbook](../floor-docs-2026-10-12/effect-4-cookbook.md), particularly SQL, AI, Yielded Agent, browsers and scoped resources.
4. [Active decision log](../decisions.md) and [source inventory](../reference-sources.json).
5. The repository's `AGENTS.md` and `docs/Codex/comments.md` before non-trivial code, and `docs/Codex/file-structure.md` before adding files. Before any Effect change, read the installed `node_modules/effect/AGENTS.md` in full.

Read the installed package exports, types and implementation before choosing an API. Check current primary documentation only where installed source does not settle the question, and record both the documentation date and the exact installed version. Do not treat a guide for another version as proof an export exists.

## Prerequisites still pending

| Item | Current state | Needed before dependent work |
| --- | --- | --- |
| Cloudflare | Owner signs in once with `bun alchemy profile edit --add Cloudflare` | Then confirm access to Workers, Durable Objects, D1 and Browser Rendering through that profile |
| Privy | Access and credentials not inspected | Identify the configured sandbox application and intended co-signing arrangement; ask only if missing or ambiguous |
| Inference providers | Access and credentials not inspected | Use the configured test providers within a small model budget; ask only if a choice or limit is missing |
| Codex market-data provider | Access and credentials not inspected | Identify the configured data-provider account referenced by the product docs; this is distinct from the coding app |
| Browserbase | Conditional, not selected | Account needed only if evidence selects it as a browser fallback |
| Temporary stage | Not chosen | Unique non-production stage, resource list, cleanup plan and budget |
| Renderer input | Awaiting look-spike coordination | A bounded scene from the real renderer, with its source revision and assets, suitable for a plate check |

Use provider access through the intended secret mechanism. Never print or copy secret values into this handoff, evidence, commits, logs or reports. Record only access status and the non-secret identity of the chosen sandbox. Missing access leaves the corresponding check pending; already-configured access does not need another approval simply to be used within the later authorized task.

## Starting versions and traps

These are observations from the first build on 12 October 2026. They are reference inputs, not the new workspace's dependency installation.

| Area | Observed starting point | Required resolution |
| --- | --- | --- |
| Toolchain | Bun 1.4.0; TypeScript 7.0.2; oxlint 1.87.0; oxlint-tsgolint 7.0.2003; `@effect/tsgo` 0.51.1; effect-oxlint 0.4.0; oxlint-plugin-effect 0.28.1; dprint 0.63.0 | Preserve compatible pins when installing the spike. Keep `prepare: effect-tsgo patch --typescript --oxlint`. The old compiler reports `7.0.2+effect-tsgo.0.51.1`. |
| Effect | `effect` 4.0.0 | There are no `effect/unstable/*` paths. Relevant exports live at paths such as `effect/ai`, `effect/http-api`, `effect/rpc` and `effect/sql`, with stability annotations. |
| API boundary | The revised design selects `packages/api` | Keep `contract` as Schemas only. Record the narrow API stability exception in the active decision log; do not copy the first build's broad internal allowlist. |
| Yielded | `@yielded/agent` 0.1.0-beta.166 | Generic browser capabilities exist, but the documented `CloudflareBrowser` export is absent. Resolve the real package, version and exports before implementation. |
| Browser alternatives | effect-browser and effect-browserbase 0.3.0-beta.14 | Inspect the selected versions. Local `Chromium.open` requires Bun or Node and is for development and flows; it is not a Worker implementation. |
| SQL | `@effect/sql-sqlite-do` and `@effect/sql-d1` 4.0.3 exist in old `node_modules` | Neither is in the old lockfile. Add exact dependencies and a reproducible lockfile if selected; installed leftovers are not reproducible dependencies. |
| AI providers | `@effect/ai-openai` 4.0.0 | It has no Decisions provider. Inspect the old adapter as a reference; do not invent a native export. No Anthropic provider was installed in the first build. Resolve and verify it before relying on Claude defaults. |
| Alchemy | `alchemy` 2.0.0-beta.81, the current release (5 October 2026), with `effect` ^4.0.0 as a peer | Pin it with `@alchemy.run/frontend-frameworks` at the same version. The cafe snapshot carries a patch for duplicated Workers AI streaming text; keep it only if the Floor uses that path. |
| Cafe patch | `patches/alchemy@2.0.0-beta.81.patch` | It deduplicates mirrored Workers AI streaming text. Assess whether the selected Alchemy version still needs it; do not silently discard or carry an unrelated patch. |
| Launch SDKs | Meteora's DBC SDK 1.5.13 depends on `@solana/web3.js` v1, Anchor, `bn.js` and `spl-token`, and its maths uses `bn.js`. Doppler 1.0.43 depends on `viem` and `@solana/kit` 6. Privy lists Kit ^5 and `viem` as optional peers. Kit's latest is 8.4 | Follow the dependency rule in check 2: a Codama-generated Kit client and ported `bigint` maths for Meteora, no web3.js stack. The source docs anticipate a breaking Meteora SDK release; a planned release date is not an installed API. |

Use Bun for this workspace. Cafe's pnpm configuration is reference material, not a package-manager instruction for the Floor. The old Floor's `build` creates a Bun server and the old CI targets superseded code; neither establishes the new runtime's readiness.

## Checks to execute later

Every check below starts **not run**. Keep local and hosted results separate.

### 1. Agent Durable Object and browser

Resolve the Yielded Cloudflare adapter package and version, then inspect `DurableAgentRuntime`, `WakeScheduler`, capture, interactive-browser, browser-use and code-executor capabilities before wiring them. Prove a bounded agent loop inside an actual `Cloudflare.DurableObject`, woken by a durable callback (`Alchemy.makeCallback`) independently of market polling. Record what survives object restart and how sessions and resources are released.

Demonstrate page capture and an interactive navigation/action sequence through the selected hosted browser. Prove that the desk's live view can display the active session and that owner takeover works; describe the supported ownership and resume behavior from the installed API. Observe idle expiry and reconnection. The source docs report a maximum ten-minute gap between commands; verify the selected provider/version's limit rather than assuming it still holds.

**Open-web containment is unresolved.** The documented Cloudflare adapter cannot enforce `PublicWeb`. Compare these explicit alternatives and log the selected policy before accepting the browser result:

- A deny-by-default host allowlist, with its product limitation stated.
- `Unrestricted` behind the Floor's own enforcement, with the exact deny rules and tested enforcement points recorded.
- Open-web sessions on another provider, with Cloudflare retained only where its policy can be enforced.

Do not rename an unrestricted session `PublicWeb` or regard a model instruction as network enforcement. Use only controlled test endpoints for prohibited-destination and redirect checks; record navigation, capture and subresource behavior relevant to the chosen policy. A provider or runtime deviation belongs in the decision log. Browserbase through effect-browserbase is the fallback Layer to evaluate if Cloudflare cannot meet the requirement.

Local Chromium through effect-browser is a separate development/flow route. Verify its interface compatibility where useful, but label its evidence local. It does not pass the Cloudflare check and must not cause routine local flows to buy hosted sessions.

### 2. Wallet co-signing and launch construction

Inside a Worker, exercise Privy's server SDK against the identified sandbox using the intended co-signing arrangement. Record the chain family, sandbox wallet references, authorization method, SDK version, request result and refusal/error behavior. Use sandbox test value only; do not use real funds, production wallets, mainnet broadcasts or a real token launch.

Inside the Worker, construct the smallest representative launch transaction for each chain family, following the dependency rule below.

**Dependencies.** Effect's own modules come first. Past that, use one library per chain family, behind one service edge:
- **Solana** uses `@solana/kit`, pinned to one major (8.x), with its RPC transport built on Effect's `HttpClient`. That keeps retries, timeouts and tracing in Effect.
- **No web3.js stack.** No `@solana/web3.js`, Anchor, `bn.js` or `@solana/spl-token` in any Worker bundle.
- **Meteora** gets a Kit client generated with Codama from the DBC program's Anchor IDL (`packages/dynamic-bonding-curve/src/idl/dynamic-bonding-curve/idl.json` in Meteora's SDK repo, program `dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN`). Regenerate it when the program upgrades. The quote, fee and curve maths the Floor needs is ported from Meteora's `src/math` to native `bigint` as pure functions. The official SDK may be a dev-only test oracle, checking our instructions and quotes against its output, but never a production dependency.
- **EVM** uses `viem`, which Doppler and Privy already require. Doppler builds the EVM launch. Its own `@solana/kit` 6 dependency must not reach a bundle that doesn't use it; record whether it does.
- **Privy.** Try a small Effect client over `HttpClient` for the handful of endpoints the Floor uses: wallets, policies, key quorums and signing. Request authorization signatures are P-256 over canonical JSON, through Web Crypto. `@privy-io/node` (nine dependencies) may serve as a dev-only oracle for those signatures. If the native client proves fiddly, use the SDK behind the wallets edge and record it. Capture the selected venue, network/checkpoint where applicable, construction inputs, serialized-output digest and incompatibilities. Construction does not prove broadcast, graduation, vesting, migration or allocation locks. If simulation is feasible within the approved sandbox/fork scope, record it separately; later launch flows remain Stage 4 work.

Keep wallet and launch SDKs behind their respective service boundaries. The signer example must not import inference or the agent runtime. Preserve foreign failures as causes of typed errors. A Node-only or unsupported dependency is a measured incompatibility to resolve and log, not a reason to quietly move signing back to Bun.

### 3. Headless rendering

Have Cloudflare Browser Rendering produce a plate, through the `Cloudflare.Browser` binding's `screenshot` action, from a bounded scene using the real browser renderer, in coordination with the look spike. Record renderer revision, asset digests, scene specification, camera, clock, viewport, device pixel ratio and the resulting image digest. Prove the scene actually rendered and distinguish browser startup, asset loading and rendering failures.

Keep three.js in the web renderer. The Worker orchestrates Browser Rendering; importing three.js into a server rendering fallback does not satisfy this check. An image copied from disk, an old screenshot, a blank placeholder or an unrelated rendering sample does not count. If the real scene is not ready, retain a dependency status rather than marking the check passed. This checks platform execution, not artistic acceptance.

### 4. Storage

Start with Alchemy's own storage paths: Durable Object storage with `Cloudflare.SqlMigrations`, and D1 through Alchemy's Effect SQL guide. Try `@effect/sql-sqlite-do` only if those fall short. Run the checks under `bun alchemy dev` and on a deployed stage. Prove schema initialization/migration, write/read and persistence across the relevant Durable Object lifecycle or fresh request. Test a minimal transaction with an intentional failure and verify its actual rollback semantics. Record any difference between local emulation and the hosted binding.

Identify the proposed history and journal stores explicitly. For the Durable Object journal, prove the transaction primitives needed for atomic conditional updates and report concurrency limitations; the full receipt, restart and power-loss suite remains Stage 4 work. Do not assume D1 and Durable Object SQLite provide identical transactions. A successful in-memory or Bun SQLite test is not evidence for either binding.

### 5. Web Crypto

Replace the first build's `BunServices` dependency at the crypto boundary with Web Crypto in the bounded Worker example. Identify each required operation from the actual consumer, then verify it on workerd and the hosted stage using known test inputs where meaningful. Record algorithm, encoding, expected output or invariant, actual output digest, unsupported features and failure behavior. Do not create or expose production keys. Local Bun crypto results alone do not pass this check.

### 6. AI provider wiring

Resolve an Anthropic provider and demonstrate the selected test model through the Effect AI interface before retaining Claude defaults. Confirm the actual Decisions support offered by the selected OpenAI provider; if a custom adapter remains necessary, inspect the old working adapter and capture the bounded request/response shape with sensitive content removed. Log provider substitutions. Keep provider costs within the later authorized budget and keep inference out of the signer example.

### 7. Deploy and destroy

Following Alchemy's tutorial and stages docs, deploy a uniquely named, temporary non-production stage with the spike's actual Worker, bindings and bounded Foldkit site. Confirm required accounts, non-secret stage identity and spending bounds first. Record the resolved Alchemy version, any patch, resource identities, deployed revision and a successful request to the deployed entry point.

Design cleanup before deployment. Run destruction for the exact spike-owned stage when checks finish, including after failed checks; then verify which resources remain. A successful CLI exit without checking the resulting resource state is incomplete cleanup evidence. Record a failed cleanup as an unresolved exit gate and identify its owner.

Cafe's GitHub preview comment is a reference for later CI. This handoff does not authorize posting comments or messages. Stage 0 owns the production preview workflow, close-triggered cleanup and reordered CI; do not create them as part of preparation or represent the temporary spike deploy as completed Stage 0.

## Evidence record

Create one record per attempt at `docs/spikes/evidence/platform/<check_id>/<attempt>/record.json`, starting from [the template](evidence/record.template.json), and link each from the result report at `docs/spikes/evidence/platform/report.md`. [What to commit and what to keep in `work/`](evidence/README.md) is set out with the evidence. Use these exact field names so local and hosted claims can be reviewed consistently:

| Field | Required content |
| --- | --- |
| `check_id` | Stable check name and distinct attempt number |
| `status` | `not_run`, `pass`, `fail` or `blocked`; never infer pass from a different check |
| `executed_at_utc` | Actual execution time, or `not_run` |
| `source_revision` | Code revision and any uncommitted-change digest |
| `dependency_versions` | Exact package versions, lockfile digest and applied patches |
| `api_evidence` | Installed source/export paths and relevant primary documentation with retrieval date |
| `execution_target` | `local_bun`, `local_workerd`, `hosted_cloudflare` or the named fallback |
| `runtime_configuration` | workerd version where available, compatibility date/flags, binding types and relevant limits |
| `stage_and_resources` | Non-secret sandbox/stage identity and only the resources owned by this attempt |
| `inputs` | Controlled fixture/scene/request identifiers and digests; network/checkpoint where relevant |
| `procedure` | Reproducible commands or test entry point and bounded action sequence; no credentials |
| `expected_result` | Concrete observable criterion declared before the run |
| `observed_result` | Actual behavior, duration and error details with sensitive content removed |
| `artifacts` | Repo-relative paths to relevant logs, traces, captures, plate images and digests |
| `policy_and_cost` | Chosen network policy, configured budgets and observed provider use/cost where available |
| `cleanup_result` | Release/destruction procedure, result, verification and residual resources |
| `decision_link` | Active decision entry for a selection or deviation; otherwise `none` |
| `limitations_and_next_action` | What this result does not prove, outstanding issue and responsible owner |

Retain useful evidence without secret values, cookies, session tokens, private wallet keys, provider authorization headers or private mandate text. A claim of no provider use should be supported by the execution route; do not equate unknown cost with zero.

## Exit gates before Stage 0

- Every platform check has evidence for the runtime it claims, or a recorded incompatibility with a reviewed alternative and an explicit outstanding status. There are no silent skips or imported-only passes.
- The browser adapter's actual package/version, network containment, live-view/takeover behavior and session lifecycle are settled. `PublicWeb` remains unresolved until enforcement is demonstrated or the product limitation/provider change is accepted.
- Workers execution is proved for the selected wallet and launch-construction edges, storage adapters and crypto operations. Hosted provider behavior is supported by hosted evidence.
- Browser Rendering produces a plate from the real renderer. The renderer dependency is resolved without using platform success as art approval.
- Provider defaults are backed by verified wiring, with the Anthropic and Decisions gaps resolved or explicitly recorded for a decision.
- The exact dependency set is locked and repeatable; SDK exports are supported by installed-source evidence. Runtime substitutions, API exceptions and provider selections appear in the active decision log before adoption.
- The temporary deployment is destroyed and cleanup verified, or unresolved resources and their owner are explicitly reported. No real funds or production transaction were used.
- A final result report distinguishes local success, hosted success, failures and unrun work; it recommends proceed or hold with reasons. The owner reviews the result alongside the look spike and remaining decisions before Stage 0 begins.

Completion of this document satisfies only the preparation handoff. None of these exit gates is currently claimed complete.

## Source references for implementation

- [First build's agent runtime](../../reference/first-build/packages/agents/src/runtime.ts): working generic Yielded wiring; its old researcher-only prompt and calldata output are not carry-over requirements.
- [Browser and provider Layers](../../reference/first-build/packages/agents/src/providers.ts).
- [Agent runner](../../reference/first-build/packages/server/src/agent-runner.ts): budget reservation before provider calls and one run per agent.
- [Decisions adapter](../../reference/first-build/packages/server/src/design-review.ts).
- [Storage models](../../reference/first-build/packages/server/src/store.ts) and [old SQLite implementation](../../reference/first-build/packages/server/src/sqlite-store.ts): patterns only; Bun storage is not the selected runtime.
- [Cafe stack](../../reference/cafe-reference/alchemy.run.ts), [catalog](../../reference/cafe-reference/pnpm-workspace.yaml), [Alchemy patch](../../reference/cafe-reference/patches/alchemy@2.0.0-beta.81.patch), [CI](../../reference/cafe-reference/.github/workflows/ci.yml) and [cleanup workflow](../../reference/cafe-reference/.github/workflows/cleanup.yml).
