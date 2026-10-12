# Platform spike report

Recommendation: **hold before Stage 0**. **Historical baseline:** main advanced to `26ed1b1` while these experiments ran. Its Alchemy, Kit-client and native-wallet decisions supersede this raw-runtime/SDK implementation. The measurements below describe the earlier implementation only and do not pass the updated handoff. The bounded local workerd checks pass, including an actual Yielded Durable Object alarm and interrupted-turn recovery. Hosted browser, wallet, provider and deployment gates remain open. On 12 October the owner selected **“Local checks only for now”**; no hosted workload or deployment was performed.

Branch: `spike/platform`. Final runtime source: `181bd364ecd64b3e73e64a508d035eac958d668a`. This is spike code, not the product skeleton. Look Part B and Stage 0 have not started. The [decision log](../../../decisions.md) records the scope and proposals.

## Measured local results

| Check | Evidence | Result and limit |
| --- | --- | --- |
| Web Crypto without Node compatibility | [Local workerd 002](local-workerd/002/record.json) | SHA-256 empty/`abc` vectors, 32 distinct valid UUIDv4 samples per call, typed rejection of negative random-byte size. Neither Bun nor `process` was present. Bounded input coverage, not cryptographic certification. |
| DO SQLite journal through Effect | [Local workerd 002](local-workerd/002/record.json) | Migration ran once; intentional outer rollback removed its write; caught child rollback preserved parent=11. Twenty concurrent conditional updates produced exactly one winner, persisted value=8. Rows and migration count survived complete local process restart. |
| D1 history through Effect | [Local workerd 002](local-workerd/002/record.json), [schema upgrade 002](storage-upgrade/002/record.json) | A duplicate-key failure rolled back the entire batch. Interactive transactions explicitly report unsupported. Schema upgrade to version 2 preserved value=13; repeat and post-restart calls were no-ops. Single migration runner, not a production coordinator. |
| Native Yielded agent alarm | [Agent alarm 002](agent-alarm/002/record.json) | A fixed synthetic model completed through the native alarm during a 5,002 ms quiet interval. Completion preceded the first follow-up request by 3,305 ms. Canonical records survived restart unchanged; repeat submission reused its receipt. |
| Interrupted agent turn | [Agent interruption 001](agent-interruption/001/record.json) | The whole local process group was killed while the delayed synthetic model was running. After restart, the native alarm recorded `ModelResponseInterrupted`, the expected response and one completed settlement, finishing 3,366 ms before observation. The local overdue-alarm warning is retained. |
| Meteora construction | [Launch construction 002](launch-construction/002/record.json) | Combined config+pool construction yielded a 1,025-byte unsigned transaction containing two instructions. Two constructions matched byte-for-byte; each consumed one explicitly synthetic quote-mint read. |
| Doppler construction | [Launch construction 002](launch-construction/002/record.json) | Airlock multicurve construction yielded 2,020 bytes of deterministic calldata without construction RPC. The configured sender is identified separately; calldata alone does not establish a required signer. |

Both SDK routes reject a deliberate forbidden RPC before construction. No signatures, chain simulation, broadcast or real token launch occurred. The quote fixture is not a network checkpoint. Neither SDK result establishes launch economics, graduation, migration, vesting or allocation locks.

The agent uses the actual `@yielded/agent-platform-cloudflare` native `ThreadObject`, with a delayed synthetic Effect language-model Layer. `dispatchAfterEvent: false` forces alarms to drive accepted work; instrumentation delegates native dispatch unchanged. Startup includes `/crypto` readiness requests. The measured quiet intervals contain no requests, and the agent read route does not advance work. This proves local scheduler integration and local restart recovery, not hosted eviction behavior, exactly-once provider calls, provider billing or browser session cleanup. Duplicate receipt reuse alone is not a post-duplicate no-extra-work test.

## Versions, checks and reproduction

The lockfile pins Effect, browser crypto and both SQL adapters to **4.0.3**, Yielded agent and Cloudflare adapter to **0.1.0-beta.170**, `effect-cf` **0.56.0**, Wrangler **4.149.0**, workerd **1.20261006.1**, Meteora **1.5.13** and Doppler **1.0.43**. Full versions and lockfile hashes are in each record. Original Bun 1.4.0, compiler 7.0.2, Effect compiler patch 0.51.1 and lint/format pins are retained.

