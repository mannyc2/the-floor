# Wallets

The wallet provider's service edge, shared by the Floor and the future signer: today, a native Privy client. It is a package rather than part of `apps/floor` because the signer will need it, and the signer may not import Floor application code.

The owner approved the native-client oracle work and the operations below on 13 October 2026, as a limited exception to the Stage 0 hold. Stage 0, the Stage 3 signer and the sandbox remain unfinished.

The owner then selected option 3: retain Privy-only enforcement. B's originally requested aggregate Solana transaction cap remains deferred until the provider supports it; no independent co-authorizer or signer-local cap is adopted.

## Native service

`@floor/wallets` provides:

- `PrivyWallets`, over Effect HttpClient: `createQuorum`, `createWallet` (Ethereum or Solana), `createPolicy`, `getWallet`, `getPolicy`, `updateWallet`, `updatePolicy`, `signMessage` (Ethereum) and `signTransaction` (Solana). The chain adapter builds and serializes the transaction. This client only signs; it has no broadcast method.
- Closed input Schemas, including `WalletInput`, `QuorumInput`, `PolicyInput`, `WalletUpdateInput` and `PolicyUpdateInput`. Runtime decoding rejects extra fields, including nested policy conditions. Empty PATCH bodies are rejected. Reads validate the supported policy subset and fail on unsupported rules; they cannot silently certify an unknown policy.
- `Authorization`: native signing keys, externally computed co-signatures, a stable idempotency key, and optional `requestExpiry: DateTime.Utc`. Every signer covers the actual POST or PATCH method, URL, body, app ID, idempotency key and supplied expiry. Creation uses app authentication; wallet actions and updates require owner signatures. Privy, not this edge, checks which keys own the resource and whether their quorum is satisfied. The caller must arrange the owner's signature for an update.
- `PrivySettings`: app ID and a `Redacted` app secret. Mutations are never automatically retried.
- `P256`: Web Crypto P-256 signatures over RFC 8785 canonical JSON. `signatureDer` converts the native IEEE-P1363 signature to the ASN.1 DER form Privy expects.
- `PrivyPolicyRefusal`, only for a 4xx response with the provider's explicit `policy_violation` code. `PrivyFailure` distinguishes authorization, validation, transport and other responses, retaining the original foreign cause behind `Redacted` because requests can carry credentials and signatures. A generic 403 is not evidence of a policy refusal.

Wallet and policy reads expose a missing owner as `Option`. The HTTP edge converts expiry to milliseconds; internal callers keep a `DateTime`.

## Policy scope

The closed Solana subset supports program allowlists, direct SOL transfers with a lamport limit and allowed recipients, and SPL `TransferChecked` with a mint, raw token-unit limit and allowed destination token accounts. Each transfer ALLOW contains all its constraints together. Broad program ALLOW rules reject System, Token and Token-2022 so they cannot bypass the narrower transfer rules.

These are **per-instruction** limits. Privy evaluates every instruction separately: several allowed transfers can exceed one instruction's cap, and an allowed custom program can transfer through CPI. The installed SDK and current [provider policy documentation](https://docs.privy.io/controls/policies/overview) expose no Solana transaction amount field, and the Floor adds no aggregate cap of its own ([decision log](../../docs/decisions.md#stack-and-platform)). Privy rejects address conditions that need accounts found only in an address lookup table; see the [Solana examples](https://docs.privy.io/controls/policies/example-policies/solana). The sandbox evidence remains open in the [decision log](../../docs/decisions.md#open-items), before trading begins.

### What Solana policies can't express

