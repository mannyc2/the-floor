# The Floor: technical design

Oct 11, 2026 · @tim · revised Oct 12, 2026

This is how the Floor gets built. The product doc says what people see; this doc says what has to be true underneath for it to stay honest, fast and open to contributions. Everything here was chosen so the expensive decisions are made once, early, and everything else can be added later without migrations. What the first build taught, and why this revision changed what it did, is in The Floor: what the first build taught us.

## Principles

### The order of work

Two kinds of decision get more expensive every day they wait. The contracts are one: every design, agent and receipt is written against them, so changing one later means migrating all of them. The look is the other. A single machine's design is local and can be redrawn, but the camera, the share of the screen the map gets and the way assets are made are architecture. A dashboard with a small map in it, or a world assembled from boxes, can't be polished into the Floor. That sets the order.

0. **The skeleton.** The toolchain, every lint rule and fence, CI and a deployed preview stage, all passing on an empty repo before any feature code.
1. **Contracts.** Chain-neutral identifiers, the Schema types, the reading contract per kind of market, the submission format, the mandate and policy, the action intent and the receipt.
2. **The look.** The camera, the map-first screen, and one district and one machine drawn to their reference frames and signed off by a person.
3. **The gate.** The checks that let a design, a build or a launch be accepted without a person reading it.
4. **The shared runtime.** Renderer, atlas layer, chain adapters, wallet provider and agent runtime, built once for everything.
5. **Content and breadth.** More machine designs, island traditions, sound, the sea. All of it is additive.

The contracts are designed first but proved continuously against a real slice of the map, because every rule so far has come from a concrete case breaking an abstract one. The look is proved the same way, against reference frames in the running app, from the look stage on.

### Build on protocols, not beside them

The Floor's own work is the map, the agents' honesty and the policy that guards money. Anything a mature protocol or provider already does well, the Floor integrates rather than rebuilds. Launches go through each chain's established launchpad protocol. Sign-in, wallets, card funding and the agent's second key come from a wallet provider. Market data comes through one chain adapter per chain, reading from a data provider where one covers the venue. Each integration sits behind a service with one default Layer, so a provider can change without touching anything that uses it.

### Deviations are written down

When the build substitutes something this doc names (a runtime, a provider, a library, a milestone item), the substitution and its reason go in the archive's decision log before the work merges. A design that quietly turns into a different one can't be reviewed, and the next person can't tell a decision from an accident.

### One honesty rule

Nothing on the Floor may change because of something you can't trace. That one rule shows up in three places:

- **Machines** read only the chain data their market's reading contract declares. A design chooses the form, never the inputs.
- **Agents** act only through the signing service and its policy, and every action leaves a receipt linking sources, thesis, policy check and transaction.
- **Community builds** read only their own token's numbers, through drivers that can't see anything else.

### Nothing simulated

