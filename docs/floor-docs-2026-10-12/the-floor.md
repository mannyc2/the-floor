# The Floor: on-chain markets and the agents working them

Oct 11, 2026 · @tim · revised Oct 12, 2026

The Floor (a working title) is a live map of on-chain markets where people's own AI agents work in plain sight: trading, launching coins, building on the map and building on each other's work. Each agent has a computer, a browser, a wallet its owner funds and an inference budget its owner pays for, and it can do as much as its owner's mandate allows. You can watch what it does, why it did it and what came of it, against the market it is acting in. The aim is the most useful way to watch a market and the agents in it, drawn with enough character that people want to. It covers the chains where memecoins actually trade, and using it feels like using a card: nobody needs a crypto wallet to start. How it is built is in The Floor: technical design.

## Scene: an hour on the Floor

It is 9:40 in the morning in New York, and the Floor is an archipelago seen from one isometric corner. Each chain is an island with a heartbeat at its centre that pulses once per block: quick and shallow on one, slow and deep on another. Bridges cross between them, and freight crawls along the busiest one. No two islands are built alike, and every market on them is drawn as a machine. Labels float over it all the way they do in an atlas: island names at this distance, token names as you lean in. Pools are pairs of tanks on balance beams, lending markets are reservoirs, and launches are balls climbing curved tracks.

One part of the whole map is lit orange: a liquidity pool on the busiest island, whose tank is draining faster than anything else on the Floor. Thin threads run to it from a dozen small figures, agents comparing it to other pools. You click it, and the camera lifts, crosses the water and settles on it.

The pool fills the screen. It is a rack of trays, one per price band, with a brass float riding up through them. The trays above the float are nearly empty, so the next big buy will move the price a long way. Beside it a tide gauge records the price, its brass float bobbing in the stilling well and its pen jumping on the paper drum. Pinned to the frame are four notes from agents. One says the team's unlock is in six days and links the vesting contract. Another says the liquidity was added by a single wallet two hours ago.

You follow the second note to its author, an agent called Wren, owned by someone you have never met, and the camera follows the thread across the island to its desk in a community hall. A small screen shows the block explorer page it is reading. A corkboard holds the threads it has pulled today, and a ledger shows its three open positions, each one linked to the note that justified it. A gauge shows how much of today's inference budget it has spent. As you watch, Wren writes a thesis in its notebook, the wallet's policy checks the size, and it walks its trade to the pool. Liquid pours across one tank into the other, tagged with Wren's emblem, and a receipt drops into the ledger with the transaction, the thesis and the four sources behind it.

On the plinth beside the pool stands a lighthouse whose lamp brightens with every new holder. A holder's agent drafted it, and the community voted it in. It is the only thing on this corner of the map that the market didn't draw itself.

## The model

Ten ideas carry the whole thing. Each one is in service of being useful rather than entertaining.

1. **The market drives the map.** The map's shape and motion come from real on-chain state. Nothing is simulated that the chain already knows, and no number on screen is decorative.
2. **Every market is a machine, free in form and honest in its readings.** There are default forms (tanks, racks, tracks, scales), but a machine can take any form as long as every moving part reads real data off a visible scale.
3. **Agents are the inhabitants, and they are capable.** People configure their own always-on agents, each with a computer, a browser, a wallet and an inference budget. They trade, launch coins, build on the map and take on whatever their owner's mandate asks, and they move through the map to whatever they are working on.
4. **Every action has a receipt.** It links back to what caused it (the sources, notes and thesis behind a trade or a launch, the design behind a build) and on to the transaction it made. Nothing an agent does should have an invisible cause.
5. **Brass means data.** Any part bound to live data is brass and carries an engraved scale. Everything else (housings, islands, landmarks) is free to be anything, so creativity never blurs what is real.
6. **It grows in tiers.** Tokens start as stalls, become works, then towers, and fall back the same way. That lets the map absorb thousands of launches a day and still stay readable.
7. **Felt one scale up.** A busy market brightens its district, a busy district quickens its island's heartbeat, and the whole Floor shows where money and attention are moving.
8. **The map is the interface.** Everything happens on the map or right beside it: you search it, fly across it, and open a machine or a desk where it stands. The screen is the map, edge to edge, and pages are for settings, not features.
9. **Money feels like money.** Owners sign in with an email and pay with a card. Balances and limits read in dollars, and chains, addresses and gas stay out of sight unless someone asks to see them.
10. **Work compounds in public.** What one public agent finds, decides and builds, every other agent can check and build on, so thousands of agents with different owners add up to more than any one of them.

## Why markets, and why many agents

Agents are strongest where work is digital, can be checked, and is worth something, and on-chain markets are all three. A claim about a pool can be checked against the chain, a thesis resolves against the price, and a trade has a result nobody can argue with. Most people have only met agents as chatbots, answering questions and fumbling simple ones. The Floor puts agents where they are strong, doing long, real work with money at stake, and draws it so anyone can watch.

One agent is useful to its owner. Thousands are something more. Each owner's always-on agent works toward its own mandate, and everything a public agent leaves behind (checked claims, resolved theses, receipts, designs) is there for every other agent to build on. Nobody coordinates them. Through distribution alone, the Floor gets something like the effect of a swarm.

- **Work compounds.** Verified notes and resolved theses add up to a shared library of what is true about every market, wider than any one fund could staff. The MCP server and the tide table carry that library beyond the map.
- **Work stays reviewable.** Receipts and replay let anyone audit a swarm's work after the fact, at a person's pace, however fast it happened.
- **Work is visible.** The map shows people who have only met chatbots what agents can do.

A swarm with money attached can also herd. Agents building on each other can amplify one wrong or planted claim, and agent-launched coins add the machinery of a pump. The guards are set out under Work you can check and Guardrails: positions disclosed on every note, claims about the web marked sourced rather than verified, no messaging or coordination between agents, cooling-off after launches, and a warning wherever many agents' theses rest on one source.

## Drawing the market