Both configurations use compatibility date **2026-10-06**, matching the installed workerd release. The bare storage/crypto control explicitly disables Node compatibility and its v2 flag; the agent/launch graph enables `nodejs_compat`. All bindings are local. This does not establish that every package needs Node compatibility; it identifies the exact graph tested.

`bun install --frozen-lockfile`, `bun run format:check`, `bun run typecheck`, `bun run lint`, `bun run build` and `bun run build:bare` passed. The compiler reports `7.0.2+effect-tsgo.0.51.1`. Both builds are Wrangler **dry runs**, not deployments. Strict compiler options, 91 Effect diagnostics and lint presets remain active. The [probe README](../../../../apps/floor/spikes/platform/README.md) documents routes, limits and eleven narrow boundary suppressions. Stage 0 still owns the adapted architecture fences and full CI.

The [retained driver](local-workerd/002/run.py) starts local runtimes, checks declared criteria, stops and restarts process groups, and verifies port closure. Reproduce from the source commit in an isolated worktree, with fresh attempt names and persistence. Its first interruption output directory was normalized from `002` to `001` after execution; this procedure-only correction is recorded. Runtime source is unchanged.

An independent agent verified all 75 source size/hash comparisons against the frozen commit and checked all 53 final responses, including the twenty-way reservation race and alarm timing. Local processes are stopped. SQLite scratch remains in ignored `work/`; no hosted resources were created, so no hosted teardown is pending.

## Deferred and blocked gates

| Required gate | Current status and next action |
| --- | --- |
| Hosted agent, browser containment, capture, live view, takeover, expiry/reconnection and release | **Not run: local-only scope.** The package is resolved, but Cloudflare's adapter rejects `PublicWeb` before acquisition. No containment policy/provider alternative is selected. Controlled hosted enforcement tests and an explicit policy decision remain required. |
| Privy sandbox co-signing inside a Worker | **Blocked by missing configuration and deferred scope.** No sandbox credentials or intended co-signing arrangement are configured in the inspected environment. Installing the SDK is not a compatibility result. |
| Hosted renderer plate | **Not run: local-only scope.** Look Part A supplies a real bounded web renderer for the later Cloudflare Browser Rendering check. No local image is counted as a hosted plate. |
| Anthropic and OpenAI Decisions wiring | **Blocked by missing keys and deferred scope.** Anthropic 4.0.3 is resolved; OpenAI still has no native Decisions provider. Neither adapter has made a live test call. Claude defaults and any custom Decisions adapter remain unverified. |
| Hosted SQL, crypto and SDK behavior | **Not run: local-only scope.** Local bindings do not establish hosted equivalence, limits or entitlements. |
| Alchemy temporary deploy/destroy | **Not run: local-only scope.** Cafe's pattern and patch were inspected only. No Alchemy version/patch adoption or resource creation/destruction claim. |
| Codex market data | No configured API key found in inspected scope. No authenticated request; later dataset coverage remains unverified. |

The [current account record](account-readiness/002/record.json) supersedes the initial uncertainty about Cloudflare login: Wrangler refreshed the existing OAuth login and successfully read account metadata before the local-only instruction. Authentication works; entitlements remain untested. Account checks inspect known variable names and worktree secret-file presence, not every account the owner might have elsewhere. No credential values were printed or committed. Browserbase remains an unselected fallback.

## Earlier attempts retained

The [initial prerequisite failure](local-runtime-prerequisites/001/record.json) records `ENOSPC`; disk space was subsequently restored. Its [published-source audit](local-runtime-prerequisites/001/api-findings.md) remains API discovery, not execution evidence. The [initial account inspection](account-readiness/001/record.json) is historical.

The first [storage/crypto](local-workerd/001/record.json), [launch](launch-construction/001/record.json) and [upgrade](storage-upgrade/001/record.json) runs produced responses, but evidence review rejected their provenance because some pre-edit source versions were not retained. Review also tightened rollback assertions and corrected EVM signer wording. Original response/manifest bytes remain intact; final `002` runs against committed source supersede those acceptance claims. The first [agent alarm](agent-alarm/001/record.json) retains its complete source snapshot and single-turn result, with no restart claim.

The next platform work is the outstanding hosted gates, once the owner authorizes that scope and supplies missing sandbox/provider configuration and a spend limit. Current evidence supports the local primitives and **holds the platform decision before Stage 0**.
