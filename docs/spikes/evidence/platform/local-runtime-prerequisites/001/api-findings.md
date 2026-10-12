# Platform package audit — 12 October 2026

This source-only audit supports the authorized platform spike. It does not establish local workerd or hosted compatibility. No provider API, RPC endpoint, wallet, credential or deployment was used. Registry metadata and primary documentation were read. The audit installation attempt failed with `ENOSPC`; it did not produce a verified dependency graph or lockfile. The separate platform bootstrap briefly installed Effect 4.0.0 before its task-owned dependencies were removed. Exact files selected from npm distributions were inspected, with archive integrity checked before extraction where recorded below. The temporary excerpts were then removed to reclaim space; they are not retained evidence or installed dependencies.

The findings and unexecuted candidate snippets are retained beside this report; temporary audit work used `work/package-audit/`. `source-excerpts/` paths below identify the inspected distribution files and original line numbers, not available local artifacts. Re-fetch the pinned distributions in the provenance table and verify their integrity before recreating those excerpts. The active scope and source rules are in the worktree's `docs/decisions.md`, `AGENTS.md`, `docs/spikes/platform.md` and `reference/README.md`. Read the complete newly installed Effect `AGENTS.md` before implementing against Effect 4.0.3; this audit read the root's then-installed Effect 4.0.0 instructions and the effect-development setup skill.

## Resolution and installation status

`bun info` works reliably against the registry from a directory containing `package.json`. Running it before the scratch package existed failed with “could not find a package.json”; that was a local project requirement, not a registry failure. The dependency download/extraction attempt then failed because the filesystem had only 32 MiB available. A later small file write also failed until the root reclaimed space. No network authentication error was observed.

| Package | Exact candidate | Important qualification |
| --- | --- | --- |
| `effect` | 4.0.3 | Required by the current AI/SQL providers and Yielded beta.170; do not retain 4.0.0 with `^4.0.3` peers. |
| `@yielded/agent` | 0.1.0-beta.170 | Registry `latest` is beta.166, while `beta` is beta.170. Keep the framework packages at the same release. |
| `@yielded/agent-platform-cloudflare` | 0.1.0-beta.170 | Exports the current browser-use adapter. beta.166 already has capture/interactive adapters but lacks `./browser-use`. |
| `effect-cf` | ^0.56.0 peer of beta.170 | Resolve an exact pin during installation. beta.166 instead peers on ^0.53.0. |
| `@effect/ai-anthropic` | 4.0.3 | Real provider package is available; Effect peer ^4.0.3. |
| `@effect/ai-openai` | 4.0.3 | Still no Decisions provider in its complete source barrel/source search. |
| `@privy-io/node` | 0.35.0 | Current server SDK. Its optional viem integration requires viem ^2.44.2; the old 2.38.5 is insufficient for that adapter. Direct SDK use does not require the optional integration. |
| `@meteora-ag/dynamic-bonding-curve-sdk` | 1.5.13 | This is the registry latest, not the planned 2.0 SDK described in historical docs. |
| `@whetstone-research/doppler-sdk` | 1.0.43 | Import `/evm` for this spike; root now exposes multiple chain families. |
| `alchemy` | 2.0.0-beta.81 | Exact Cafe pin exists. It peers on Effect ^4.0.0 and Vite ^8.0.7; many unrelated peers are optional. |
| `@alchemy.run/frontend-frameworks` | 2.0.0-beta.81 | Exact matching optional Alchemy peer. Effect ^4.0.0; optional Hono ^4.12.14 and Vite ^7 or ^8. |

The original exact toolchain remains Bun 1.4.0, TypeScript 7.0.2, oxlint 1.87.0, oxlint-tsgolint 7.0.2003, `@effect/tsgo` 0.51.1, effect-oxlint 0.4.0, oxlint-plugin-effect 0.28.1, dprint 0.63.0. Preserve the supported `effect-tsgo patch --typescript --oxlint` prepare step. The audit has not assembled or verified the resulting full graph.

## Yielded browser and durable runtime

The missing adapter is a separate package, not an export to guess from `@yielded/agent`.

