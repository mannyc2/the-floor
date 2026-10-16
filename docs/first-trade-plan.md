# First trade, live

15 October 2026. One of the Floor's agents researches a token on a local Solana mainnet fork and writes a swap intent. The signer builds, simulates, signs and submits the trade and writes the receipt. A viewer watches the agent's desk change state live and opens its receipt. This is the first milestone's core, end to end and thin; the owner's 15 October rows in the [decision log](decisions.md) start it alongside the rest of [Stage 0](stage-0-plan.md).

**Done when:** the technical design's [Trade with a receipt](technical-design.md#the-flows) flow passes locally: Worker, signer and fork start, the scripted agent trades, and the viewer shows the state change and a settled receipt whose transaction the flow confirms on the fork.

**Implemented locally:** L, F, A and V are integrated with the cleanup and RPC dependencies. The combined browser flow enters through the production viewer, observes researching, trading and idle, picks the desk through the renderer, matches its receipt to the agent's actual result and confirms the transaction and checkpoint on the fork. Reloading recovers the receipt. Commands and results live in the implementation commit bodies; raw evidence stays in ignored `work/`.

The slice uses a labelled scripted model, a disposable fork key and one occupied canonical floor. It does not provide conversation recovery, live inference, Privy enforcement, hosted acceptance or approved asset geometry. Multi-floor navigation, movement and follow came afterwards with [World integration](decisions.md#repository-ci-and-spending). Those limits preserve the separate Stage 0 and later-stage gates.

## Rules

- The Stage 0 plan's [session rules](stage-0-plan.md#rules-for-every-session) apply: one browser suite at a time, no push, deploy or spend, and results in commit bodies.
- Inference is the scripted model in local runs. Never Anthropic's APIs. Live inference waits for a budget from the owner.
- No Privy calls. Fork trades sign with a local key Layer that exists only for the fork.
- The fork may read public mainnet RPC (no keys, no spend) to clone accounts.
- Use the contract's existing `SwapIntent`, `Receipt` and `WorldEvent` types. A contract change needs a reason in the commit body.
- No new art. Show state with already-approved materials; any new visual treatment waits for the owner's picks.

## Order

| When | Work |
| --- | --- |
| First | D1, R and S land. `codex/rpc-api` rebases onto R and merges (rebase only), ahead of asset-kit |
| Then, in parallel | L and F. A starts against test Layers of the floor and signer services |
| After W | V |
| Last | The end-to-end flow, then A, L, F and V update [Stage 0](stage-0.md)'s open items and the technical design |

## L. Live world

Branch `codex/live-world`. `apps/floor`, `packages/api`. Needs rpc-api on `main`.

- A Durable Object per world identity holds `packages/world`'s `World`, including its physical floors. Agents arrive at stations, change state and land receipts as `WorldEvent`s (`AgentJoined`, `AgentStateChanged`, `ReceiptLanded`) with checkpoints.
- Events are stored in the object's SQL, using R's Effect SQL pattern, so a reconnecting viewer resumes from its last delivery sequence. Each event separately retains its chain checkpoint.
- One RPC stream sends a snapshot and then deliveries (`WorldEventDelivery`).
- A service the agent calls to publish its state and receipts.

**Done when:** leaf tests cover folding events into the world, and a native test sees join, state change and receipt arrive in order, including after a reconnect.

## F. Fork and signer

Branch `codex/signer`. `apps/signer`, `packages/chains`. Needs S on `main`.

- Surfpool, pinned, starts for local runs and flows. A fixture launches a Meteora pool on the fork with the existing `MeteoraLaunch` construction, so trades don't depend on mainnet pool state.
- `packages/chains` builds a Meteora DBC swap from the IDL through the generated client.
- `apps/signer` is a Worker with no model or agent imports. It takes a `SwapIntent`, builds and simulates it, signs, submits and confirms, and writes a `SettledReceipt`, `RefusedReceipt` or `UnknownReceipt` with the transaction. An unknown outcome is settled from the chain, never retried blindly.
- A `Signer` service with a fork-key Layer, which refuses any RPC whose genesis isn't the fork's. Privy becomes a second Layer when the quorum blocker clears.

**Done when:** native tests show an intent settling on the fork, a swap past its slippage cap refused, and the signer refusing a non-fork RPC.

## A. Agent at work

Branch `codex/first-agent`. `apps/floor` agents.

- One Floor agent with a mandate on a Yielded Agent loop. Its tools are the chain reader (Kit over Effect's HttpClient, against the fork) and the intent door to the signer. Its policy caps turns, tool calls and duration.
- The scripted model drives it through the local test Worker; production has no scripted mode.
- It publishes `researching`, `trading` and `idle` states and its receipt to the floor.

**Done when:** a native test has the scripted agent read the fork pool, write an intent, get a settled receipt, and the floor record its states and the receipt.

## V. Viewer

Branch `codex/live-viewer`. `apps/web`. Starts after W lands, on its map.

- The production app subscribes to the floor stream and feeds the renderer's snapshot path. The workbench timer stays for renderer specs only.
- A desk shows its agent's state with approved materials.
- Clicking a desk opens a drawer with the agent, its state and its last receipt.

**Done when:** the end-to-end flow above passes, holding the browser slot.
