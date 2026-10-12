# Platform spike report

Recommendation: **hold**. Dependency installation failed because the local volume was full. No workerd process, hosted Worker, provider request or deployment ran. Package/API discovery is useful progress, but does not establish runtime compatibility.

Branch: `spike/platform`. Starting revision: `880f213`. Scope: platform spike only; Stage 0 has not started.

## What was attempted

The initial Bun toolchain install succeeded, with peer-dependency warnings because the SQL adapters require Effect 4.0.3 while the first-build pin was 4.0.0. Installing Wrangler for the local runtime then failed with `ENOSPC`. At the first disk check only about 32 MiB remained; source-file creation also failed. Removing only the dependency installation created by this task recovered enough room to preserve small source drafts and evidence, but left less than 100 MiB free.

The [prerequisite record](local-runtime-prerequisites/001/record.json) contains the failed command and a fresh disk measurement. Draft crypto, storage and alarm probes are retained in ignored scratch. They are not committed implementation, have not been typechecked or executed, and are not evidence of passing behavior.

The [package/API audit](local-runtime-prerequisites/001/api-findings.md) identifies package locations and version traps from published sources. The prerequisite record includes this source-only discovery and its [unexecuted candidate snippets](local-runtime-prerequisites/001/launch-snippets.md). Temporary source excerpts were removed to reclaim disk space; pinned distribution URLs and integrity hashes remain in the audit. These findings must be followed by installation and real workerd checks.

## Checks and remaining evidence

| Check | Result in this attempt | Required next evidence |
| --- | --- | --- |
| Local workerd startup | Blocked by disk capacity before installation | Start a pinned workerd runtime and retain its version and compatibility flags |
| DO SQLite and D1 through Effect | Not run | Migration/write/read, rollback, conditional-update concurrency and persistence across runtime restart; distinguish DO transactions from D1 batches |
| Web Crypto | Not run | SHA-256 known vector and UUID checks through the Web Crypto-backed Effect layer on workerd |
| Durable Object alarms | Not run | A scheduled wake independent of requests, then separate Yielded-loop evidence |
| Yielded hosted browser | Not run | Verified adapter acquisition, capture, interaction, network containment, live view, takeover and release |
| Privy sandbox co-signing | Blocked by missing configured sandbox access, with local runtime setup also blocked | Actual sandbox authorization and co-signing from a Worker |
| Meteora and Doppler construction | Not run | Representative unsigned launch construction inside workerd, with required account reads clearly identified |
| Headless plate | Not run | Cloudflare Browser Rendering executes the look spike's actual renderer and records scene/image digests |
| Anthropic and Decisions wiring | Blocked by missing configured inference keys, with local runtime setup also blocked | Bounded provider calls through the selected adapters from a Worker |
| Alchemy deploy and destroy | Not run | An isolated stage deployed, queried and destroyed, with resource-state verification |

## Account blockers

The [account readiness record](account-readiness/001/record.json) checks only the known environment variables, this worktree's secret configuration filenames and safe Wrangler login metadata. It does not claim that the owner has no accounts elsewhere.

- **Privy:** no sandbox application ID/secret or co-signing configuration is available to the spike. Sandbox co-signing is blocked.
- **Inference:** neither `ANTHROPIC_API_KEY` nor `OPENAI_API_KEY` is configured. Live language-model and Decisions checks are blocked.
- **Codex market data:** no configured market-data API key was found. Authenticated market-data checks are blocked.
- **Cloudflare:** a Wrangler login file exists, but its access-token expiration is 22 September 2026. A refresh token is present. Disk capacity prevented installing Wrangler to refresh the login and verify the account. Cloudflare access is **unverified**, not proven unavailable. Browser Rendering, hosted storage and deployment remain unrun.
- **Browserbase:** credentials are absent and the fallback has not been selected. No provider substitution was made.

No credentials were printed or committed. No Cloudflare resource was created, so no hosted teardown is pending. No real funds, wallet transaction or token launch was used.

## Resume in this order

1. Free several GB of disk space. The local prerequisite uses a conservative 3 GiB working allowance for package extraction, runtime files and experiment evidence; this is not a vendor requirement.
2. Install a peer-compatible, exactly pinned spike dependency set from the API audit, create its lockfile and read the installed Effect instructions/source. Keep the source snapshot excluded from all execution and checks.
3. Run the local workerd checks first. Preserve this failed attempt and create new attempt records for actual runs.
4. Refresh and inspect the existing Cloudflare login through Wrangler. Use only the authorized temporary stage. Report missing account entitlements or configuration rather than substituting local results for hosted evidence.
5. Run hosted checks as their sandbox access becomes available. Complete deploy/destroy verification and record unresolved checks explicitly.
6. Run genuine `bun run typecheck`, `bun run lint` and `bun run build` on the spike code before committing implementation. These checks were **not run** in this blocked attempt; no successful placeholder commands were added.

The current report supports holding the platform decision. It does not recommend proceeding to Stage 0.