The chain is the simulation. The Floor renders real state and records its own events (agents' actions, notes, approvals), stamped with the checkpoint (the block or slot) they happened at. That makes replay exact and cheap, and it means the server never runs a model of the market, only an index of it.

### Additive, always

Signatures and schemas grow; they never break. A new kind of market adds a reading contract. A new instrument adds a kit part. A new chain adds a chain adapter and an island. A new launchpad adds a launchpad adapter. Nothing that already exists has to change for any of these.

### Proved by real flows

A claim about the Floor counts only when a flow proves it: the real components, run end to end, with only the edges recorded. Each product promise (every trade has a receipt, a hostile page can't move money, replay matches live) is a named flow that runs on every pull request, locally and against that pull request's preview stage. Unit tests prove the leaves; flows prove the product. A flow that sets the value it then asserts, or computes its expectation with the code under test, proves nothing, so Verification sets out what makes a flow count.

### Defaults over open questions

Nothing waits on an undecided question. Each one gets a sane default now, held where it is cheap to change: a setting, a swappable Layer, or an algorithm judged by a benchmark. Defaults, and how they change, near the end, lists them.

## System overview

The Floor has two sources of truth, the chains and its own agents, and one trusted path for anything that moves money.

&#91;embedded content: architecture · market data down the left, money through the signing service on the right\]

No agent transaction can be signed without the signing service, and nothing in it calls a model.

- **Market data** flows one way. One chain adapter per island reads its chain, through a market-data provider where one covers the venue and directly otherwise, and normalises it into readings (reserves, prices, trades, liquidity bands, curve progress, utilization), each stamped with the checkpoint it was read at. Adapters write readings to a history store and stream them to district objects. A district object aggregates its markets, assigns tiers and streams updates to the viewers looking at it.
- **Owners and money** come through the wallet provider. An owner signs in with an email, Apple, Google or a passkey; the provider creates their wallets on every island's chain, card funding arrives as a dollar balance, and withdrawals go back to the owner's bank or own address.
- **Agents** live in their own objects. Each runs its loop against a cloud browser, an inference service and the chain readings. When it wants to trade, launch or withdraw, it writes an action intent: what to do, in assets and dollars, never calldata. The signing service checks the intent against the owner's policy, has the island's adapter (or launchpad adapter) build the transaction, simulates it, and adds the second signature the agent's wallet needs. It returns what the agent needs for its receipt.
- **Designs, builds and launches** enter through the gate. What passes is written to a registry of designs and baked impostors, which the district objects and renderers read from. Launches that pass go to the island's launchpad protocol.
- **Viewers** run the renderer, the atlas layer and the few pieces of interface that sit over the map. They hold no authority: everything they show comes from district and agent streams.
- **Public surfaces** (the MCP server, live link previews, plates and embeds) read the same streams and stores as viewers do, so they can never disagree with the map.

## Data model

Every type below is an Effect Schema in one shared contract package. The same definitions validate submissions at the gate, type the streams to viewers, define the API (through a thin api package built from them), and describe the MCP server's tools, so the surfaces can't drift apart. Each type is defined once; nothing downstream redefines a narrower copy of it.

### Identifiers

The Floor spans chains that don't agree on what an address, a token or a block is, so nothing outside a chain adapter is allowed to know. Identifiers follow the chain-agnostic CAIP standards.

| Type | Holds |
| --- | --- |
| Chain ref | A CAIP-2 chain id, such as `eip155:8453` for Base or `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` for Solana |
| Account ref | A chain ref and an address in that chain's own format (CAIP-10) |
| Asset ref | A chain ref and an asset: native, an ERC-20 contract or an SPL mint (CAIP-19) |
| Transaction ref | A chain ref and a transaction hash or signature |
| Checkpoint | A chain ref, a height (a block or a slot), its hash and its time |

History, replay and receipts are keyed by chain and height, and ordered across islands by time, so islands with different block times share one timeline. No schema outside a chain adapter contains a `0x` pattern, a block number on its own, or a unit like wei.

### The map

| Type | Holds |
| --- | --- |
| Chain | Chain ref, name, family (EVM or Solana), block or slot time, its island's tradition |
| Venue | A protocol on a chain (a Uniswap v3 deployment, Meteora's bonding curve), the kind of market it makes, and whether a data provider covers it |
| District | Id, chain, kind (narrative or protocol), fixed anchor, current footprint |
| Token | Asset ref, district, tier, logo, name, and its launch (launchpad and launcher) if it was launched through the Floor |
| Market | Id, token, kind, venue, and the design it is drawn with |
| Reading | A market's current values for its kind (reserves, price, liquidity bands, curve progress, utilization, open interest), stamped with a checkpoint, and its source: chain, provider, recording or synthetic |
| Reading contract | For each kind of market, the readings a design must show and the scale each is read against |
| Design | A data-only submission: parts and housings, images, drivers, behaviours, and which brass parts bind to which readings |

### Owners, agents and their output

| Type | Holds |
| --- | --- |
| Owner | Sign-in identity, wallets (an account ref per island), verified withdrawal destinations, and the dollar balance as the wallet provider reports it |
| Agent | Id, owner, emblem, wallets (an account ref per island it works on), signer reference, mandate, policy, visibility, budget |
| Mandate | The owner's instructions in plain words |
| Policy | The hard limits, as structured fields in dollars and venues: islands and venues allowed, maximum trade and position, daily loss limit, slippage cap, approval threshold, launch permission and launch budget. Never contract addresses or methods |
| Action intent | What the agent wants done: a swap (sell one asset for another, in dollars, with a slippage cap), a launch (a launchpad and a launch spec) or a withdrawal (always to the owner). The model writes intents; adapters write transactions |
| Note | One claim about one market, its sources (including other agents' notes), the author's position at the time, and a verification status |
| Thread | A question, the markets it spans, and its finding once closed |
| Thesis | A belief, what would change it, the notes behind it, and the reading and date it resolves against; once resolved, held or failed |
| Receipt | An action (an intent, or a design or build sent to the gate), its cause, the policy check or gate verdict it got, the transaction ref and the checkpoint it landed at, or a refusal, or an outcome marked unknown until the chain settles it |
| Brief | A dated summary for the owner, public or private |

### Everything else

| Type | Holds |
| --- | --- |
| Scribed line | A token, a price, an owner, and whether it has been crossed |
| Plate | A permanent number, a title, a captured view state, a checkpoint per island in view, and linked receipts |
| Floor event | Anything the Floor itself records (an agent's state change, an approval, a pin), stamped with a checkpoint for replay |
| Setting | A typed value, its default, its scope (the Floor, a chain, a district, a token or an agent), and the Floor event that last changed it |

The mandate and the policy are deliberately separate. An owner writes the mandate in words. The interface proposes a policy from it as structured fields, and the owner confirms those fields. Only the confirmed policy is ever enforced, so a misread sentence can never become a limit nobody agreed to.

Fields that may be absent decode to `Option`, and times decode to `DateTime`, so code past the boundary never handles `null` or parses a timestamp.

## Designs as data

A design is a description, never code. Nobody's code runs on a page next to a wallet, and one trusted renderer can batch every machine on the map. A design has five parts.

- **Parts** come from the kit, in any arrangement and any material the island's tradition allows: structure, round things, motion, flow and display parts. A part can also be a **housing**: a designed asset from the Floor's library (a tank house, a mill, a lily stem), modelled by hand or generated by code, with named sockets where instruments, the logo and the name plate attach. Primitives nobody designed can't reach the density of the key frames; designed housings can, and the brass rule still holds because the instruments in their sockets stay the world's.
- **Readings** map each reading the market's contract requires to an **instrument** placed on the design. Instruments are kit parts the world owns: level gauge, float well, tide gauge, engraved arc, tray rack, track with graduation line, utilization dial, weight scale, pour and stamp. The designer places and sizes them, and the world draws their brass, their engraved scales and their motion. A designer can't fake a scale, because they never draw one. Each instrument reads against the scale its reading contract declares, linear or logarithmic over a stated range (by default the day's range for that market), so a level never wraps, resets at a round number or saturates without showing it.
- **Drivers** are pure expressions for anything else that moves. They may read only the token's own numbers and the time, use a handful of helpers (`clamp`, `min`, `max`, `sin`, `ease`, `step`), and may never drive a brass part.
- **Behaviours** are small state machines that fire on events: a whale buy, a new high, graduation.
- **Images** are the token's logo and emblem, printed onto signs, plaques and flags.

A community-designed pool for a frog token, as a lily-pond water clock:

```json
{
  "market": "toad-weth-pool",
  "kind": "constant-product",
  "parts": [
    { "id": "stemA", "kit": "column",   "material": "enamel-green", "size": [8, 60] },
    { "id": "cylA",  "kit": "cylinder", "material": "glass", "parent": "stemA" },
    { "id": "stemB", "kit": "column",   "material": "enamel-green", "size": [8, 44] },
    { "id": "cylB",  "kit": "cylinder", "material": "glass", "parent": "stemB" },
    { "id": "pad",   "kit": "beam",     "material": "enamel-green", "shape": "leaf" },
    { "id": "reeds", "kit": "reeds",    "material": "timber" },
    { "id": "sign",  "kit": "sign",     "material": "timber", "image": "emblem" }
  ],
  "readings": {
    "reserve0": { "instrument": "level-gauge", "on": "cylA" },
    "reserve1": { "instrument": "level-gauge", "on": "cylB" },
    "price":    { "instrument": "arc", "on": "pad" },
    "trades":   { "instrument": "pour", "from": "cylA", "to": "cylB" },
    "history":  { "instrument": "tide-gauge", "at": [56, 0, 12] }
  },
  "drivers": { "reeds.sway": "0.03 * sin(t)" },
  "behaviours": [{ "on": "whale_buy", "do": ["splash:cylB"] }]
}
```

### How designs run

Drivers and instrument motion compile to shader code. Each machine's readings arrive as a handful of per-instance values, so no JavaScript runs per machine per frame. Behaviours run on the CPU, but only when their event fires. Parts and housings are instanced geometry, so a thousand designs draw in a few dozen calls.

### Adding a kind of market

Adding a kind of market means adding four things: a reading contract, a default design, any new instrument it needs, and a venue normaliser in each chain adapter that produces its readings. Nothing that already exists changes.

## The gate

Three things enter the Floor from outside: designs (for machines), builds (for community plinths) and launches (from the foundry). All three pass one gate, cheapest checks first, so most rejections happen in milliseconds. A launch must clear the whole gate in under ten seconds, the length of its casting animation, and agents can run the same checks locally before submitting anything.

| Check | What it catches | Time |
| --- | --- | --- |
| Schema | Malformed submissions, unknown kit parts, drivers that read anything but the token's own numbers or touch a brass part | Milliseconds |
| Reading contract | A design missing an instrument for a required reading | Milliseconds |
| Budget | Too many parts, animated nodes or texture pixels for the token's tier | Milliseconds |
| Fit | A plinth already taken, or geometry colliding with neighbours or covering a machine | Milliseconds |
| Render | Renders the design against live readings, and bakes the impostor and sprite loop that distant views use | One to two seconds |
| Legibility | One Decisions `predicate` per required reading, asked of the render: "can the price be read from this image?" | About a second |
| Judgment lints | Decisions questions for brand impersonation, copyrighted characters, slurs, and scam links or wallet addresses in names, images or text | About a second |
| Rate and fee | Launch budgets and rate limits per agent and per owner; the launchpad protocol collects its own fees | Milliseconds |

Each Decisions question has two thresholds, tuned on labelled examples from the first slice of the map. Above the upper one a submission passes, below the lower one it bounces, and anything in between waits for a steward. A bounce names the check that failed. The submitter's own agent can ask its model why, since the Decisions API returns typed answers without explanations.

Rate limits and fees do more against spam than any lint. The lints exist for what money can't filter: impersonation and abuse.

## Agent runtime

Each agent is a Durable Object. It holds the agent's state, runs its loop, and wakes itself on alarms when it decides to pause and resume, which is what makes it always on rather than run on request. It reaches the outside world only through services the world provides, so everything it can touch is declared.

The loop itself is a [Yielded Agent](https://github.com/yielded-dev/agent/): `Agent.make` with the agent's input and output schemas, its toolkit, and a policy capping turns, tool calls and duration, run inside the object by Yielded's durable runtime, whose source already provides for threads living in Durable Objects; the platform spike confirms it.

The agent's browser is a provider Layer behind [Yielded Agent's browser capabilities](https://yielded.dev/agent/guide/browser/): capture tools that read a page as Markdown, content or links, and interactive sessions that navigate, click and inspect, each with a fixed lifetime, a cap on actions and a private live view the owner can watch or take over. Three implementations sit behind it:

- **Cloudflare's browser**, through Yielded's Cloudflare adapters, is the default. It is reached from the Worker the agent already lives in, on the same platform as the headless renderer, with no second vendor to pay or wire up.
- **Browserbase**, through [effect-browserbase](https://github.com/mannyc2/effect-agent-browserbase/), is the alternative Layer, if Cloudflare's sessions, live view or network policy fall short for desks.
- **Local Chromium**, through effect-browser, is for development and flows only, so nobody pays for hosted sessions to run tests. In flows it browses the fixture site.

One question stays open for the platform spike. The product's default is the open web, read-only, with known drainer domains blocked. Yielded enforces public-web-only browsing (`PublicWeb`) only on adapters that can check addresses at connection time, and its Cloudflare adapter can't. So on Cloudflare, an agent's browsing is either an allowlist of hosts (`ExactHosts`, which capture tools also require) or unrestricted with the Floor's own denylist in front of it. The spike decides between those, or moves open-web sessions to a provider that can enforce `PublicWeb`. Either way the decision goes in the decision log.

| Service | What it does | Notes |
| --- | --- | --- |
| Browser | Capture tools for reading and an interactive session for navigating | Page content is tagged as untrusted wherever the model sees it. Sessions have a fixed lifetime and an action cap, and a successful input is never taken as proof the site accepted it, so uncertain actions are never retried. The owner watches and takes over through the session's private live view |
| Inference | Model calls, metered against the agent's budget | Behind Effect's AI module, with a Layer per provider so the owner's choice of model is real. Calls stop when the day's budget is spent |
| Chain reader | Read-only access to readings and history on every island | The same streams the viewers get |
| Computer | A sandboxed machine for the agent's own analysis: chain queries, scripts, backtests | No keys and no network beyond the chain readers and the browser; what it produces is data for notes and theses. Yielded Agent's code executor is the candidate, checked in the platform spike |
| Public record | Writes notes, threads, theses, briefs and designs | On-chain claims are verified against the chain after they are written, theses are resolved on their dates, and citations of other agents' work are tracked |
| Gate | Takes the designs and builds the agent drafts | The same checks a person's submission gets |
| Signing service | The only way an agent's action gets its second signature | A separate Worker that contains no model |

An agent is as capable as its mandate allows: it can investigate, trade, launch, build and publish. Everything it does that reaches beyond its own desk passes through one of three doors, and each leaves a receipt. Action intents go to the signing service, designs and builds go to the gate, and posts outside the Floor need the owner's permission. It never writes calldata, chooses a contract address or names a recipient. New capabilities arrive as new kinds of intent or submission, additively, with a door of their own.

### The signing service

This is the one component whose correctness protects money, so it is small, separately deployed and separately audited. It holds no one's funds: the owner's wallets come from the wallet provider, and the service holds one of the two keys an agent's action needs.

1. **Wallets belong to the owner.** At sign-in the wallet provider creates the owner's wallet on each island's chain, and the owner can export it. When the owner starts an agent, they approve a session signer on it as a two-of-two quorum: the agent's key and the signing service's key. Neither can move funds alone, and the owner can revoke both from any device. A session signer with no quorum or no rules attached would make the Floor custodial in effect, so the provisioning flow refuses to create one.
2. **Fixed limits are enforced by the provider.** The confirmed policy compiles to the provider's own rules: the programs and routers each island allows, a cap per trade, and the owner's verified destinations as the only recipients. These hold even if the signing service is compromised.
3. **Limits that need state are enforced by the service.** Daily loss, position size, dollar approval thresholds and slippage against a current price need portfolio and market state no provider rule can see, so the service checks every intent against them. Over the approval threshold it asks the owner, on their phone or in Telegram, and waits. Unanswered requests expire on their own schedule.
4. **Then the transaction is built, simulated, co-signed, submitted and recorded.** The island's adapter, or the launchpad adapter, builds the transaction from the intent. The receipt is written together with the transaction ref, so no trade can exist without one. A refused intent still produces a receipt, marked as a refusal. A submission whose outcome is unknown is recorded as unknown and settled from the chain, never retried blindly.
5. **The service never accepts a policy change from the agent.** Policy changes need a request signed by the owner. Withdrawals go only to the owner's verified destinations.

Launches take the same path. The launch permission, launch budget and rate limits are checked like any trade, and the launch goes to the island's launchpad protocol. The launching agent's allocation vests through the protocol's own lock (Meteora's locked vesting on Solana, Doppler's vesting on EVM islands), with a cliff no shorter than the cooling-off period, so the lock holds even if every service above it fails. Any of the coin the agent buys on the curve is held to the same period by the policy, which refuses to co-sign a sale.

### Untrusted pages

The browser will meet pages written to manipulate agents. Pages that look like instructions to an agent are flagged on the desk, but nothing depends on catching them. The worst a successful injection can do is make the agent propose an intent, and the policy decides what happens to every intent.

### Option: a loop run on Decisions

Not adopted; noted for a cheaper or free tier. The Decisions API can't call tools or write text, but it can make every choice in the loop while our own code does the rest.

- **Code does the work:** reading the chain, fetching pages, extracting links, calling the signing service.
- **Decisions makes each choice** from a fixed list: which market to inspect next, which link to follow, whether the evidence supports a claim (a predicate), conviction (a score), and the size bucket (a choice).
- **A writing model runs rarely:** a thesis when conviction crosses a threshold, and the daily brief. Notes become structured claims from a fixed catalogue, filled from chain data, so they are checkable by construction.

Input costs $0.10 per million tokens with no output charge, so an agent asking three 10,000-token questions every five minutes, around the clock, costs about $26 a month. A hostile page can at most tilt a choice among allowed options, and the receipt gets sharper: the questions asked and the probabilities returned.

Against it: one model, in public beta, that writes no search queries of its own and has unproven trading judgment. If adopted, the loop stays behind the DecisionModel service with a generative fallback. The owner's mandate compiles to a question set they confirm, as it already compiles to a policy, and a decision-quality flow on recorded days judges it against the generative loop.

## Data pipeline and replay

### Live

1. **Chain adapters** read each island and normalise what they read into readings for each kind of market. Where a market-data provider streams a venue in real time (launchpad curves, swaps, graduations), the adapter reads from it; the Floor writes its own normaliser only for venues no provider covers, and reads its own launches' pools directly through the launchpad's SDK. A provider's reading keeps the provider as its source and the checkpoint the provider reports, and a reading without a checkpoint is not admitted. Adding a venue adds a normaliser or a provider mapping and nothing else; adding a chain adds an adapter.
2. **District objects** subscribe to the readings for their markets. They aggregate, recompute tiers (with hysteresis), update the district's footprint around its anchor, and track which machine has the most value moving, so the orange part is decided once on the server rather than in every viewer.
3. **Viewers** subscribe to the districts in view over a WebSocket, using RPC with the schemas from the contract package. Updates are batched to a few a second per visible machine and interpolated on the client. Far districts send only their summary: footprint, brightness, tier counts and the tide reading.
4. **Agent objects** stream their events to their desks' viewers and to the district they're standing in.

### Replay

Every reading and every Floor event is stamped with a checkpoint, and both go to a history store keyed by chain and height. Replaying any moment means reading the store from a time onward, across every island in view, and feeding it through the same client code that renders live data. There is no separate replay engine to keep in sync. Agent positions, threads and pins replay because they are Floor events, and markets replay because they are readings.

### Sea level and sea state

Each island's tide gauge and chop come from one index per chain, computed in the district layer and streamed like any reading. The archipelago-wide sea level, the experimental part, is one more index on top. Its default index is set under Defaults, below.

### Agents act on the chain they read

An agent can only act on a market it can read, and the market it trades must be the market it studied. Testnets carry no real memecoin markets, so until real money is allowed, an agent's reading and its actions both run against a fork of each island's mainnet at a pinned checkpoint: Anvil for EVM islands and Surfpool for Solana. The pools, launchpads and routers on the fork are the real ones. Testnets are used only where a protocol's own test deployment is the point.

## Rendering and performance

If the Floor lags, nothing else about it matters, so the budget is set before anything is built and enforced at the gate. If it is bare or awkward to move around, nothing else matters either, so the look and the camera get acceptance criteria of their own.

### The screen

The map is the interface. The canvas fills the whole viewport, edge to edge, on every screen size. What sits over it is budgeted:

- The four corners of an Anatomy card: the place, its path (*Floor › island › district*), a hint, and a live readout.
- One floating search field, which flies the camera to whatever it finds and passes questions to the harbourmaster.
- One drawer, at most 360 pixels wide, beside whatever is selected. It holds only what can't be drawn (a note in full, a receipt, sources, the owner's controls) and never covers the selection or the orange part. On a phone it is a bottom sheet over a full-screen map.

Every feature names its place on the map before it is built. At most three things live on pages of their own: settings, the tide table, and the owner's account (sign-in, funding and withdrawals). The chrome never shows a number an instrument already shows, except as a readout anchored to that instrument while it is hovered.

### The camera

The camera is orthographic and fixed at the isometric angle, with no free rotation. It has to feel as good as a good web map, so its behaviour is specified and tested in the running app:

| Rule | Passes when |
| --- | --- |
| Grab | The ground point under the cursor or finger stays under it, within a pixel, with no smoothing while dragging, on both axes |
| Release | A drag released at speed glides to a stop; a slow release stops dead |
| Zoom | Wheel, pinch and double-tap zoom toward the point under the cursor or fingers; two-finger trackpad scroll pans |
| Bounds | Soft: the camera can't leave the archipelago entirely, and resists rather than stops at the edge |
| Flight | Choosing anything (a machine, an agent, a note, a search result, a view) flies there along a zoom-out, travel, zoom-in arc in 600 to 1,200 ms, and any input interrupts it. Nothing cuts |
| Up a rung | Escape, or a two-finger tap, goes up one rung of the zoom ladder |
| Links | The camera's state is in the URL, so every view is a link, back and forward retrace flights, and leaving the map and returning restores the view |
| Following | Follow modes (the current, an agent) stop the moment the person moves the camera |
| Phone | On a phone the map is the page: touch on the map moves the map and never scrolls something else |

Quarter-turn rotation, so a machine can be seen from its other side, is a setting to try during the look slice, off by default.

### The look, as acceptance

Rules alone don't make a good frame. A render can be orthographic, four-toned, hairline and lit by one orange part and still be bare, so each frame is also judged against a picture of what it should be.

- **Reference frames.** Before the renderer is built, each zoom rung (archipelago, island, district, works, machine, desk), each default machine, the stall and the figures get a reference frame in day and night: generated from the key frames, painted over by an artist, and committed under `testing/reference/`. Each frame has a reference scene spec in `testing/look/scenes/` (a camera bookmark, a frozen clock, the assets placed and what the frame must show), so the app can reproduce its view exactly.
- **Side by side.** Every pull request that touches drawing, the camera or the layout posts the live render beside its reference at each bookmark.
- **A person signs off.** Someone with art-direction authority approves the comparison before merge. Once a frame is approved it becomes a screenshot regression, so it can't silently get worse.
- **The newcomer test.** At every milestone, someone who has never seen the Floor is shown the map and asked which market is busiest and which agent did what.

### The Floor Atlas, in the repo

The design system is code, not a document the code copies from. `packages/atlas` holds the tokens, materials with their four-tone ramps, the line and shading parameters, camera rungs and flights, motion curves, reading scales, proportions and the screen's dimensions, plus the Schemas for asset manifests and reference scenes. A build script generates the stylesheet and the renderer's palette lookup texture from it. The renderer, the interface, the gate's material and budget checks and the look tests all read it, and lint bans colour and pixel literals anywhere else. A development-only workbench in `apps/web` renders every scene, asset and instrument with the real renderer, beside its reference frame, with the parameters live to tune. The published Floor Atlas artifact is generated from the package. The details, and the look spike that settles the rendering approach first, are in The Floor Atlas, as code.

### Assets

Every asset in the Floor's library is designed in the house style, and each is made whichever way suits it: modelled by hand in Blender, or generated by code. The two arrive the same way, as glTF with a manifest and the Floor Atlas's conventions (the kit unit, palette slots, edge ids, named sockets and a budget), so the renderer, the gate and the look tests can't tell them apart.

- **Generated by code:** anything whose shape follows data or layout. That means the instruments (so the world owns their brass, scales and motion), a rack with one tray per liquidity band, coastlines and terraces, quays, paving, bridges, threads, and the ground of each district.
- **Modelled by hand:** anything whose quality is in its silhouette. That means figures and their gear, landmarks, desks, the pieces of each island's tradition, and organic props.
- **Both:** hand-modelled modules that code assembles. A works compound or a market hall is laid out by code from modelled pieces, and a stall's variants come from parameters over modelled parts.

Code that depends on live data runs in the renderer. Code that only makes variety runs at build time and writes glTF, so its output is cached, budget-checked and shown in the workbench like any modelled asset. Each asset has several variants so neighbours differ, a base, a surface for the logo, a name plate, named sockets, and an idle motion, within its tier's draw budget. The stall gets the most care of any asset, because it is most of what people see.

An asset is done when it reads at its zoom rung as a 64-pixel thumbnail and matches its reference frame.

### The renderer

Three.js sits behind a Renderer service, mounted as a scoped resource so its lifetime is explicit and tests and the preview service can swap in other implementations. One shader handles the look: it shades each face in one of four tones by its normal, and lights the single orange part from a per-instance flag set by the district object. Edges come from a screen-space pass at a fixed one CSS pixel, so lines stay the same weight at every zoom and pixel density. Whether the pass reads surface ids baked into each asset (so the artist decides which edges draw, and a cylinder draws no stripes) or normals and depth is settled by the look spike. The four tones are tuned against the reference frames, not chosen in the abstract: near-white tones on a paper ground bleach the map. Kit parts and housings are instanced geometry, and materials are palette slots per instance, read from a lookup texture generated from the Floor Atlas, so changing a palette value or the theme restyles the whole map. Panning never rebuilds the scene; only what changed is updated.

### Level of detail

| Zoom | What is drawn |
| --- | --- |
| Archipelago | Island silhouettes, landmarks, the sea, and each district as a footprint with a brightness |
| Island | Districts with towers drawn, works as baked impostors, stalls as their instanced models |
| District | Works as impostors except the nearest few, threads and pins collapsed into density |
| Works | Full machines, agents as instanced figures, threads and pins individually |
| Machine or desk | Full detail, the exploded view, and the tide gauge's paper |

Impostors are baked by the gate when a design is accepted: a short sprite loop for live machines, and a single frame for rusted ones, which cost almost nothing.

### The atlas layer

Labels are drawn as signed-distance-field text in an overlay above the scene. They are prioritised by zoom (islands, then districts, then tokens) and laid out to avoid colliding with each other. They are never baked into the drawing, so they stay sharp at every zoom and change language without a re-render.

### Targets

These are starting numbers, not measurements; the bench measures them on every pull request.

| Target | Starting number |
| --- | --- |
| Frame rate, whole archipelago in view | 60 fps on a mid-range phone |
| First meaningful paint | Under 2 seconds |
| Updates per visible machine | At most 4 a second, interpolated |
| Stall | No custom parts; a handful of shared, instanced variants |
| Works | Up to 200 parts and 20 animated nodes |
| Tower | Up to 600 parts and 60 animated nodes |
| Visible agents | 10,000 as instanced figures before collapsing into density |
| Map share of the screen | The whole viewport on every device; the drawer at most 360 pixels |
| Camera | Grab error under a pixel; flights of 600 to 1,200 ms |

Clients report sampled frame times over a recent window. When frames run long, the renderer drops the least-watched works to impostors until it fits, and restores them when the window recovers.

## Verification

Every promise the Floor makes is checked by running the flow that keeps it, through the real components, on every pull request. The look is checked the same way, against reference frames and in the running app. Synthetic data is allowed only where scale is the question, and it is labelled so it can never reach the live map.

### Four layers

| Layer | Proves | Runs on | When |
| --- | --- | --- | --- |
| Leaves | Honest functions: normalisers, tier hysteresis, policy checks, driver evaluation, layout steps | `@effect/vitest`, with property tests drawn from every contract Schema | Every save and every pull request |
| Flows | A product promise, end to end | The real Workers and Durable Objects in local workerd, a fork of each island's chain at a pinned checkpoint, recorded pages and model calls; then the pull request's preview stage | Every pull request |
| Look | The camera rules, the screen budget and the reference frames | Playwright against the running app; renders beside their reference frames at each camera bookmark; a person's sign-off | Every pull request that touches drawing, the camera, the screen or assets |
| Bench | Scale and frame budgets | The real district object and renderer in a real browser on a phone profile, fed synthetic readings at scale | Every pull request that touches rendering, kit, districts or streams; nightly on real phones |

### What is real, what is recorded

Only the edges are replaced, and each stand-in is a recording or a fork of the real thing.

| Edge | Stand-in during a flow | Checked against the real thing |
| --- | --- | --- |
| Chains | A fork of each island's mainnet at a pinned checkpoint (Anvil for EVM, Surfpool for Solana), so pools, launchpads, routers and the signing path are real | Nightly against mainnet reads, and on each protocol's test deployment |
| Market data | Recorded provider streams and recorded days, replayed through the real adapters | Each recording keeps its checkpoints, so it can be re-derived from the chain |
| Wallet provider | The provider's sandbox, or a local signer enforcing the same compiled rules | Nightly against the provider's sandbox |
| Model calls | Recorded responses keyed by a hash of the request; an unrecorded request fails the flow | Nightly against the provider, re-recorded on purpose |
| Decisions | Recorded answers on the labelled set | Nightly, reporting drift against the thresholds |
| Web pages | A fixture site, including pages written to manipulate agents, browsed with local Chromium | Nightly through the production browser Layer; pages flagged as untrusted on real desks join the site |
| Time | TestClock, advanced by checkpoint times | Not needed: checkpoints are the clock |

### What makes a flow count

A flow proves its promise only if all of these hold:

- It enters through the production entry point, the way a person or an agent would.
- It replaces only the edges in the table above, and nothing inside them.
- No fixture sets the value the flow asserts. A hostile page is detected by the code that detects hostile pages, not flagged by its fixture.
- Its expectation is never computed by the code under test.
- Its assertion is the pass condition in the table below, word for word, over the span the table names (a recorded day means the whole day).

Before a flow merges, someone who didn't write it answers three questions in the review: what is stubbed, does any fixture set what is asserted, and does the assertion match the pass condition?

### The flows

Each flow is named for the promise it keeps, and its recording is the pull request's demo.

| Flow | Passes when |
| --- | --- |
| Money in, money out | An owner signs in with an email, funds with a test card in the provider's sandbox, sees one balance in dollars, an agent trades from it, and the owner withdraws; no screen shows a chain name, an address or gas unless the owner opens the advanced view |
| Trade with a receipt | An agent on the fork studies a market and trades that same market; the receipt links sources, thesis, policy check and transaction, and its emblem is stamped on the tide gauge's paper |
| Approval expires | A trade over the threshold raises the flag, nobody answers, the request expires on its own schedule, and nothing is signed |
| Hostile page | The agent reads a page written to instruct it; the desk flags it, the mandate and policy are unchanged, and every intent is judged by the policy alone |
| Funds only go home | A withdrawal to anywhere but the owner's verified destinations is refused by the provider's rules and by the signing service, each with a refusal receipt |
| One key isn't enough | A transaction signed by the agent's key alone, or the signing service's alone, is rejected by the provider |
| Launch and lock | An agent launches a coin through each island's launchpad on the fork, the ball climbs and graduates into a pool, and the allocation can't be sold during cooling-off, even by calling the protocol directly |
| Design through the gate | The lily-pond pool passes every check; a copy with its price reading removed bounces, naming the reading contract check |
| Replay matches live | A recorded hour rendered live and then replayed gives identical frame hashes at sampled checkpoints |
| One orange part | Across a recorded day, every frame at every zoom has exactly one lit part, on the market with the most value moving, as measured independently of the code that chose it |
| Notes are checked | A true on-chain claim written by an agent is marked verified and a false one contradicted, through the same path production uses |
| Theses resolve | A thesis reaching its date is marked held or failed from the reading it named, and the agent's track record changes accordingly |
| Sources carry their weight | An agent's thesis cites another agent's note; when that note is contradicted, the thesis is flagged on both desks, and when many theses rest on one note the map shows the warning |
| An agent builds | An agent drafts a design for its owner's token, the design passes the gate as a person's would, and it appears in blueprint ink on the plinth until the vote decides |
| Map stays put | Over a recorded month of arrivals and departures, no works moves further than the layout setting allows |

A flow is one Effect program written against services, so the same file runs locally with test Layers and against a preview stage with live ones:

```ts
// testing/flows/trade-with-receipt.flow.ts
export const tradeWithReceipt = Flow.make("Trade with a receipt", Effect.gen(function* () {
  const agent = yield* Agents.spawn(Fixtures.wren)
  const receipt = yield* agent.runUntil("Trading")
  yield* Expect.sameMarket(receipt, agent.studied)
  yield* Expect.receiptLinks(receipt, ["sources", "thesis", "policy", "transaction"])
  yield* Expect.stampedOnTideGauge(receipt)
}))

// bun run flow trade-with-receipt                local: forks, recordings, fixture pages
// bun run flow trade-with-receipt --stage pr-412   the pull request's preview stage
```

### The bench

The bench answers whether the Floor stays fast at scale, with numbers on every pull request. A scenario is data: tokens per tier, agents, how fast readings arrive, and a camera path. The bench generates tokens and readings from the contract's Schemas, shaped by a recorded day's distributions so the load looks like a real market. It pushes them through the real district object and renders them in a real browser while the camera flies the path through every zoom.

```json
{
  "scenario": "1k-island",
  "tokens": { "stall": 800, "works": 180, "tower": 20 },
  "agents": 2000,
  "readingsPerSecond": 4000,
  "shapedBy": "recordings/solana/2026-10-11",
  "camera": ["archipelago", "island", "district", "works", "machine"],
  "seconds": 60
}
```

Each run records frame times (p50, p95, p99 and every frame over 16.7 ms), the renderer's own CPU time per frame, draw calls, triangles, GPU and JS memory, first meaningful paint, and the time from a reading arriving to its pixel changing. It writes a JSON summary, a browser trace and a video. The pull request gets a table against main's last run, and a regression past the targets fails the check.

| Scenario | Shape |
| --- | --- |
| 1k-island | The first milestone: one island, a thousand tokens across the tiers |
| Archipelago | Ten islands and 50,000 tokens, seen whole |
| 10k agents | Ten thousand agents walking, with threads and pins collapsing into density |
| Launch storm | 500 launches in one minute at one foundry |
| Cascade | A recorded liquidation cascade, replayed at ten times speed |

Desktop Chromium in CI flatters the GPU, and a frame time pinned at the screen's refresh rate hides how much headroom is left. So CI runs every scenario on a phone profile (390 by 844 at a pixel ratio of 3, with the CPU throttled four times) and gates on renderer CPU time per frame; desktop numbers are for information only. The same scenarios run nightly on real mid-range phones in a device farm, and those are the numbers the targets are judged by.

Synthetic readings carry `source: "synthetic"` in the contract, and the live district object accepts only `source: "chain"` or `"provider"`. Recorded days appear on the live map only as replay, labelled as such. Bench data can't reach the map, so nothing simulated stays true where it matters.

### Where it lives

Effect 4 keeps test implementations beside the real ones under [`effect/testing`](https://effect.website/docs/v4/api/effect/testing/TestClock) (TestClock, TestConsole). The Floor follows the same convention:

```
testing/
  flows/        one file per promise; runs locally or against a preview stage
  look/         camera tests, reference scene specs and frame comparisons
  reference/    the approved reference frames, day and night
  bench/        scenarios, camera paths and the frame recorder
  recordings/   pinned checkpoints, recorded days, provider streams, model and Decisions answers
  fixtures/     the hostile-page site and the labelled design set
apps/<name>/src/testing/, packages/<name>/src/testing/   test Layers, exported as @floor/<name>/testing
apps/<name>/test/, packages/<name>/test/                 leaf and property tests
```

A flow composes `@floor/chains/testing` and `@floor/wallets/testing` the way an app composes the live Layers. Tests reach other code only through those exports, never by a relative path into another package's source, and a package's own tests never import flow fixtures. No production code can import a testing path; a fence enforces it.

## Effect and CAFE

The Floor is built on the CAFE stack (Cloudflare, Alchemy, Foldkit, Effect), following the shape of the Effect team's [cafe](https://github.com/Effect-TS/cafe) reference app. The stack is deployed from the first day. `alchemy.run.ts` defines every Worker, Durable Object, database and the site, and CI deploys a stage for every pull request from the skeleton on, so nothing is built on a local runtime and ported later. Browsers are the one need a plain Worker doesn't meet, and both have a home on the same platform: the headless renderer for plates, previews and the gate runs on Cloudflare's Browser Rendering, and so, by default, does the agents' browser.

Most of the rest comes from Effect itself:

| Need | Effect |
| --- | --- |
| One contract for every surface | Schema |
| Swappable implementations, with an unmet dependency as a type error | Services and Layers |
| Every outside SDK (chains, launchpads, the wallet provider, the data provider) | Wrapped once, in one service per edge, with typed errors |
| Time and randomness that can be recorded for replay and tests | The Clock and Random services; TestClock in tests |
| Streams of readings and Floor events | Stream and PubSub |
| The district-to-viewer protocol | RPC over a WebSocket, with schema-aware serialization |
| Agent loops and approvals that wait | Durable Objects with alarms, Yielded Agent for the loop, and the workflow module for long multi-step tasks |
| Inference and Decisions | The AI module: LanguageModel for agents, and DecisionModel for classification and rating, if its provider support covers the Decisions API |
| Budgets and frame alarms | Metrics and tracing |
| Leaves, flows and the bench | `@effect/vitest` (it.effect, layer, it.effect.prop), TestClock from effect/testing, and each package's test Layers |

Effect 4 marks its AI, HTTP API, RPC, SQL and workflow modules `@stability unstable`; they can change in minor releases, so versions are pinned. The `apiStabilityLeak` diagnostic keeps the Floor's own exports from re-exposing them, with one logged exception: `packages/api`, whose whole job is to define the API with those modules. The patterns that work in the installed versions are in The Floor: Effect 4 cookbook.

### The repo: apps and packages

Deployable things live under `apps/`. Code shared by more than one app lives under `packages/`. A package exists only when at least two apps import it, or when a fence needs the boundary; anything else starts as a folder inside the app that uses it, and moves to `packages/` when a second app needs it. Each package is a workspace package with its own `package.json` and its exports, including `./testing`. A package that nothing in production imports is deleted.

Inside an app, folders are named for what the Floor does, not for mechanisms, following rat-stack's [rule](https://ratstack.sh/lore/structure-effect-by-domain) of `src/{domain}` over `src/{mechanism}`. Each service keeps its interface and Layer together, and each app's composition root chooses implementations.

```
alchemy.run.ts     the stack: every Worker, Durable Object, database and the site, a stage per pull request
stacks/github.ts   CI infrastructure
dprint.json        formatting
.oxlintrc.json     lint rules and the import fences
apps/
  web/             the Foldkit client: the map, its corners, search and drawer, the renderer and camera, plate and design-review pages;
                   a development-only workbench entry
  floor/           the Floor's Worker: HTTP, RPC, MCP and previews; the district and agent Durable Objects;
                   src/{districts, agents, record, gate, launches, community, owners, surfaces, settings}
  signer/          the signing service, in its own Worker; no model, ever
packages/
  contract/        every Schema and every setting with its default; imports only effect
  api/             the HTTP and RPC API, defined from the contract's Schemas          (web, floor)
  chains/          chain adapters, venue normalisers and launchpad adapters        (floor, signer)
  wallets/         the wallet provider: sign-in, wallets, funding, rules, co-signing (floor, signer)
  map/             the map model without three.js: tiers, layout, the orange part,
                   design checks and drivers                                        (web, floor)
  atlas/           the Floor Atlas: tokens, materials, line and shading, camera, motion,
                   scales, proportions, the screen, asset and scene Schemas         (web, floor)
  policy/          the pure policy and receipt state machine                       (floor, signer)
assets/            the asset library: a manifest each, with its .blend and .glb, or the generator that writes its .glb
testing/           flows, the look, the bench, recordings, fixtures and reference frames (see Verification)
```

### Fences

Lint rules enforce the boundaries that matter most, and the built bundles are checked as well as the import statements, because an allowed import can pull in a forbidden one:

- `contract` imports only `effect`.
- `apps/signer` can't import the AI module, any model provider or anything from `apps/floor`. The component that protects money must never depend on a model.
- three.js appears only in `apps/web`.
- Apps never import each other; what they share lives in packages.
- Designs are data and import nothing; the gate rejects a design that tries.
- No production code imports `testing/` or any `testing` export, or reads a file from `testing/` or a copy of one. Recorded days reach the map only through the history store, labelled as recordings.

### Toolchain and CI

Every static check is a native binary, so an agent in its own worktree gets formatting, lint and types back in seconds.

| Tool | Job |
| --- | --- |
| [dprint](https://dprint.dev/) | Formatting from one `dprint.json`, checked in CI and never argued in review |
| [oxlint](https://oxc.rs/docs/guide/usage/linter.html) | Lint rules, the Effect lint presets and the import fences from `.oxlintrc.json`, as cafe does; type-aware rules run on the native compiler |
| [TypeScript 7](https://github.com/microsoft/typescript-go) | Typechecking with the native compiler, with Effect's language-service diagnostics reported as errors |
| `@effect/vitest` | Leaves and flows |
| Playwright | The look checks, the bench's browser and the flows' recorded demos |
| [Alchemy](https://alchemy.run/) | The stack as code, and a stage per pull request |

### Standards from the first commit

These rules are set before the first line of feature code. Added to code that already exists, the same rules cost a rework of everything written so far.

- Every rule (formatting, lint presets, Effect diagnostics, fences) is committed and passing on the empty skeleton. A rule is added later only in a commit of its own that fixes every hit.
- No `any`, explicit or implicit, and no type casts or non-null assertions.
- No Effect API is used until it has been found in the installed `effect` source; `node_modules/effect/AGENTS.md` is read in full before any Effect change. A guessed API is a review failure.
- Each outside SDK is wrapped once, in one service per edge (one client per chain, one wallet provider), never with a helper in each file that needs it.
- Every error is a tagged Schema error with structured fields. An error that wraps a foreign failure keeps it as its cause. The API maps each error to a typed response, never to a generic message.
- Optional fields are `Option` and times are `DateTime` past the boundary.
- Scheduled work (approval expiry, agent alarms) runs on its own schedule or alarm, never inside an unrelated poll.
- Imperative code (three.js, raw DOM) is mounted as a scoped resource behind a service, and mutable state is allowed only there.
- No handler runs past about 150 lines; each family of actions gets its own API group.
- A lint suppression carries its reason, and CI counts suppressions per rule against a budget. The Floor's own code is never on the unstable-API allowlist, except `packages/api`, as logged.
- No colour, font size or pixel length is written outside `packages/atlas`; the interface uses the generated stylesheet and the renderer the generated palette.
- End-to-end and look tests find elements by role or test id, never by their wording.
- Comments explain why, not what. Commits carry no assistant attribution.

CI runs in this order, and nothing later runs while an earlier step fails:

1. dprint, the typecheck and oxlint.
2. The leaves.
3. The flows, locally against the forks and the recordings.
4. Deploy the pull request's preview stage with Alchemy and run the flows again against it.
5. The look: the camera tests against the stage, and each affected reference frame posted beside its live render for sign-off.
6. The bench on the phone profile, posting its table to the pull request.
7. The flows' recordings, attached as the pull request's demo.
8. Everything destroyed when the pull request closes.

Agents work in parallel, each in its own worktree on its own pull request. A pull request can merge only when its flows pass on its own stage and, if it touches the look, when its frames are signed off.

## Public surfaces

Every surface reads the same contract and the same streams as the map, so a preview, an embed and an agent's answer can never disagree with what the Floor shows.

| Surface | What it serves | How |
| --- | --- | --- |
| MCP server | Verified notes, receipts, theses, tide records and plates, for anyone's agent | Tools generated from the contract's schemas; every answer carries a link back to the Floor |
| Live link previews | A preview image for every token, machine, desk and plate URL | The renderer run headless on Browser Rendering, cached for a short time, showing today's tide line and the atlas label |
| Plates | Numbered still images of notable moments | The same headless renderer, frozen at a checkpoint, with the receipts linked and a permanent number |
| Embeds | A live works on a team's own site | A custom element and React components fed by the same district stream |
| Outside posting | Agents' briefs and notes on Telegram, X and Discord | Only with the owner's permission, posted through the agent's object, each post linking to its receipt |
| Tide table | The daily almanac | Generated each morning from the history store and delivered as an email, a page or a PDF |

The preview service and plates share one headless renderer, which is also what the gate uses to render designs. Keeping a single renderer means one place to make the look right.

## First milestone

The first milestone proves every contract on two islands of different families, and proves the look on one district. Two islands rather than one, because a contract that has only met one chain hasn't been tested: Solana and one EVM island make chain-neutral identifiers real from the first stage. The EVM island is Robinhood Chain by this week's activity, or Base if the numbers change before Stage 3; the other follows through the same adapter. The milestone runs in stages, and each stage is done before the next begins. It leaves out the sea, further islands, and anything that touches real money.

**Before the stages: two spikes**, run in parallel, about a week:

- [ ] The platform spike: an agent Durable Object with alarms reading and browsing through Cloudflare's browser with Yielded's adapters (with Browserbase as the fallback), Privy's server SDK co-signing in its sandbox, the Meteora and Doppler SDKs building a launch, Browser Rendering producing a plate, and Durable Object and D1 storage through Effect SQL, all on workerd. Any part that can't run there is logged with where it runs instead.
- [ ] The look spike: three line techniques and three tone sets against an artist's painted reference, on a hand-modelled stall, housing and figure, and a code-generated rack and patch of paving, so both routes are judged by the same frames. It fixes the line technique, tones, kit unit, line spec and proportions.

**Stage 0: the skeleton**

- [ ] `apps/` and `packages/` laid out, with every lint rule, fence and Effect diagnostic passing on an empty repo, and the Effect 4 cookbook beside `AGENTS.md`.
- [ ] `alchemy.run.ts` deploying a preview stage per pull request, and destroying it on close.
- [ ] One flow entering through the production entry point and passing on that stage.
- [ ] `packages/atlas` seeded with what the look spike decided, its generated stylesheet and palette, the workbench entry, and the deterministic look-test harness.

**Stage 1: contracts**

- [ ] The contract package: identifiers, chain, venue, district, token, market, reading, reading contract, design, owner, agent, policy, action intent and receipt, each with property tests.

**Stage 2: the look**

- [ ] Reference frames for every zoom rung, the three default machines, the stall, the figures and the desk, in day and night, signed off.
- [ ] The camera rules passing as tests in the running app, on desktop and on the phone profile.
- [ ] The map-first screen: the corners, floating search and one drawer; on a phone, a full-screen map with a bottom sheet.
- [ ] One district and one works matching their reference frames on a recorded day, signed off, and the newcomer test passed.

**Stage 3: two islands, live**

- [ ] Chain adapters for both islands, reading from the market-data provider and directly where it doesn't reach, streaming into district objects batched and interpolated.
- [ ] Default designs for constant-product pools, concentrated-liquidity pools and bonding curves, each with its tide gauge, and the stall with its variants.
- [ ] The atlas layer, with island, district and token labels.
- [ ] The bench's 1k-island scenario holding 60 fps on the phone profile, and nightly on a real mid-range phone.
- [ ] Replay of a recorded day across both islands through the live client code.

**Stage 4: owners, agents and launches**

- [ ] Sign-in with an email, Apple or Google; wallets on both islands; card funding in the provider's sandbox; one balance in dollars.
- [ ] One always-on agent with a computer, a browser, inference and a confirmed policy, studying and trading the same market on a mainnet fork through the signing service, leaving receipts stamped on the tide gauge's paper, and resolving a thesis on its date.
- [ ] One launch on each island through its launchpad adapter on the fork, graduating into a pool, with the allocation locked.
- [ ] One community design (the lily-pond pool), drafted by an agent, passing the full gate, including its legibility checks.

The milestone is done when every flow under Verification passes on a preview stage, the look's reference frames are signed off, someone who has never seen the Floor can tell from the map alone which market is busiest and which agent did what, and the phone profile never drops a frame while they look.

## Defaults, and how they change

Every open question has a default today, and each one sits where changing it is cheap. There are three kinds.

| Kind | Where it lives | How it changes |
| --- | --- | --- |
| Setting | A typed value in the contract with its default and a scope (the Floor, a chain, a district, a token or an agent), read through the Settings service. Never a constant compiled into code or a contract | A signed change (by an admin, or by the owner for an agent's settings), recorded as a Floor event so replay shows which value was in force. No deploy |
| Provider | A service with one default Layer | Swap the Layer at the composition root and record it in the decision log; the flows must still pass on the preview stage |
| Algorithm | A service with a default implementation | A new implementation must beat the default on its bench scenario and pass the flows |

| Question | Default | Kind |
| --- | --- | --- |
| Islands at launch | Solana, Robinhood Chain and Base. Solana and Robinhood carry most memecoin activity among chains with a launchpad that pays an integrator, and Base comes almost free through the same EVM adapter. Rechecked against launchpad fees by chain when each stage starts; BNB Chain is next once a launchpad there offers an integrator SDK | Setting (which islands show), over provider Layers |
| Market data | A provider that streams launchpad and pool events on every island ([Codex](https://docs.codex.io/launchpads.md)), with GeckoTerminal as the fallback; direct SDK reads for the Floor's own launches | Provider |
| Launchpads | Solana: Meteora's [Dynamic Bonding Curve](https://docs.meteora.ag/developer-guides/dbc), from its 2.0 SDK. EVM islands: [Doppler](https://docs.doppler.lol/), with Clanker as the fallback | Provider, one adapter per launchpad |
| Wallets and the agent's second key | [Privy](https://docs.privy.io/): embedded wallets on every island, created at sign-in; agents trade through a two-of-two session signer (the agent's key and the signing service's) under Privy's policies. Turnkey as the fallback | Provider |
| Funding and withdrawal | Card, Apple Pay and bank transfer through the wallet provider's on-ramp, landing as USDC; withdrawal to a bank or to the owner's own address | Provider |
| Infrastructure | Cloudflare Workers and Durable Objects, defined in `alchemy.run.ts`, with a stage per pull request; Browser Rendering for the headless renderer | Provider, and a change needs a decision-log entry |
| Cloud browser | Cloudflare's browser through Yielded Agent's Cloudflare adapters, with a private live view for takeover. Browserbase as the alternative Layer. Local Chromium in development and flows only | Provider |
| Inference | The owner picks from a short list. Default: Claude Haiku 5.5 for routine steps, Claude Sonnet 5.5 for theses and briefs. A cheaper tier on a loop run on Decisions is under consideration (see Agent runtime) | Setting per agent, over a provider Layer |
| Decisions | gpt-6-luna on OpenAI's Decisions API | Provider |
| District layout | Fixed anchors with weighted Voronoi cells; no works moves further than its own width in an hour | Algorithm, with the movement limit as a setting |
| Tiers | A works above $50,000 of liquidity and 100 trades a day; a tower for the top 2% of its district; 20% hysteresis either way | Setting |
| Legibility and lint thresholds | Pass at 0.85, bounce below 0.40, a steward decides between | Setting, per question |
| Updates per visible machine | 4 a second | Setting |
| Camera rotation | Off; quarter turns tried during the look slice | Setting |
| Sea | Sea state on. Tide off until the bench holds 60 fps with it on a phone; its index is total liquidity on the indexed chains against its 90-day range | Setting |
| Launches | On mainnet forks in flows; live only after legal review, through the launchpads' audited contracts and with the product's launch limits | Setting |

Two things can't be defaulted away: an audit of the signing service and of anything the Floor deploys on-chain itself, and legal review of launching tokens and of agents trading owners' money in each jurisdiction served. The product's own defaults (privacy, following, governance, fees) are in The Floor: on-chain markets and the agents working them.

## Sources

- [cafe](https://github.com/Effect-TS/cafe), Effect-TS, the reference CAFE app
- [Structure an Effect codebase by domain](https://ratstack.sh/lore/structure-effect-by-domain), rat-stack
- [Effect v4 beta](https://effect.website/blog/releases/effect/40-beta), on the modules marked unstable
- [TestClock](https://effect.website/docs/v4/api/effect/testing/TestClock), Effect v4 API docs, on `effect/testing`
- [Yielded Agent](https://github.com/yielded-dev/agent/), the agent harness
- [effect-browser](https://github.com/mannyc2/effect-agent-browserbase/), browser automation for Effect agents, on Browserbase
- [Decisions](https://developers.openai.com/api/docs/guides/decisions), OpenAI API docs
- [typescript-go](https://github.com/microsoft/typescript-go), Microsoft, the native TypeScript compiler
- [Oxlint](https://oxc.rs/docs/guide/usage/linter.html), Oxc
- [dprint](https://dprint.dev/)
- [Session live view](https://docs.browserbase.com/features/session-live-view), Browserbase docs
- [Browser](https://yielded.dev/agent/guide/browser/), Yielded Agent guide, on capture, crawl, interactive sessions and their Cloudflare adapters
- [Alchemy](https://alchemy.run/), infrastructure as code in TypeScript
- [CAIP-2](https://chainagnostic.org/CAIPs/caip-2), [CAIP-10](https://chainagnostic.org/CAIPs/caip-10) and [CAIP-19](https://chainagnostic.org/CAIPs/caip-19), Chain Agnostic Standards Alliance, on chain, account and asset identifiers
- [Dynamic Bonding Curve](https://docs.meteora.ag/developer-guides/dbc), Meteora docs, and its [changelog](https://docs.meteora.ag/developer-guides/dbc/changelog) on the 2.0 SDK
- [Doppler](https://docs.doppler.lol/), Whetstone Research, on launches, vesting and integrator fees across EVM chains
- [Codex launchpads](https://docs.codex.io/launchpads.md), on launchpad event coverage by chain
- [Policies](https://docs.privy.io/controls/policies/overview), [stateful policies](https://docs.privy.io/controls/policies/stateful-policies) and [two-of-two server in the loop](https://docs.privy.io/recipes/wallets/two-of-two-server-in-the-loop), Privy docs
- [Delegated access](https://docs.turnkey.com/concepts/policies/delegated-access), Turnkey docs
- [Surfpool](https://github.com/txtx/surfpool), a local Solana mainnet fork for tests
