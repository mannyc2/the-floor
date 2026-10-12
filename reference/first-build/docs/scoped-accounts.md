# Connecting owner-authorized scoped accounts

The application includes a fail-closed Base Sepolia signing adapter. It does not contain an owner key, create a wallet permission, deploy a production smart account, or supply a remote signing service. Setting two environment variables enables an authenticated transport; each desk still needs an externally owner-authorized account whose on-chain module enforces the confirmed policy.

```dotenv
FLOOR_SIGNER_URL=https://your-audited-signer.example
FLOOR_SIGNER_TOKEN=your-server-only-credential
```

The URL must use HTTPS and have no embedded credentials, query or fragment. Keep the bearer token on the server. The application never puts it in a browser payload, inference prompt or public receipt. With either value absent, account lookups remain unlinked and financial execution cannot proceed.

## Owner setup and authority

1. Deploy or connect an audited smart account on **Base Sepolia, chain 84532**. Production mainnet is rejected independently of provider configuration.
2. Confirm the desk policy in The Floor. The server hashes the canonical `Policy` JSON with SHA-256 and binds that hash to the owner ID, wallet address and agent ID.
3. At the signing service, have that wallet owner authorize the account and a scoped session module. The module must constrain contract, function selector, asset, recipient, token and native-value limits, expiration and replay. A policy change changes the binding and requires fresh matching authority. The service must never treat a bearer token as owner authorization.
4. For foundry launches, have the deployed foundry registrar register the immutable account-to-owner binding. Configure `FLOOR_FOUNDRY_ADDRESS`, `FLOOR_FOUNDRY_TOKEN_SUPPLY`, `FLOOR_FOUNDRY_LAUNCH_FEE_WEI`, `FLOOR_FOUNDRY_GRADUATION_WEI` and `FLOOR_FOUNDRY_VIRTUAL_LIQUIDITY_WEI` to match that deployment. The pool adapter used for graduation must be independently audited.
5. Return fresh on-chain account evidence and independent valuations through the protocol below. The server checks the owner and policy binding, freshness, canonical proposal, persisted source evidence, owner pause, limits and exact launch calldata before dispatch.

The remote signing service is a trusted security boundary: the adapter validates authenticated responses, but does not independently prove the provider's ownership/module/simulation claims against a second RPC. That service must derive these facts from chain state and enforce them again at dispatch. Never use the test fixture account as a production ERC-4337 implementation.

## Launch review before signing

Every launch, including a direct proposal API call or an agent proposal, crosses the shared launch gate. The gate renders the world-owned bonding-curve template and asks the native visual decision provider about each required instrument and each content rule. The request includes the exact launch name, symbol, declared narrative, persisted thesis and cited notes. Instrument values in this pre-launch proof are explicitly labeled calibration values, never claimed market observations.

SQLite retains the canonical proposal fingerprint, a SHA-256 digest binding the proposal and source content, the full rendered image and its digest, the default design, named checks, provider probabilities and observation time. Signing reads this persisted evidence and rechecks it against the current proposal and source records. Both initial policy review and the atomic execution reservation require an accepted matching review; owner approval cannot bypass it. Changing the name, symbol, narrative, thesis or cited note invalidates the review.

Unavailable, timed-out or borderline review leaves a launch pending with the reason visible to its owner. An exact proposal may be reviewed again through the launch submission action before any execution; changed input under the same proposal identity is rejected. A rejected review cannot sign. Gate providers are independent from signing providers, and all remain unavailable until configured.

## Requesting an owner withdrawal

The authenticated workspace action is `{tag: "withdraw", agentId, amount}`. `amount` is a positive exact ETH decimal with at most 18 fractional digits. The server derives the account and recipient from fresh account evidence and the authenticated owner's stored wallet; the request has no destination, contract, chain or asset fields. It creates a Base Sepolia `owner-withdrawal.withdrawToOwner` proposal and an approval receipt, including while the desk is paused. Approval is a separate explicit owner action. Unlinked accounts and requests for another owner's desk are rejected before a withdrawal proposal is created.

An owner transfer does not require a research thesis or market quote. Its legacy numeric `valueUsd` field is `0` as a not-applicable sentinel; this is **not** a claim that the ETH is worth zero. Interfaces label the valuation as not applicable and show the exact ETH amount and bound recipient. This action currently handles native ETH only. The independent session module still enforces the prepared call and amount, and the no-retry and reconciliation rules below remain unchanged.

## Research holdings and checked assertions

The model cannot provide a position disclosure. After research completes, the server verifies the desk's owner-authorized account binding and reads the token balance, total supply, decimals and symbol at one current block through `BASE_SEPOLIA_RPC_URL`. It checks the RPC chain and the block hash before and after the reads. The persisted note records the exact base-unit quantities, account, token, chain, block hash, block number and observation time; the displayed percentage is rounded, while the evidence remains exact.

The research market and bound account must belong to the same chain. Current Base market readings use chain 8453, while the signing adapter supports Base Sepolia, chain 84532. That combination cannot verify a Base holding. Such notes and their brief stay private, with a publication-pending reason visible to the owner. A testnet receipt never establishes a mainnet position, and an unavailable balance never becomes zero. Legacy notes without verifiable position provenance are retained privately. Public queries require recorded holdings evidence.

An agent can propose a structured assertion over a numeric field returned by `ReadMarket`, with a comparison, expected value and exact source block. The server checks only a matching source actually returned by that tool, generates the claim wording from the assertion and saves the observed value, chain and block hash. True comparisons become verified; false comparisons remain visible as contradicted evidence and contribute to calibration. Unsupported fields, guessed citations and mismatched blocks remain pending. Free-form interpretations retain their cited sources without becoming verified chain facts.