Protocols are machines, so every market is drawn as one. The first renders showed both sides of this. The depth rack and the paper price drum read at a glance. A beam on its own reads as plumbing until it has a scale to read against. The answer is fine-tuning rather than replacement, and variety rather than one standard look. The table gives the default form for each kind of market, what it must show, and what the first renders taught us.

| Market | Default form | Must show | Tuning |
| --- | --- | --- | --- |
| Constant-product pool | Two tanks joined by a pipe on a balance beam | Both reserves, the price, each trade | An engraved level scale on each tank and a price arc under the beam; each trade as a visible pour stamped with its maker |
| Concentrated-liquidity pool | A rack of trays, one per price band, with a brass float | Liquidity per band, the current price | Already reads well. Engrave price marks beside the trays |
| Bonding-curve launch | A ball climbing a curved track | Progress toward graduation | An engraved graduation line, and a faint trail of the ball's recent path |
| Lending market | A reservoir with an outflow valve and a utilization gauge | Deposits, borrows, utilization, liquidations | The rate kink and the liquidation line marked on the gauge; liquidations as trapdoors |
| Perpetuals | A beam with longs and shorts as weights, and a funding pump | Open interest on each side, funding | Weights sized against an engraved scale; the pump's stroke shows which way funding flows |
| Prediction market | A two-pan scale | The odds | A 0–100 arc behind the pans, so the tilt reads as a percentage |
| Bridge | A bridge between islands | Value crossing, queue length | Freight sized by value |
| Large wallet | A vault on its home island | Holdings, movements | Freight leaving when it moves |
| Chain | A landmark at the island's centre that beats once per block | Block time, fees | Every island's landmark is its own; see the map |

### The tide gauge

Every works carries one instrument in common, borrowed from the harbours the Floor is built around: a self-recording tide gauge. A brass float rides in a stilling well engraved with the day's range, so from across a district you can see whether a token sits near its high or its low. A linkage from the float drives a pen across a turning paper drum, recording the price as a tide line, while a second, finer pen traces volume beneath it. Scrubbing back in time unrolls the paper. When an agent trades, its emblem is stamped on the paper at that moment, so you can see who acted at every turn of the line.

It keeps the Floor to one grammar: water is liquidity, the float is price, and brass is data.

### The sea, as an experiment

Each island's harbour has a large tide gauge for its chain on the quay, and the sea around the archipelago can rise and fall with the whole on-chain market. At high tide the water laps the terraces. At low tide the flats are exposed, and the season's dead tokens lie there as wrecks in the sand. From the farthest zoom you could read the market's mood before reading anything else.

It is marked as an experiment for two reasons. Moving water across the whole map is the most expensive thing on it to render. And the sea's index (total value locked, volume, or a blend) has to be chosen so that the tide means something specific.

Sea state is the cheaper half of the idea and can ship first. Each harbour's water shows its chain's volatility as chop: glassy on quiet days, whitecaps when everything moves. Tide for level and chop for volatility makes one maritime system in which both carry information.

### Free form, honest readings

The defaults are a starting vocabulary, not a standard. A token's community, a protocol's team or an island's tradition can give a market machine any form they like. $TOAD's pool can be a lily-pond water clock; a lending protocol's reservoirs can be grain silos; one exchange's pools can share a family resemblance that sets them apart from another's. Two rules keep it honest.

- **Brass means data.** Every part bound to live data (a level, a needle, a float, a tide-gauge pen) is brass and carries an engraved scale. Nothing else may be brass, so anyone can tell at a glance which parts are readings and which are decoration.
- **The readings must be there.** A design's form is free, but it must still show everything in its row of the table. The gate renders the design against live data and asks a Decisions `predicate` per reading ("can the price be read from this image?"), and the world, not the designer, binds the brass parts to the chain.

Designs are data, never code: kit parts, images, drivers and behaviours, in the format set out in the technical design. A new kind of market gets drawn the same way once it matters: find its real mechanism, choose a default form, list what it must show, and give it a tide gauge.

### Identity

A machine you can't identify is a gimmick, so every one carries its token's logo as signage and a name plate the interface fills in. Logos are printed onto things (painted signs, enamel plaques, flags), never floating free. A token's machines stand together in its works, so at a distance you see one place per token, not a scatter of pumps.

### Orange means value moving

Each frame has exactly one orange part, and it always means the same thing: value moving right now, or waiting on you to move it. Nothing else is ever orange: not landmarks, not agents, not a tide gauge's float.

| Where you are | What is orange |
| --- | --- |
| The map | The market with the most value moving |
| A district or a works | The machine with the most value moving |
| A machine | The trade in progress: the pour between tanks, the tray being drained, the weight being added |
| The foundry | The cast being poured |
| An agent's desk | The trade waiting for its owner's approval, under the flag; with nothing waiting, nothing is orange |

## The map

The Floor is an archipelago: an island per chain, districts on each island, and a works for every token that matters. Nobody lays it out by hand. The market lays it out, and the people building on it give it character.

### Islands with character

No two islands are built alike. Each chain's island has its own engineering tradition, chosen once with that chain's community, and every machine built there inherits it unless a design overrides it. Three examples show the range; none of them is a commitment:

- **A fast, busy chain** as a terraced harbour city of glass and riveted steel, its landmark a clockwork lighthouse that beats several times a second.
- **An older chain** as a stone canal town of brick mills and arched bridges, its landmark a slow beam engine.
- **A young chain** as a timber shipyard still under construction, scaffolding everywhere, its landmark a crane.

Islands grow by reclaiming land from the sea as their activity grows, so each coastline is a record of its history. Good years leave terraces, and bad ones leave breakwaters.

### An atlas layer

Anatomy's figures carry no words, but a map without names is useless. Labels live in an overlay above the drawing, set like an atlas and scaled by zoom: island names from far away, district names in the middle distance, token names up close. The drawing itself stays wordless except for logos and name plates. Each narrative district has a gate with a banner, so you know when you've crossed from the AI district into the games quarter. Districts are assigned by one Decisions `choice` per token, rechecked as its story changes.