- Capture: `import { CloudflareBrowser } from "@yielded/agent-platform-cloudflare/cloudflare-browser"`, then `CloudflareBrowser.layer(webCaptureDefinition, { browser: env.BROWSER })`. It supplies `PageCapture` to the definition's handlers. Structured extraction requires an explicit `workersAi` authority/budget; plain capture does not implicitly authorize that use.
- REST capture: `@yielded/agent-platform-cloudflare/browser-rest-capture`; use `CloudflareBrowserRest` with an HTTP client and privately supplied Cloudflare credentials when that route is chosen.
- Interactive: `import { CloudflareInteractiveBrowser, BrowserRunInteractiveHost } from "@yielded/agent-platform-cloudflare/interactive-browser"`. `layer({ browser, accountId, apiToken })` supplies generic `InteractiveBrowser`; `hostLayer` supplies host controls. `apiToken` is `Redacted.Redacted<string>` and both require Effect `HttpClient`.
- Native agent browser tools in beta.170: `import * as NativeBrowser from "@yielded/agent-platform-cloudflare/browser-use"`; `NativeBrowser.make(session, { authorize, maxActions, maxReturnedBytes })` attaches to an existing `Pick<BrowserSession, "run">`. The authorization callback is rechecked under the session lock. Its context includes current page/frame URL, optional target and tab URL; the initial attachment has no cached page URL. This is not itself a network-containment implementation.
- Host session controls include `getLiveView`, `handoff`, `getHandoffState`, private checkpoint/resume and confirmed cleanup. Keep their redacted handles out of model results and journals.
- `ThreadObject.make(applicationLayer, options)` is exported from `.../thread-object` and produces the native Durable Object class. Its `options.namespaceBinding` identifies the namespace. The constructor gate initializes the composed runtime, migration/version checks and alarm inspection under `blockConcurrencyWhile`. The exported `alarms` contains the thread-maintenance handler; `cloudflareWakeSchedulerLayer` uses the DO alarm slot. Do not replace this protocol with an arbitrary market-poll callback.

Exact source: `source-excerpts/yielded-170/src/CloudflareBrowser.ts`, `InteractiveBrowser.ts`, `BrowserUse.ts`, `BrowserSession.ts`, `ThreadObject.ts`, `WakeScheduler.ts`, plus the corresponding distributed declarations under `dist/`.

The distributed beta.170 implementation still rejects `PublicWeb` in `InteractiveBrowser.ts:1566` before browser allocation. It returns `InteractiveBrowserUnsupportedError` with feature `policy`. `ExactHosts` is an HTTPS authority allowlist, not a public-IP boundary. `Unrestricted` is explicitly unrestricted; adding an application denylist is a decision requiring actual enforcement tests, not a new name for `PublicWeb`.

`InteractiveBrowser.ts:77` sets the maximum keepalive to `600_000` ms, and `:1605` clamps the selected policy's elapsed limit to the provider bounds. The provider disconnect/idle/resume behavior still needs actual hosted observation. Capture, interactive, native tools, live view and takeover must be tested separately.