Checked on 13 October against the installed 0.35.0 policy condition sources and the current documentation, without provider calls. [Stateful aggregations](https://docs.privy.io/controls/policies/stateful-policies) support Ethereum methods only, with rolling time windows; they cannot total the instructions of one Solana request. The newer [Anchor IDL conditions](https://docs.privy.io/controls/policies/example-policies/solana-idls) still inspect individual instructions. So there is no aggregate per-transaction cap, no limit on CPI transfers through an allowed program, and no stateful Solana limit until Privy offers one.

Policy attachment is a separate authority boundary: a wallet owner can change its attached policies through wallet PATCH. Giving the execution quorum wallet ownership therefore does not establish owner-only policy control, even if a different key owns the policy itself. [Additional signers](https://docs.privy.io/controls/authorization-keys/owners/overview) cannot administer the wallet or export its key, and a signer's restrictive policy must be explicit in its `override_policy_ids`, because [signer policies](https://docs.privy.io/recipes/wallets/conditional-signer-policies) are independent of wallet-level ones. The native edge exposes wallet and policy updates; it does not yet provision or verify that separation, which stays an [open item](../../docs/decisions.md#open-items).

### Administration authority blocker — 14 October 2026

The offline investigation cannot establish the full requested separation using Privy's documented controls. Implementation stopped under the owner's instruction to report a missing provider control rather than work around it. No delegation, additional tests or sandbox script were added, and no Privy API calls were made in this investigation. The existing test preloads and signer dependency fences remain unchanged.

Wallet administration and quorum administration are different boundaries:

| Requirement | Available evidence |
| --- | --- |
| Keep wallet ownership, policy attachments, additional signers and wallet-key export out of routine execution | Privy's [owner/signer permissions](https://docs.privy.io/controls/authorization-keys/owners/overview) explicitly support this with a separate wallet owner and an additional signer. Policy rules also need a separate owner, and the additional signer needs an explicit restrictive override policy. This configuration is not yet implemented or sandbox-verified here. |
| Prevent routine execution from replacing its quorum members or changing its threshold | The [quorum update API](https://docs.privy.io/api-reference/key-quorums/update) accepts replacement public keys, users, nested quorums and a threshold. Privy's [authorization rules](https://docs.privy.io/api-reference/authorization-signatures#updating-key-quorums) explicitly say quorums have no owners: updates and deletion require signatures meeting the existing quorum's threshold. The [quorum update intent](https://docs.privy.io/api-reference/intents/update-key-quorum) also requires its members' authorization. The supported shapes expose no separate administrator, administration threshold, policy attachment or immutability switch. |

The installed development oracle, `@privy-io/node` 0.35.0, agrees: `src/resources/key-quorums.ts` defines the mutable fields, `src/resources/intents.ts` documents member authorization for `updateKeyQuorum`, and `src/resources/wallets/wallets.ts` makes `AdditionalSignerItemInput.signer_id` a `KeyQuorumID`. Registering a [single authorization key](https://docs.privy.io/controls/authorization-keys/keys/create/key) through the REST API still uses a key quorum; it does not supply an independent administration control.

For the planned two-of-two execution quorum, one member alone being unable to update it is a narrower guarantee than keeping administration outside routine execution. The agent and signer together hold the execution quorum's member authority. A local refusal to call PATCH would not remove that authority from compromised credentials. Adding another co-authorizer or requiring the owner on routine requests would change the requested design. Neither was introduced.

This is a documentation and installed-source finding, independently reviewed twice, not an observed live quorum modification or proof of a provider bypass. Before implementation resumes, Privy must identify a supported control that separates quorum administration from execution, or the owner must explicitly revise the requirement. After that, the sandbox proof still needs positive execution and owner-administration controls plus negative attempts to replace policies, owners, quorum members or thresholds, add signers, export keys and widen signer authority. It must require both an explicit environment opt-in and a command-line flag, and use only approved sandbox resources. No such proof has run; Stage 3 trading remains blocked.

## SDK oracle and production fences

The native client is the chosen implementation. `@privy-io/node` **0.35.0** is an exact `devDependency` of this package only; it is not a production fallback. The SDK provides an independent implementation for comparison, the same role the Meteora SDK serves for the chain maths. Source lint and emitted-module/source-map checks reject `@privy-io/node`, `svix` and `@hpke/*` from web, Floor, chains and the future signer. No test imports the SDK's `/solana-kit` helper, which peers on Kit ^5.1.0 while the project uses 8.

The SDK is still pre-1.0. The registry records 41 retained releases between September 2025 and September 2026, plus five removed releases from 2022; the request's count of 46 releases in about a year conflated those periods. An offline Bun 1.4.0 browser bundle of a minimal `wallets().get()` export measures **112,072 gzip bytes minified**, or **140,757 unminified**, across 430 mapped sources, including 252 `svix` sources and two HPKE sources. This entry does not reproduce the earlier approximately 249 KB estimate. These are measurements of the oracle SDK, not production artifacts. Reproduce with:

```sh
bun build work/privy-oracle/sdk-bundle-entry.ts --target browser --minify --sourcemap=external --outdir work/privy-oracle/sdk-browser-bundle
```

The entry, source maps, registry response and gzip measurements are retained under `work/privy-oracle/`; gzip uses Bun's default `gzipSync` settings. No bundled function was invoked.

## Offline evidence

`@floor/wallets/testing` holds two probes: one checks the native signing primitives with an ephemeral key, and one runs the client against a local HTTP fixture. Production must not import it.

The tests compare seeded generated requests for every native operation with the pinned SDK over capturing fake fetch implementations. They compare method, URL, body bytes and request headers, and compare authorization payload bytes separately. P-256 signatures are cross-verified over the other implementation's payload with the same public key; randomized signature bytes are never treated as an equality oracle. Multiple co-signers, idempotency, expiry and owner-signed PATCH are included. All credentials are synthetic labels and all signing keys are ephemeral test keys.

Six verbatim RFC 8785 reference input/output pairs are vendored under `test/fixtures/canonical-json/`, with their source commit and license. `canonical.test.ts` compares the exact expected UTF-8 bytes, covers numerical extremes (`1e21`, `5e-324`, `-0`, maximum finite values), numeric-looking and non-ASCII keys, and runs 1,500 generated JSON cases with seeds 8785, 256 and 20261013. Values outside RFC 8785's Unicode constraints must fail explicitly.

Observed differences remain tested and intentional:

- The native transport emits canonical JSON; the SDK normally uses insertion-order JSON. Generated comparisons give the SDK the same canonical property order, then compare actual captured bytes. A separate witness preserves the ordinary wire-order difference rather than normalizing captured output.
- The SDK adds its client/runtime diagnostic headers and `accept`; Effect adds trace headers. Tests assert the exact difference sets and equality of the remaining application and authorization headers.
- The SDK's high-level RPC supplies a default expiry; native expiry is explicit. Tests suppress that SDK default and compare both explicit expiry and no-expiry requests. Expiry is signed whenever present.
- The SDK's high-level update helpers omit idempotency. Tests exercise its own `prepareRequest` and generated PATCH methods to compare the native idempotent signed request. `prepareRequest` is not a public package export in 0.35.0, so the test helper reads the pinned installed development module directly. This is a test-only version coupling.
- The SDK's authorization formatter rewrites an empty body to an empty string. Native mutation Schemas reject empty bodies, so that special case is outside the supported request surface.
- The SDK accepts lone Unicode surrogates. The native canonicalizer rejects them, as [RFC 8785 §3.2.2.2](https://www.rfc-editor.org/rfc/rfc8785.html#section-3.2.2.2) requires.

Breaking tests exercise changed body, URL, method, app ID, idempotency and expiry, a missing quorum signature, duplicate signer identity and malformed key material. The local quorum verifier counts distinct verified public keys; repeated signatures are not additional authority. It is a labelled test fixture and cannot prove the remote provider enforces a quorum or policy.

Wallet creation, two-of-two quorum and policy enforcement through the real provider remain the [platform check](../../docs/platform.md#wallets). No owner keys, real funds, mainnet broadcast or user-session HPKE exchange were used.

### Test-transport incident

The task explicitly prohibited Privy calls. During timeout-test development on 13 October, a fixture used `Layer.provide` where `Layer.provideMerge` was needed to retain its fake Fetch service at request execution. Three faulty runs registered two read cases each, allowing up to six unintended `GET /v1/wallets/synthetic-stalled-wallet` requests to `api.privy.io`. The last run observed HTTP 400 for both cases without entering the fake transport; statuses for the earlier cases were not retained. Every case used the literal synthetic app ID `synthetic-timeout-app` and synthetic secret `synthetic-secret`.

A separate earlier timeout reproduction used the same unverified fixture pattern for two reads of `/v1/wallets/synthetic-wallet` with app ID `synthetic-app` and the same synthetic secret; its two outer timeouts do not prove whether transport escaped. Thus up to eight reads may have left the test process, with two HTTP 400 responses observed. No real credentials were loaded and these cases had no mutation or retry path. This violated the task's network restriction; it is not sandbox evidence.

Testing stopped when the mistake was identified. The fixture now retains its fake Fetch service and asserts request capture and cancellation. Root and package-local Bun test preloads block external Fetch before native delegation, including when a fixture loses its service injection. Allowed loopback requests cannot follow redirects. The guard regression uses a no-network sentinel beneath the guard, so breaking the guard in that test still cannot open a socket. The final verification below applies after this correction; it does not establish that earlier test development was entirely offline. The incident record and faulty scratch source remain under `work/privy-oracle/` and `work/privy-review/`.

Run `bun run test` here, or the root checks.

## Verification — 13 October 2026

The implementation checks below apply to commit `5dcb626` in the isolated `codex/privy-native-oracle` worktree, after the transport guard was installed. Raw logs are under `work/privy-oracle/`. The later B follow-up changed documentation only: two independent reviews checked the linked provider evidence and unresolved guarantees, and `bun run format:check` and `git diff --check` passed. Markdown is outside the configured formatter plugins; runtime checks were not repeated for these documentation corrections.

| Command | Result |
| --- | --- |
| `bun install --frozen-lockfile` | Passed with Bun 1.4.0 |
| `bun run format:check` | Passed |
| `bun run typecheck` | Passed across all workspace and tooling configurations |
| `bun run lint` | Passed, including production import fences and reviewed suppression budgets |
| `bun run test:leaf` | 153 tests, 6,970 assertions; zero failures |
| `bun run build` | Passed web, native Worker and chain builds, source-map/module fences and bundle budgets |
| `bun run test:native` | All three native Worker tests passed |
| `FLOOR_FLOW_REMOTE=false FLOOR_FLOW_URL=http://127.0.0.1:19740 FLOOR_RENDERER_PORT=5182 bun run test:flow` | One shell flow and all 52 renderer flows passed, including the existing look matrix and phone baseline |

The renderer's optional `FLOOR_RENDERER_PORT` keeps its default of 5180; this run used 5182 because the separate look checkout was active. This is local regression evidence. It is not a deployed-stage run, art approval, real-phone measurement or Privy sandbox proof.

The wallet oracle covers 156 seeded operation comparisons and cross-verifies three signers. Canonicalization covers all six vendored reference pairs and 1,500 generated JSON cases. The guard's four tests pass from both the repository root and package directory. Deadline tests prove cancellation after ten seconds for stalled success and refusal bodies; malformed response and reflected-secret cases retain their redacted foreign causes.

Scratch-copy mutation audits detected **31 of 31** deliberate changes, without modifying production files:

- 15 dependency/module-fence mutations, tested in a scratch copy with `bun test ./scripts/lint/test ./scripts/bundle-budget/test`; `work/privy-fence-mutations/results.txt` retains passing baseline and restored runs.
- 13 authorization/key-handling mutations: `python3 work/privy-oracle-mutations/run.py`; the final run explicitly preloaded the absolute `test/_offline.ts` path for every scratch command. Its baseline passed 21 tests and 2,449 assertions; `work/privy-oracle-mutations/report.json` records each command and failure. Two mutations disable local quorum-fixture guards, which prove test behavior rather than provider enforcement.
- Three canonicalization mutations: `bun work/privy-oracle/mutate-canonical.ts`; `work/privy-oracle/canonical-mutations/report.json` records failures when surrogate rejection, UTF-16 property ordering or numeric formatting is disabled.


## Verification — 14 October 2026 (authority investigation)

The requested local sequence passed with Bun 1.4.0 on an isolated checkout of `229969bcb605a3edd0d65b52b70b3338eb95c155` containing only these wallet documentation changes. Concurrent Atlas implementation in the shared checkout is outside this result. Logs, installed SDK source hashes and snapshots, the review receipt, and browser recordings/captures are retained under `work/wallet-authority-001/isolated/` in the primary checkout.

| Command | Result |
| --- | --- |
| `bun install --frozen-lockfile` | Passed |
| `bun run format:check` | Passed |
| `bun run typecheck` | Passed |
| `bun run lint` | Passed, including dependency fences and the unchanged 207-directive suppression budget |
| `bun run test:leaf` | 353 tests, 16,575 assertions; zero failures, with the existing external-network preload |
| `bun run build` | Passed web, Worker and chain builds, bundle budgets and module/source-map fences |
| `bun run test:native` | All three native Worker checks passed |
| `FLOOR_FLOW_REMOTE=false FLOOR_FLOW_URL=http://127.0.0.1:19740 FLOOR_RENDERER_PORT=5199 bun run test:flow` | Shell flow and all 72 renderer checks passed; renderer suite took 14.5 minutes and included the 360-capture look matrix and configured phone profile |
| `git diff --check` | Passed |

These checks cover the existing implementation and documentation; they do not prove the missing provider authority boundary. No Privy API request, sandbox proof, hosted preview/deployed flow, real-phone check or push was performed. Preview admission remains disabled and provider access remains unapproved. The open wallet item and Stage 0 approval remain open.