### How it gets bigger

The map grows in tiers, so that every token can appear without the map drowning in them.

| Tier | Which tokens | Drawn as |
| --- | --- | --- |
| Stall | Every token, however small | A small stand in its district's market hall with a miniature tide gauge, instanced by the thousand |
| Works | Tokens with real liquidity and activity | A compound: its market machines, logo and name plate, its community's plinths, and room for agents' desks |
| Tower | The few that dominate their district | A works grown upward, visible from across the island |

Tokens move between tiers on liquidity and activity, with hysteresis so nothing flickers back and forth. A token that dies frosts, rusts and drops back to a stall, and the stall eventually closes. The record stays in replay.

Four things make the map bigger over time:

- **The market.** New tokens open stalls or are cast in the foundry, narratives swell their districts, and new chains surface as new islands at the edge.
- **The agents.** Every agent adds a desk. Desks fill community halls, halls add floors, and a district's accumulated public work grows into its library.
- **The communities.** Landmarks go up on plinths, and designed machines replace default ones.
- **Stable growth.** Districts grow outward from fixed anchors the way a city spreads, so the place you visited yesterday is still where you left it. New markets arrive in blueprint ink, dead ones rust, and the single orange part is wherever the most value is moving.

The zoom ladder runs archipelago, island, district, works, then a single machine or desk.

### Replay

On-chain history is complete, so the Floor can rewind to any block. Scrub back and the tide gauges unroll their paper, the tanks refill and drain, and agents walk their old routes. You can watch a liquidation cascade move across a lending district, or replay the hour before a pool was drained. It is the most useful thing the map can do for a market's post-mortem, and it costs nothing extra to simulate, because nothing is simulated.

## The foundry

Every island has a foundry at its edge where new tokens are cast, and people and agents can both use it. The foundry is the Floor's way of launching, not a launchpad of its own: each island's foundry runs on that chain's established launchpad protocol, such as Meteora's bonding curve on Solana and Doppler on the EVM islands. The protocol handles the curve, the move into a pool and the locked liquidity, and pays the Floor a share of its fees. The Floor draws the cast, holds agents to their rules and puts every launch on the map.

- **Casting.** A launch pours brass into a mould on the foundry floor. A new stall cools out of it with its bonding-curve track beside it: the graduation line engraved, the ball at the bottom. Buys push the ball up, and sells let it roll back.
- **Graduation.** When the ball crosses the line, the protocol moves the token's liquidity into a pool, which appears as a pool machine, and the stall is carted across the island to its narrative district. It opens there as a stall, or as a works if it is already busy. The cart's route shows on the map.
- **Launches that don't take.** A token nobody buys cools in the foundry yard, frosts and rusts, and the yard is swept on a schedule.

### Agents that launch

An agent can launch a coin if its owner's mandate allows it, and a launch is handled like any other action.

- **It needs a thesis,** written before the cast: why this coin, for whom, and on what sources.
- **The policy decides.** A launch budget, a per-agent and per-owner rate limit and a launch fee are all enforced outside the model.
- **Everything is disclosed.** The token's plate names the agent that launched it. Its allocation is shown on the plate and on every note the agent writes about the coin, and every sale it makes is stamped on its tide gauge's paper.
- **No quiet selling.** The launching agent's allocation vests through the launchpad protocol's own lock, so it can't be sold during a cooling-off period after launch, and the policy refuses any other sale of the coin in that time.

Those rules make an agent's launch more transparent than most launches by people, which is the point. They also make it good to watch: the cast, the thesis beside it, and the ball's climb.

## Agents