Primary docs: [Yielded browser guide](https://yielded.dev/agent/guide/browser/) and [Cloudflare platform guide](https://yielded.dev/agent/platforms/cloudflare/), read 12 October 2026. The browser guide points at `@beta`; reading only registry `latest` led to the beta.166/beta.170 mismatch. Quick Actions require compatibility date 2026-03-24 or newer and remote mode for local Wrangler. They have no wholly local implementation. A local controlled adapter proves application behavior only, not hosted browser execution.

## AI providers

Anthropic 4.0.3 exports `AnthropicClient` and `AnthropicLanguageModel`. Exact assembly:

```ts
AnthropicLanguageModel.layer({ model: chosenModel }).pipe(
  Layer.provide(AnthropicClient.layer({ apiKey: redactedKey })),
  Layer.provide(FetchHttpClient.layer),
)
```

Source: `source-excerpts/anthropic-4.0.3/src/AnthropicClient.ts:413`, `AnthropicLanguageModel.ts:839`. `AnthropicLanguageModel.model(model, config?)` is also available (`:701`). No model/provider request was sent. A successful layer construction would not verify provider access, model availability or output behavior.

OpenAI 4.0.3's source barrel exports Generated, OpenAiClient, OpenAiClientGenerated, OpenAiConfig, OpenAiEmbeddingModel, OpenAiError, OpenAiLanguageModel, OpenAiSchema, OpenAiTelemetry and OpenAiTool. Searching the complete cached `src/` tree found no `Decision` declaration. Source: `source-excerpts/openai-4.0.3/index.ts`, copied from `/Users/chriscarroll/.bun/install/cache/@effect/ai-openai@4.0.3@@@1/src/index.ts`; its manifest was also inspected. Do not guess `OpenAiDecisionModel`. The old Floor `reference/first-build/packages/server/src/design-review.ts` remains a read-only pattern to adapt into the new boundary, not import or execute.

## Privy

Use `new PrivyClient({ appId, appSecret, maxRetries: 0, timeout, ... })` from `@privy-io/node`. The public constructor forwards client options to `PrivyAPI`. The generated API defaults to two retries; explicitly suppress automatic dispatch retries at the signing edge. Use privately provided sandbox configuration and an operation-specific idempotency key/expiry when the real check is authorized and configured.

Concrete signing APIs are `privy.wallets().ethereum().signTransaction(walletId, input)` and `privy.wallets().solana().signTransaction(walletId, input)`. Solana accepts a base64 string or `Uint8Array`; the latter uses `Buffer` to encode. `signAndSendTransaction` is a distinct method and must not be used by the offline construction test. Request authorization accepts `authorization_private_keys`, user JWTs, supplied signatures or external `sign_fns`. Proving a request is formatted does not prove the intended two-of-two co-signing arrangement; the sandbox check must exercise actual authorization and refusal.

Source: `source-excerpts/privy-0.35.0/src/public-api/PrivyClient.ts:101`, `public-api/services/ethereum.ts:74`, `public-api/services/solana.ts:43`, `lib/authorization.ts`, `lib/cryptography.ts`. Crypto uses global `crypto.subtle`, but the PKCS8 parser and some encoding paths use `Buffer`. No Node process or filesystem is needed by those inspected operations; transitive Worker bundling is still unverified.

[Privy's setup docs](https://docs.privy.io/basics/nodeJS-node/setup), read 12 October 2026, list Workers among supported runtimes. [Cloudflare's current compatibility docs](https://developers.cloudflare.com/workers/configuration/compatibility-flags/) say dates at or after 2026-08-04 enable Node compatibility by default. Record that default accurately for a 2026-10-12 Worker. A bare-Web-Crypto control would need both `no_nodejs_compat` and `no_nodejs_compat_v2`; changing a flag is not itself a compatibility finding.

## Launch construction

See [source-backed candidate snippets](launch-snippets.md). They have not been executed or typechecked because dependencies were not installed. Keep that limit visible until a real local workerd run replaces it with evidence.

Meteora 1.5.13:

- `buildCurve(BuildCurveParams)` is pure construction and returns `ConfigParameters`.
- `client.partner.createConfig({...accounts, ...curve})` builds a config transaction through Anchor's `.transaction()`; the inspected path has no account fetch. Verify this with a transport that fails on every request.
- `client.partner.createConfigAndPool({...accounts, ...curve, preCreatePoolParam})` builds both transactions but calls `getTokenType(connection, quoteMint)`, which unconditionally calls `connection.getAccountInfo`, even for the native mint. Ordinary `client.creator.createPool` additionally fetches the existing pool config.
- For a wholly offline full-pool check, provide a controlled RPC response for the quote-mint owner and label it **synthetic fixture**, or retain full-pool construction as pending a permitted pinned read. A config-only result is not a full launch result.
- Current source deprecates new DAMM v1 configs/pools and RateLimiter base fees. Use `MigrationOption.MET_DAMM_V2` and the actual current enum names. Do not silently implement the historical future 2.0 design against a 1.x API.
- Direct dependencies include `@solana/web3.js` ^1.98.0, Anchor ^0.31.0 and SPL Token ^0.4.13; inspect their Worker bundle boundaries once installation succeeds.

Inspected source locations (temporary excerpts removed): `source-excerpts/meteora-1.5.13-index-js.txt` and `meteora-1.5.13-index-d-ts.txt`, selected from the distribution's `dist/index.js` and `dist/index.d.ts`. Relevant original JS lines: getTokenType 681, config build 28728, pool quote read 28873, combined build 29946, existing config read 30964.

Doppler 1.0.43:

- Import `@whetstone-research/doppler-sdk/evm`.
- `MulticurveBuilder(chainId)` creates typed launch parameters. `.withSalt(hex32)` makes separate construction attempts deterministic. Without an explicit salt, the encoder generates one; older prose in its own README about unconditional replacement is stale relative to the inspected implementation.
- `sdk.factory.encodeCreateMulticurveParams(params)` is synchronous and returns `CreateParams`. It validates/encodes locally and does not simulate or send. Encode the final Airlock `create` calldata with exported `airlockAbi` and viem's `encodeFunctionData`.
- `createMulticurve`, `simulateCreateMulticurve`, `prepareCreateMulticurve`, static/dynamic simulations and create methods are different paths that perform RPC or may submit. Exclude them from the no-provider-call test.
- Provide a public client with a rejecting custom transport and no wallet client. A successful call with zero RPC attempts proves only offline calldata construction under the selected runtime, not deployment addresses, pool economics, migration, vesting or allocation locks.
- The package depends on viem ^2.33.3 and now includes Solana 6.x dependencies; use the EVM subpath so unrelated imports do not expand the Worker bundle. Its exported `VERSION` constant is `1.0.0`; report the manifest version `1.0.43` instead.

Inspected source locations (temporary excerpts removed): `source-excerpts/doppler-1.0.43-index-js.txt` and `doppler-1.0.43-index-d-ts.txt`. Relevant original JS lines: synchronous encoder 9706; explicit-salt use near 9966. Declarations: encoder 1037, builder 2393, `withSalt` 2578, SDK 2597. Primary project docs: [Doppler SDK](https://github.com/whetstoneresearch/doppler-sdk), inspected 12 October 2026.

## Alchemy and Cafe compatibility

The exact reference pair `alchemy@2.0.0-beta.81` plus `@alchemy.run/frontend-frameworks@2.0.0-beta.81` is available. `Cloudflare.Website.Foldkit` exists in the package distribution at `src/Cloudflare/Website/Foldkit.ts`. It takes `rootDir`, optional `main`, env/build and asset-routing options. Its default is assets-only with SPA fallback; a real Worker entry and bindings must be deliberately provided where needed. The whole stack still needs a real install and deployment test.

Source: `source-excerpts/alchemy-beta.81/package.json`, `src/Cloudflare/Website/Foldkit.ts`, `src/Cloudflare/Website/index.ts`, `src/Cloudflare/AI/LanguageModel.ts`. Bun export conditions select Alchemy's TypeScript source; other runtimes use `lib/`. The Cafe patch changes both source and built JS for that reason.

The published beta.81 `handleNativeText` still immediately consumes `chunk.response` at `LanguageModel.ts:725`; it lacks the Cafe patch's check for simultaneous `choices[0].delta.content`. `:815` and `:817` subsequently process native and OpenAI-compatible text in the same chunk. Therefore the patch remains relevant if the spike exercises this Workers AI streaming path. This inspection does not claim other provider paths need the patch, or prove the fix by execution.

Alchemy's package is about 141 MB unpacked with more than 52,000 files; a full dependency installation also adds a substantial graph. Do not treat disk exhaustion as a registry/version error. Its provider client and deployment compatibility remain unverified. Inspect the original Cafe stack/cleanup as permitted reference source; do not execute them in place.

## Distribution provenance

These tarballs were fetched from the npm registry and their SHA-512 integrity matched before selected source/declaration files were extracted for inspection. All temporary excerpts were subsequently removed to reclaim disk space. Source locations and original line numbers are reproducibility pointers, not retained files. The OpenAI copies came from the existing Bun cache as described above; reinstall and inspect the exact 4.0.3 package to reproduce that source-barrel check.

| Package | Registry tarball | SHA-512 payload, base64 |
| --- | --- | --- |
| Yielded Cloudflare beta.170 | `https://registry.npmjs.org/@yielded/agent-platform-cloudflare/-/agent-platform-cloudflare-0.1.0-beta.170.tgz` | `53vGzbc8as/Y6EodMcExDAfrKfvJCcQikdCmBA1AJ9E6fyQMg36Aigeu/xHBqknN/U4EX4OkqOQUyGIeRVqAvg==` |
| Anthropic 4.0.3 | `https://registry.npmjs.org/@effect/ai-anthropic/-/ai-anthropic-4.0.3.tgz` | `c0rKev8Bg9iwBTiuANlq+2DV3XUnLeNbb8ZPzU5KPpzvuNOBpc2yZpFqjlxZa3V7azE4iKT+YeSGJ62fQNk6Fw==` |
| Privy 0.35.0 | `https://registry.npmjs.org/@privy-io/node/-/node-0.35.0.tgz` | `NhttAOmjgwtQzBoTmRCWzY5ZTTJV1WqPUmasyEbi9XfFd1LccpjHiNB+AUCeRXpY0FC5Bt/3Is7xJEmCX3LKNA==` |
| Meteora 1.5.13 | `https://registry.npmjs.org/@meteora-ag/dynamic-bonding-curve-sdk/-/dynamic-bonding-curve-sdk-1.5.13.tgz` | `2a/2qvs/lOFdtB39/jz5ttbv6Y+cCXCmcgDSqGsIdxY68bUv78JXM5e9asQ+hVGnUk+DzIbgSM2/VObZz2qwNw==` |
| Doppler 1.0.43 | `https://registry.npmjs.org/@whetstone-research/doppler-sdk/-/doppler-sdk-1.0.43.tgz` | `IFcBiMxWxGy7HOvv3qdONET0ynC+Kf0FuE0SjiZW+Zr9X5ttf25jodLm9Kpg8mc+sbw9fSPNxxwIM6GI8YlKjg==` |
| Alchemy beta.81 | `https://registry.npmjs.org/alchemy/-/alchemy-2.0.0-beta.81.tgz` | `AxEUQSYSln9NgZMuYnSz9Q7ERR8BrKrGpx9vOwJtWity7Ze8/7vI4k62u2EAoJRpBbaOTnI2Bp67Au1y9J7FTA==` |

## Next bounded implementation checks

After disk space is available, install exact candidate versions in the spike, inspect their installed files again, read installed Effect instructions and freeze the actual lockfile. First exercise rejecting transports for SDK construction and a local workerd bundle; then run the separately authorized/configured hosted checks. Preserve all failures and actual runtime flags. A successful source audit or bare import is never a passed platform check.