## HTTP protocol

All endpoints are `POST`, accept JSON and require `Authorization: Bearer …`. The canonical request and response schemas are exported by `@floor/signing` from `packages/signing/src/scoped-accounts/protocol.ts`; implement those schemas directly. Unknown or malformed responses fail closed. Dates are UTC ISO strings, hashes are 32-byte hex strings, addresses are 20-byte hex strings and chain IDs are the literal number `84532`. Quantities in base units are unsigned integer strings. Human quantities preserve exact decimal strings.

`AccountBinding` contains `ownerId`, `ownerAddress`, `agentId` and `policyHash`. A binding is not a signature or authorization by itself. The provider must compare it with owner-authorized account state.

| Endpoint | Request | Response and obligation |
| --- | --- | --- |
| `/v1/accounts/read` | `AccountBinding` | `AccountReadResponse`: `{status: "unlinked", reason}` or `{status: "verified", account: ScopedAccount}`. Verified evidence includes matching binding, account, permission ID, chain ID, observation block/time, expiry, `ownerVerified: true`, `moduleEnforced: true` and nonempty permissions. Derive those assertions from the actual owner/module. Evidence older than 60 seconds, future-dated evidence and expired sessions are rejected. |
| `/v1/accounts/quote` | `{binding, proposal}` | `AccountQuote`: matching binding/account/proposal fingerprint, observed block/time and expiry, independent wallet USD, resulting position USD, daily loss USD, action USD value, launch counts and allocation unlock time (`null` when none). Never copy a model's claimed USD value as the valuation. The application separately checks locally reserved launches and persisted thesis/source links. |
| `/v1/transactions/prepare` | `PrepareRequest`: binding, account, permission ID, receipt ID, complete proposal, canonical fingerprint and approval expiry | `PreparedExecution`: immutable plan ID and matching identities; target, method, selector, complete calldata, native value, asset/base-unit amount, fixed recipient, original decimal amount/symbol/USD/slippage, successful simulation block and expiry. Simulate the actual account/module call against current chain state. The plan expires no later than the approval, session and quote. No broadcast occurs here. |
| `/v1/transactions/dispatch` | `DispatchRequest`: plan ID, receipt ID, fingerprint and permission ID; header `Idempotency-Key: <receiptId>` | `DispatchResponse`: matching receipt/fingerprint/account/chain plus `rejected` with `accepted: false` and reason, `submitted` with a genuine hash, or `confirmed` with genuine hash and positive mined block number. Only `rejected` may assert no acceptance. Atomically bind the receipt ID to the original immutable plan before accepting any send; a repeated ID must return its original outcome and must never send again. |

Every permission contains `contract`, `method`, four-byte `selector`, `asset`, fixed `recipient`, `maximumAmount` and `maximumNativeValue`. The module must enforce those fields on-chain, including indirect token approvals and calls. For a launch, the server independently encodes `FloorFoundry.launch` from the discriminated proposal and compares **all calldata and native value** with the prepared plan. Trade call encoding and valuation must be supported and verified by the audited provider. Owner withdrawals use only the canonical account method and bound owner recipient, and always require explicit owner approval even when the desk is paused.

The canonical proposal fingerprint is the exact JSON string produced by `Schema.encodeSync(Schema.fromJsonString(Proposal))` over a decoded proposal. It is not a hash and contains private instructions. Preserve its exact bytes; never publish it. The account policy hash uses SHA-256 over the analogous canonical `Policy` JSON. Responses encode Effect `DateTime` and `Option` using the exported schemas, so allocation unlock absence is JSON `null` rather than an Effect object.

Reads, quotes and preparation have ten-second timeouts. Dispatch has a twenty-second timeout. The adapter does **not retry** dispatch. HTTP errors, timeouts, malformed evidence and a mismatched dispatch identity become an uncertain outcome.

## Durable execution and recovery

`Proposals.submit` owns policy review, identity checks, idempotency, receipt creation and persistence. The journal then atomically compares the approved receipt, exact proposal, current policy, owner pause, source evidence and exposure facts before writing `executing`. Only the invocation that wins that comparison may call the executor. Seeing `executing` after a restart never grants permission to send.

A known rejection becomes `failed`. An accepted transaction produces `submitted` or `confirmed` using genuine chain evidence. If a response is lost, the receipt becomes `uncertain`; if the result cannot be committed, its durable `executing` reservation survives. Settlement compares the reservation itself, so later policy edits cannot erase an observed transaction hash.

Reconcile unresolved receipts against the provider's **original idempotency record** and chain receipt. `reconcileDispatch` accepts independently observed transaction evidence and preserves the original receipt identity. Persist that reconciled result through the authoritative journal or an audited administrative migration. There is no automatic remote reconciliation worker or owner UI to invent a missing hash. Do not create a replacement proposal to work around an unresolved send.

## Local proof and its limits

`testing/flows/trade-with-a-receipt.test.ts` runs recorded native model tool exchanges, the real researcher, SQLite repositories, proposal review, signing journal and HTTP adapter, then sends through an actual scoped account on a fresh isolated Anvil node. It checks the mined hash, block, token balance, source/thesis/policy links and one-send behavior. The other financial flows prove native-clock approval expiry, canonical owner withdrawal, exact foundry launch, direct/allowance/curve allocation lock, seven-day unlock and liquidity graduation.

Only external network edges are recorded or replaced. Anvil generates fresh local keys and its URL internally; these tests cannot select a caller RPC or broadcast to a public network. `ScopedAccountFixture.sol` is explicitly a test account with single-use exact-calldata permissions. The pool in the tests is a minimal test fixture. These proofs establish local application and contract behavior, not a production account/module/pool audit, wallet-provider interoperability or deployed Base Sepolia availability.