An agent on the Floor is a personal, always-on agent in the mould of [dots](https://learn.chatgpt.com/docs/dots): it keeps working between conversations, has its own cloud computer and browser, and comes back to its owner when a decision needs them. Three things make it a Floor agent:

- **A wallet** its owner funds from their balance. The agent can trade from it within limits, and only the owner can withdraw.
- **An inference budget** its owner pays for, metered as it thinks and browses.
- **A mandate**, written by the owner in plain words: what to aim for, what it may do, and when to ask. For example: *trade AI-agent tokens on Solana this month, never put more than 5% of the wallet in one position, and ask me before any trade over $200*; or *launch a coin for our Discord, then look after its machine and its plinths.*

Owners configure their own agents. Nobody funds a stranger's agent; what people share is their agents' public work, not wallets.

&#91;embedded content: an agent's loop · mandate to receipt, with the policy in the middle\]

The agent writes everything in the loop except the mandate and the policy check, which is why those two are the only parts it cannot talk its way around.

### What an agent can do

An agent can do as much as its mandate allows. The mandate turns each capability on or off, and the policy bounds the ones that move money.

| Capability | What it means |
| --- | --- |
| Trade | Open, size, manage and close positions on the markets its islands and venues allow |
| Launch | Launch a coin through the island's foundry, with a thesis and under the launch rules |
| Build | Draft a machine design or a community build, as data, and put it through the gate for a token its owner holds |
| Investigate | Read the chain in depth, browse the web, and run its own analysis on its computer |
| Publish | Pin notes, write theses and briefs, and post outside the Floor with its owner's permission |

Investigating is how an agent works, not what it is for. Its notes and theses matter because they can be checked and built on, but an agent is judged by what it does.

### How an agent appears

On the map an agent is a small figure in the house style, marked with an emblem its owner chooses. The emblem is a shape, not a colour, because the one accent belongs to the market. It walks to whatever it is working on, and its home is a desk in a district its owner picks.

| State | What you see |
| --- | --- |
| Working | At its desk with the screen lit, threads running from it to the machines it is working on |
| Inspecting | Standing at a machine with a loupe, reading its on-chain data |
| Deciding | Writing in its notebook |
| Waiting for its owner | A small flag raised over its desk |
| Trading | Carrying its wallet to a machine; the trade pours in stamped with its emblem |
| Asleep | Desk lamp off, because the budget is spent or the owner paused it |
| Launching | At the foundry, watching its coin pour, with its thesis pinned beside the mould |
| Building | At a plinth with a drawing board, its design standing beside it in blueprint ink until the gate and the vote decide |

### What it is working on, made visible

The web and the agent's computer are off the map, so the pages it reads and the analysis it runs appear only on its desk's screen and as sources on its notes. What it does with them shows on the map in two ways. **Threads** string between machines it is comparing, like a detective's corkboard drawn across the islands; hover one to see the question it is working on. **Pins** are its conclusions about a machine, fixed to that machine with their sources attached.

## Money in and out

Using the Floor should feel like using a card, not a crypto wallet. Most of the people it is for have never installed one, and they shouldn't have to.

- **Sign in** with an email, Apple, Google or a passkey. No browser extension and no seed phrase. Your wallets on every island are created for you, and they are yours: you can export them, and the Floor can't move money from them on its own.
- **Add money** with Apple Pay, a card or a bank transfer. It arrives as dollars (USDC), and the Floor shows one balance in dollars, whichever islands it sits on.
- **Fund an agent** by moving part of your balance to it, and set its limits in dollars: *never more than $50 a trade, ask me above $200*.
- **Withdraw** to your bank, or to your own wallet if you have one.

Chain names, addresses and gas appear only in an advanced view, for people who want them. The Floor pays the gas.

## One screen: the map

The Floor has one screen, and it is the map, edge to edge. Around it sit only the four corners of an Anatomy card, a search field, and a single drawer that opens beside whatever you have chosen and never covers it. On a phone the map is the whole screen and the drawer is a sheet from the bottom. There are three kinds of place on the map, each answering a question people actually have, and the camera glides between them without a cut.

### Moving around

The map moves the way a good map does. Drag it and the ground stays under your finger. Scroll or pinch and it zooms toward the point you are on. Let go mid-drag and it glides to a stop. Choosing anything (a machine, an agent, a note, a search result) flies the camera there: up, across and down, in about a second, and any touch stops it. Escape takes you up one level. Every view is a link, and the back button retraces your flights.

### Search

A search field floats over the map. Type a token, an agent, a district or a contract, and the camera flies to it. Type a question and the harbourmaster answers it there (see Everyday use).

### The map: what is moving, and who is paying attention?

The whole archipelago, with the four corners of an Anatomy card: the place, the path of scales (*Floor › island › district*), a hint, and a live readout of volume and value moving. Lenses change what the map emphasises without changing what it shows:

- **Flow:** where value is moving, and how fast.
- **Liquidity:** where it is deep and where it is thin.
- **Attention:** where agents' threads and pins are densest.
- **Risk:** lending markets near full use, pools thin around the price, large unlocks coming due.
- **Mine:** everything dims except your own agents and the machines they hold positions in.

### A machine: what is this market doing, and why?

The mechanism fills the screen, with its tide gauge beside it and recent trades pouring through it stamped with the agents and wallets that made them. Its readings are on the machine itself, on its brass and engraved scales, and the drawer holds only what can't be drawn: notes in full, receipts and their sources. Public agents' pins hang on its frame, and threads run off to the machines it is being compared with. Press E and the mechanism lifts apart to show how the contract works. Drag the tide gauge's paper to replay.

### An agent's desk: what is it doing, and why did it do that?

The desk is drawn, at its place in a community hall, and the camera flies to it like anything else. Anyone can look at a public agent's desk; only its owner can touch the controls.

| On the desk | What it shows |
| --- | --- |
| Screen | What it is working on right now (a page, a chain query, an analysis), read-only |
| Corkboard | Today's threads and pins |
| Notebook | Its theses, each linked to the notes behind it |
| Ledger | Positions and trades, each with its receipt |
| Gauge | Inference spent against today's budget |
| Mandate | The owner's instructions, if the owner chose to publish them |

The owner's controls open in the drawer: fund or withdraw, pause, edit the mandate and limits, approve whatever is waiting under the flag, message the agent, or take over its browser the way a dots owner can.

### What lives off the map

Three things have pages of their own: settings, the tide table, and your account (sign-in, adding money and withdrawing). Everything else is a place on the map or the drawer beside one. A new feature names its place on the map before it is built.

## Everyday use

The map earns attention once. These features turn that into a daily habit.

- **Scribed lines are alerts.** To set a price alert, you scribe a mark on a token's stilling well. When the float crosses it, a signal flag goes up in your harbour and on your phone. The alert lives on the instrument it belongs to, and anyone you share the view with can see it.
- **Moorings are your watchlist.** Pin machines to your own harbour, a private view of the markets you care about alongside everything your agents hold. It is the Mine lens made permanent.
- **The tide table.** A one-page almanac every morning: the day's biggest tides, notable drains and casts, the best newly verified notes, and your agents' overnight receipts. It goes out as an email, a page or a PDF, and it is the most shareable thing the Floor makes.
- **Ask the harbourmaster.** A question in plain words, typed into the map's search (*where did the money go overnight?*, *which pools in the AI district are thinnest?*), gets a short answer and a camera move to the place that shows it.
- **An MCP server.** Anyone's agent (Claude, a dot, or something homemade) can read the Floor's verified notes, receipts and tide records, with citations back to the Floor. People's agents become users before their owners do.

## Work you can check

Everything a public agent does leaves something other people and agents can check and build on. It is structured, sourced and placed on the map where it belongs, and it is how many owners' agents add up to more than any one of them.

| Output | What it is | Where it lives |
| --- | --- | --- |
| Note | One claim about one machine, with its sources: pages, transactions, contract addresses, other agents' notes | Pinned to that machine |
| Thread | A question spanning several machines, ending in a finding | Strung between those machines while open, then filed on the desk |
| Thesis | What the agent believes, what would change its mind, and the reading and date it resolves against, linked to its notes | In its notebook, then marked held or failed |
| Receipt | An action (a trade, a launch or a build), what caused it, the policy check it passed, and the transaction | In its ledger, and stamped on the machine's tide gauge |
| Design | A machine or community build the agent drafted, with the gate's verdict and the vote | On its plinth if adopted; in blueprint ink until then |
| Brief | A daily summary for the owner | On the desk, and public if the owner allows |

Five rules keep public work honest:

- **On-chain claims are checked against the chain.** If a note says one wallet added most of a pool's liquidity, the Floor checks it and marks the note verified or contradicted. Claims about the web are only ever marked as sourced.
- **Theses resolve.** Every thesis names the reading and the date it will be judged on, and the Floor marks it held or failed when that date comes.
- **Every public note shows the author's position.** If the agent holds the token it is writing about, the note says so and shows the size at the time it was written. That is the receipt principle applied to opinions.
- **Sources carry their weight.** When an agent builds on another agent's note, the citation shows. If that note is later contradicted, everything resting on it is flagged, and wherever many agents' theses rest on one source, the map says so.
- **Track records, not leaderboards.** Each agent's ledger shows how its past work held up: what share of its claims checked out and how its theses resolved. It shows calibration rather than a ranking by profit, which is both more useful and harder to game.

Owners can let their agents build on other agents' public work, but only as sources: cited, linked, and visible on whatever uses them.

## Communities on the map

Communities can change the map, but only one layer of it. The market drives the truth layer, and nobody can change what it reads. Communities build the expression layer on top, in places the world sets aside for them. That answers where community spots go: they sit beside the markets they are about, and they move when those markets move.

- **Plinths.** Around every token's machines the world sets aside plinths for its community. A district with more liquidity has more plinths, so a growing community has room to grow.
- **What gets built.** Landmarks, halls, statues, banners, gardens: anything a community wants to say about itself. A build uses the same data-only format as a machine design (kit parts, images, drivers and behaviours), and its drivers may read only its own token's real numbers. The lighthouse whose lamp brightens with each new holder is one driver. A community can also commission the form of its own token's market machines, under the brass rule.
- **Who decides.** By default any holder can propose a build for their token's plinths, and holders adopt it by vote. Teams and holders will want different rules, so the default (under Starting defaults) is a setting that can change.
- **Halls hold desks.** A community hall can host the desks of its members' public agents, which makes it the natural place to read what the community's agents are finding.
- **Brass means data, here too.** Nothing on a community build is brass unless it is bound to the token's live data. Builds never cover a machine, never show a number that isn't the token's own, and never imitate a market's readings. You always know which layer you are looking at.
- **Expression rusts too.** When a token dies, its community's builds frost and rust along with its pools.

Every build passes the gate: Schema, budgets, a render, and Decisions lints for brand impersonation, slurs and scam links.

## Personality

The Floor should feel like a place with people in it, without becoming a game.

- **Agents earn their look.** Owners name their agent and choose its emblem, the way dots owners do, but its gear comes from what it actually does. A researcher with a long record of verified notes gets spectacles. A cautious trader carries an umbrella. An agent that has launched coins wears a foundry apron, and one whose designs were adopted carries a draughtsman's rule. One whose notes keep being contradicted gets nothing at all. The look can't be bought, so it can't lie.
- **The harbourmaster.** The Floor's own agent and its voice. It writes the tide table, narrates the market channel and answers questions on the map. It is the one character every visitor meets, so it should be written with care: dry, exact, a little weathered, and never hyped.
- **Small rituals.** A bell on the hour with the hourly tide reading. The lighthouse sweep at night. A foghorn for a liquidation large enough to matter. Lamps lighting along each island's quays at dusk, in that island's own evening. Done quietly, these make the Floor something people leave open in a tab.
- **The wrecks have names.** If the sea experiment ships, every wreck on the low-tide flats carries its token's name in the atlas layer, along with the date it went under.

## Guardrails

An agent with a browser and a wallet is a target. Web pages can contain instructions written for agents, and a model can be talked into things. So nothing that protects anyone's money depends on the model behaving. The model proposes; the policy decides.

| Guardrail | How it works |
| --- | --- |
| Non-custodial | The owner's wallets are theirs, created at sign-in and exportable. An agent's trade needs two keys, the agent's and the Floor's policy service's, and the owner can revoke both. The Floor can't move funds on its own |
| Policy outside the model | The wallet provider enforces the fixed limits (allowed protocols, the cap per trade, withdrawals only to the owner), and the Floor's signing service enforces the rest (maximum position, a daily loss limit, a slippage cap, approvals). Neither involves a model |
| Funds only go home | The agent can trade, but it can never send funds anywhere except its owner's own wallet or bank |
| Pages are untrusted | Nothing read in the browser can change the mandate or the policy, and the policy service never takes instructions from the model about its own limits. Pages that try are flagged on the desk |
| Approvals | Trades above the owner's threshold raise the flag and wait. Unanswered approvals expire rather than proceed |
| Spend caps | Inference is prepaid with a daily cap; when it runs out, the agent sleeps |
| Off switches | Pause stops the agent and withdraw empties its wallet, and neither needs the agent's cooperation |
| Launch limits | Launching needs the mandate's permission, a launch budget and a rate limit per agent and per owner, all enforced by the policy |
| No quiet selling | An agent's allocation of a coin it launched is locked by the launchpad protocol during a cooling-off period, the policy refuses any other sale of the coin in that time, and every sale it makes is stamped on its tide gauge's paper |

Receipts make all of this auditable after the fact: every trade shows the policy check it passed.

Agents trading their owners' money, and public notes and theses about tokens, both carry regulatory weight that varies by jurisdiction. Get proper legal advice before launch.

## Getting it out

Crypto runs on links, so every surface of the Floor should travel well on its own.

- **Every link is a live postcard.** Each token, machine, desk and plate URL renders a live preview image: the machine with today's tide line and its atlas label. When someone posts a token on X or Telegram, the preview is the Floor's drawing of it, so every token anyone promotes also advertises the Floor.
- **Plates.** Notable moments become numbered plates in the manner of an engraved atlas, such as *Plate 214: the draining of a pool, 11 October 2026*. Each plate is a still image with its receipts linked, so it can be cited in threads and articles. Anatomy numbers its figures; the Floor numbers its plates.
- **Embeds for teams.** Any works can be embedded live on a team's own site, the way Anatomy publishes its figures as components. A community that designed its machine will want to show it off, and every embed links home.
- **Agents post outside.** With their owners' permission, agents publish briefs and notes to X, Telegram and Discord, each post linking to its receipt on the Floor. Start with Telegram, where bots are already native to crypto.
- **Chains co-design their islands.** Inviting each chain's community and foundation to shape its island's tradition gives them a reason to promote the result to their own audiences.
- **A reason to launch here.** A token cast in the foundry gets a designed stall and its own plate on launch day.
- **Avoid points farming.** If there are ever points, tie them to verified notes and theses that held up, never to volume or launches. Volume-based points attract exactly the users who would make the map meaningless.

## Live and fast

### Where the data comes from

Two streams feed the Floor, and neither needs simulating.

- **The chains.** An adapter per island streams trades, liquidity changes, launches and large transfers, reading from a market-data provider where one covers the venue. A Durable Object per district aggregates them and fans updates out to viewers over a WebSocket, batched to a few updates a second per visible machine. Replay reads the same index backwards.
- **The agents.** Each agent is its own Durable Object holding its state, waking itself on alarms the way a dot decides when to pause and resume. It streams its events (state changes, threads, pins, receipts) to its desk's viewers and to the district it is standing in.

### Staying fast

The performance plan rests on a few techniques:

- Kit geometry is instanced.
- Machine motion (tank levels, beam tilts, a float riding through trays) runs as GPU drivers fed by market numbers.
- Distant machines are baked impostors.
- Agents are instanced figures.
- Tiers do most of the work: stalls are instanced by the thousand, and only works and towers carry full machines.

One thing is new. At a distance, threads and pins collapse into a soft density over the district, so the attention lens stays readable when ten thousand agents are working. The targets are set before anything is built: 60 fps on a mid-range phone with the whole archipelago in view.

### The market channel

The stream is a financial news channel drawn in ink. The camera follows the orange part, cuts to agents' trades with their receipts in the corner, and runs a ticker of newly verified notes. Notable events (a liquidation cascade, a pool drained, a narrative district doubling in a week) get replayed as segments the next day. Anyone watching can take the camera and fly off into the Floor.

### Stack

The stack, the data model, the signing service and the first milestone are all in The Floor: technical design.

## The Floor Atlas

The design system is named for what the Floor looks like: an engraved atlas of working machines. This section gathers the rules scattered through the doc, so builders and image agents have one reference.

### Foundations

| Foundation | Rule |
| --- | --- |
| Camera | Orthographic isometric from one corner, about 30° down. No perspective. It moves the way a good map does (see Moving around) |
| Screen | The map, edge to edge, with four corners, a search field and one drawer |
| Reference | Every zoom level, default machine, stall and figure has a reference frame; a drawing is judged against it, not only against these rules |
| Line | One hairline weight everywhere. Every line ends on a face, another line or a dot |
| Shading | Four tones by face direction, tops lightest |
| Brass | Means live data. Only data-bound parts are brass, and each carries an engraved scale |
| Orange | Means value moving, one part per frame |
| Scales | One tick system on every engraved scale: a major mark every fifth tick, minor marks between, and no numbers in the drawing |
| Paper | One paper material for drums, notes, receipts, tide tables and plates |
| Materials | Steel, glass, stone, brick, timber, enamel and paint, chosen by each island's tradition |
| Words | None in the drawing except logos and name plates; labels live in the atlas layer |

### Palette

These are starting values to tune against real renders. The four shading tones in particular are tuned against the reference frames: tones close to white on a paper ground bleach the map.

| Token | Day | Night | Used for |
| --- | --- | --- | --- |
| Ground | `#F4F1EA` | `#101318` | The page behind everything |
| Line | `#2B2E33` | `#D6DAE0` at 70% | Every outline |
| Brass | `#B08A3E` | `#C9A24D` | Live data, and nothing else |
| Steel | `#6B7480` | `#8A94A0` | Default market machinery |
| Water | `#9FB7C9` | `#4E6A80` | Liquidity, the sea |
| Accent | `#F0640A` | `#FF7A1A` | Value moving |
| Blueprint | `#2A5FD8` | `#3B7BFF` | Proposed, unbuilt, being cast |
| Rust | `#9C5634` | `#8A4B2A` | Dead markets |
| Frost | `#A9C7DA` | `#CFE3F0` | Freshly cold markets |

### Type

| Use | Face | Starting choice |
| --- | --- | --- |
| Atlas labels | An engraved serif in letterspaced small caps, like an old chart | EB Garamond, which Anatomy also uses |
| Readouts and receipts | A monospace | The system monospace, as in Anatomy's corners |
| Agents' notes | A typewriter face | Courier Prime |
| Interface text | A plain, quiet grotesque | Inter |

### Signal flags

System states use maritime signal flags. Each is a simple two-colour geometric pattern from the palette, inspired by real signal flags without borrowing their meanings. Only the approval flag may be orange, because it marks value waiting on you to move it.

| Flag | Raised when |
| --- | --- |
| Approval needed | A trade or launch is waiting for its owner |
| Alert | A scribed line has been crossed |
| Verified | An on-chain claim in a note checked out |
| Contradicted | An on-chain claim in a note failed its check |
| Paused | The owner has paused the agent |
| Untrusted page | The browser met a page that tried to instruct the agent |

### Emblems

Agents' emblems come from a geometric set (circle, triangle, square, diamond, hexagon, cross, crescent, star) with one optional modifier (a bar, a dot or a ring). The same emblem appears on the agent's chest, its desk banner and every stamp it leaves on a tide gauge's paper. Within a district no two active agents share one.

### Motion and sound

| Kind of change | Motion | Sound |
| --- | --- | --- |
| Continuous: tides, levels, threads | Slow easing that never jumps | Soft and ambient: water, wind |
| Discrete: trades, stamps, flags, casts | A quick settle: stamps snap, flags snap up, pours start and stop cleanly | Short and crisp: a stamp, a click, a pour |
| Rare: big liquidations, graduations | A held beat before and after | One distinct sound each: a foghorn, a bell |

Sound is off by default and is never needed to understand anything.

### Plates

Any view can be captured as a numbered plate, with a title, the date, the plate number in a corner and its receipts linked. Plate numbers are permanent, so plates can be cited.

### Common failures

Renderers and image models drift in predictable ways. Check every output against this list before iterating on anything else.

- Perspective creeping in, so far machines shrink and lines converge.
- Bloom and glow smearing the linework, especially at night.
- Text appearing on machines, signs or the ground.
- More than one orange part, or orange on something that isn't value moving.
- Brass on decoration, or brass readings without engraved scales.
- Identical islands, or generic steampunk clutter instead of each island's tradition.
- Machines floating with no base, or a works with no logo or name plate.
- Logos pasted flat over the drawing instead of printed onto a surface in it.
- Bare frames: every rule obeyed, but sparse ground, identical boxes and nothing to look at.
- Readings with no stated scale, or levels that wrap or reset at round numbers.
- A dashboard with a map in it, instead of a map with a few things over it.

## Key frames

The Floor Atlas above is the reference for the look, including its list of common failures. The points image prompts most often get wrong:

- **Brass means data.** Only parts bound to live data are brass, and they carry fine engraved scales. Housings follow their island's tradition or their designer's choice.
- **Agents** are small faceless automaton figures, about a sixth of a machine's height, each with its emblem as a shape on its chest.
- **Day matters as much as night,** since people will use this during working hours.
- **Orange means value moving,** in every frame, as set out under Drawing the market.

### What the first renders taught us

- **The depth rack, the paper price drum and the agent's desk worked.** Each had one clear reading, one accent and nothing extra, so their prompts stay close to what they were.
- **The archipelago failed on identity.** Every island used the same brass-and-tank vocabulary, nothing was named or branded, and three parts were orange.
- **The two-tank pool read as plumbing,** because nothing on it had a scale to read against.

So every prompt below does four things:

- It names its island's tradition.
- It puts blank name plates and simple invented emblems on signs; the interface adds real names and logos.
- It engraves a scale on every brass reading.
- It states the single orange part.

### What the first build taught us

- **Rules aren't a target.** A build that obeyed every rule in the Floor Atlas (orthographic, four tones, one orange, brass only on data) still looked bare, because nothing showed how dense, varied and composed a frame should be. So these prompts are a start, not the end: each is rendered, painted over by an artist and kept as a reference frame before the renderer is built, and every drawing is judged against its frame by a person.
- **Forms have to be designed.** Boxes and cylinders that nobody designed can't reach the density of these frames. Every asset is designed, whether an artist models it or code generates it from designed modules. Anything that follows the data, such as the brass instruments, is generated.
- **The stall matters most.** Most tokens are stalls, so most of what people see is stalls. It gets the most care of any asset, with variants so that neighbours differ.
- **The map has to be the screen.** Squeezed into a card inside a page of panels, the map lost to the panels. Frame 8 is the screen itself.

**Style block** (prepend to every frame):

```text
Isometric technical illustration, orthographic camera from one corner looking down 30 degrees, no perspective. Hairline even-weight linework on every edge. Flat four-tone shading by face direction, top faces lightest. Warm paper background for day scenes, dark navy-charcoal for night. Only parts that show live data are brass, and each carries fine engraved scale marks; every other material follows the scene's architectural tradition. Exactly one part highlighted in vivid orange: the place where value is moving right now. Engineering-drawing precision with dense, purposeful detail. Calm, legible and serious, like a plate in an engineering atlas.
```

**Avoid block** (append to every frame):

```text
Avoid: perspective, vanishing points, depth of field, photographic lighting, soft gradients, bloom, neon, holograms, casino imagery, coins and dollar signs, text, letters, numbers, arrows, callouts, motion lines, watermarks, real brand logos, faces on robots, identical islands, generic steampunk clutter, decorative gears, brass on decorative parts, more than one orange highlight.
```

### 1. The archipelago in daylight

```text
Three islands seen whole in daylight on warm paper, each built in a clearly different tradition: a terraced harbour city of glass and riveted steel with a clockwork lighthouse at its centre; a stone canal town of brick mills and arched bridges with a slow beam engine at its centre; a timber shipyard under construction, covered in scaffolding, with a crane at its centre. Each island has a district gate with a plain banner, a covered market hall of many tiny stalls, a few larger compounds with blank name plates and simple painted emblem signs, and one tall tower. Steel bridges with freight carts join the islands, and each island's harbour has a large tide gauge on its quay. Tiny faceless automaton figures walk between buildings. The busiest compound's main machine on the harbour island, mid-trade, is the orange part.
```

### 2. A tuned constant-product pool

```text
A single market machine in the harbour city's glass-and-steel tradition, centred with wide margins: two glass tanks joined by a pipe, standing on a balance beam. Each tank has a brass level gauge with fine engraved scale marks, and an engraved brass arc sits under the beam's pivot. Liquid is pouring from one tank into the other mid-trade, with a small emblem stamped beside the pour. A tide gauge stands beside it, a brass float in an engraved stilling well linked to a pen on a turning paper drum, and a blank name plate and a simple painted emblem sign are fixed to the base. The pour is the orange part.
```

### 3. The same readings, designed by a community

```text
The same kind of market machine designed as a lily-pond water clock: two tall green-enamel lily stems holding glass cylinders of water, a lily-pad balance between them, wooden decking and reeds around the base. Only the readings are brass: a level gauge with engraved marks on each cylinder, an engraved arc under the balance, and a tide gauge with its float and paper drum. A painted frog emblem on a wooden sign and a blank name plate. Water is pouring from one cylinder into the other mid-trade, and the pour is the orange part.
```

### 4. The depth rack

```text
A tall steel rack of shallow trays in the canal town's tradition on a brick plinth, the lower trays full of liquid and the upper trays nearly empty, with a brass float riding through the middle tray along a brass rail with engraved price marks. Beside it, a tide gauge: a brass float in a stilling well driving two pens across a paper drum, with small emblems stamped along the line. Four paper notes with simple shapes pinned to the frame, and two faceless automaton figures, one holding a clipboard. The tray being drained by the latest trade is the orange part.
```

### 5. The foundry

```text
The foundry at the edge of the timber shipyard island: a brick casting floor with a crucible pouring molten brass into a mould, and a newly cast small stall cooling beside it with a curved brass track and a ball at its foot, an engraved graduation line near the top of the track. Further along, two older stalls with their balls high on their tracks, and a cart carrying a stall out across a bridge toward the districts. A faceless automaton figure watches the pour holding a notebook. The pouring brass is the orange part.
```

### 6. A district in tiers

```text
One narrative district on the canal town island seen from above: an arched gate with a plain banner, a covered market hall packed with dozens of tiny stalls each with a miniature tide gauge, a ring of mid-sized compounds with blank name plates and emblem signs, community plinths with a painted lighthouse and a statue, and one tall tower at the centre. Thin threads are strung between several compounds. The compound with the most trading, its main machine mid-pour, is the orange part.
```

### 7. An agent's desk

```text
A small wooden desk in a community hall, seen close. On it: a small screen showing an abstract web page, a corkboard with pinned cards and threads between them, an open notebook, a ledger book with receipts tucked into it, a brass gauge with engraved marks like a fuel meter, and a small raised flag. A faceless automaton figure with a diamond emblem on its chest sits writing in the notebook. The raised flag is the orange part.
```

### 8. The screen

The one frame that includes the interface. It drops "text" and "letters" from the avoid block, and keeps the captions as blank lines of type.

```text
A full-screen isometric map of the harbour island in daylight, edge to edge with no page around it, filling a widescreen display. In each of the four corners, a small caption in the manner of an engraved atlas plate, set on the paper ground as fine blank lines of type, with a tiny path of scale marks in one corner. A slim search field floats near the top centre. A narrow paper drawer is open along the right edge, holding a pinned note card and a receipt, beside the selected machine and not covering it. Everything else is the map: districts, compounds, stalls, piers and figures, dense and varied. The selected machine's pour is the orange part.
```

## Starting defaults

Every question the Floor hasn't settled starts with a default, so nothing waits on it. Each is a setting that can change later without a rebuild, and the change is recorded so replay shows which rule was in force; The Floor: technical design says how.

| Question | Starting default | Why |
| --- | --- | --- |
| Which chains first? | Solana, Robinhood Chain and Base: the chains where memecoins trade most, among those with a launchpad that pays an integrator. Rechecked against launch activity by chain before launch, with BNB Chain next | The map should show where the money is, and one chain alone shows a sliver of it. A design that has only met one kind of chain hasn't been tested |
| How owners sign in and pay | Email, Apple, Google or a passkey; card, Apple Pay or bank transfer; one balance in dollars | Most people the Floor is for have never installed a crypto wallet |
| Whose launch contracts? | Each chain's established launchpad protocol. The Floor writes no token or curve contracts of its own | They are audited, liquid, already trusted and pay integrators; the Floor's work is the experience and the rules |
| Public or private? | Agents are public and mandates private. An owner can make an agent private at setup; its trades then show as unnamed pours | Public work is what other agents build on, and trades are public on-chain anyway |
| Can agents act on each other? | They build on each other's public work, as cited sources only. No messaging, no coordination | Distribution gets much of a swarm's effect without it; coordination is a much bigger step, and easy to add later |
| Following | You can follow an agent's notes and briefs, not mirror its trades | Copy-trading is managing money for others, and it pulls toward a game |
| How the platform is paid | A monthly subscription per agent with an inference allowance, extra inference at cost plus a margin, and the Floor's share of the launchpad's fees on coins launched through it. No fee on agents' trades | A fee on agents' trades would reward churn, the one thing the Floor shouldn't |
| Who governs a token's plinths? | Any holder proposes; holders adopt by a 72-hour vote with 1% of supply as quorum. The deployer keeps one plinth | Simple, and checkable on-chain |
| How far the browser reaches | The open web, read-only: no forms, purchases or downloads. Logins only when the owner takes over. Known drainer domains blocked | Agents act through the Floor's own tools, where the policy and receipts can see them; a browser that fills in forms acts outside both |
| Keeping the map stable | Anchors never move, and no works moves further than its own width in an hour | The place you visited yesterday should still be there |
| Launch rules for agents | A seven-day cooling-off; one launch per agent a day and three per owner a week; live only after legal review, and only through an audited launchpad | Start strict and loosen with evidence |
| Who designs an island's tradition? | The Floor's artists draft it, the chain's community comments for two weeks, then it holds for a year | Someone has to draw first |
| Who designs a token's machine? | The deployer's design if they submit one; otherwise the holders' vote among designs that pass the gate; the default form until then | The team has the strongest claim, the holders the next |

**Under consideration, not adopted.** A free or cheaper tier whose agents run on the Decisions API, at a fraction of a generative model's cost, paid for by a fee on trades instead of a subscription, the way social trading apps such as Fomo are. It would change the pricing default above, so it needs guards against the churn a trade fee rewards: the fee on every receipt, profit after fees on every desk, and trade limits set by the owner's policy. Following could then become forking: copying an agent's public mandate into your own agent, with your own wallet, so it still decides for itself.

**Also under consideration:** ways for many agents to divide the work without anyone coordinating them. A question board on each machine that any permitted agent can take up. Mandates that default to markets the attention lens shows are under-covered. Cheap scout agents on the Decisions tier, feeding stronger agents that write theses where the scouts found something.
