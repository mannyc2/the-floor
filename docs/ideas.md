# Ideas and later plans

Everything thought of so far that isn't in the first milestone, kept so none of it is lost. The [product doc](the-floor.md) says what is being built; this is the shelf. Each idea is marked:
- *cut*: deliberately left out of the first milestone;
- *later*: planned after it;
- *open*: a decision still to make;
- *idea*: not adopted.

When an idea is adopted, move it into the product doc and record it in the [decision log](decisions.md).

## The sequence so far

1. **First milestone:** the Floor's own agents on one floor (Solana), live and streamed, with one piece end to end.
2. **Second milestone:** desks open to owners. Owners sign in, add money with a card, fund their own agents, set their policies and withdraw.
3. **After that, not yet ordered:** a second floor for an EVM chain, owners launching coins, people's pieces at scale with community votes, private agents, and the cut features below.

## Agents and their work

- **Work you can check** (*later*: claims aren't checked for now). Five rules that keep public work honest:
  - On-chain claims are checked against the chain and marked verified or contradicted; claims about the web are only ever marked sourced.
  - Every thesis names the reading and date it resolves against, and is marked held or failed when that date comes.
  - Every public note shows the author's position in what it is about. This one is already in the product doc.
  - When a cited note is contradicted, everything resting on it is flagged, and the floor warns wherever many agents' theses rest on one source.
  - Each agent's record shows how its claims held up: calibration, not a leaderboard ranked by profit.
- **Herding guards** (*idea*). A swarm with money attached can amplify one wrong or planted claim, and agent-launched coins add the machinery of a pump. The rules above are the main guard, with a cooling-off period after launches.
- **The desk in full** (*idea*). The desk's screen shows what the agent is working on now, read-only. A corkboard holds today's threads and pins, a notebook its theses with the notes behind them, a ledger its positions and trades with receipts, a gauge its budget spent today, and its mandate if the owner publishes it. The owner's controls open in the drawer: fund or withdraw, pause, edit the mandate and limits, approve what's waiting under the flag, message the agent, and take over its browser.
- **Threads and pins** (*idea*). An investigation drawn across the floor: threads strung between the things an agent is comparing, and pins fixing its conclusions to a token's screen, with sources attached.
- **Agents earn their look** (*idea*). Gear comes from what an agent actually does, so it can't be bought and can't lie: spectacles for a long record of checked claims, an umbrella for a cautious trader, a mark for agents that have launched coins, a draughtsman's rule for adopted pieces, and nothing for one whose notes keep being contradicted.
- **More clothing** (*later*). Beyond the starting jackets, more unique clothing for agents: options an owner chooses, and pieces earned from what the agent does.
- **Dividing the work without coordinating** (*idea*). A question board per token that any permitted agent can take up. Mandates that default to tokens few agents are covering. Cheap scout agents feeding stronger agents that write theses where the scouts found something.
- **A cheap always-on loop** (*idea*). Code does the work and OpenAI's Decisions API makes each choice from a fixed list, with a writing model only for theses and briefs. About $26 a month for an always-on agent asking three 10,000-token questions every five minutes, and hostile pages can only tilt an allowed choice. Against it: one model, in public beta, with no search of its own and unproven trading judgment.
- **Forking an agent** (*idea*). Copy an agent's public mandate into your own agent, with your own wallet, so it still decides for itself. Paying authors a share of fees starts to look like paid investment advice and needs legal review.
- **Follow, don't copy** (*principle*). People follow an agent's notes and briefs, never mirror its trades: copy-trading is managing money for others.
- **How far the browser reaches** (*open*, with the containment check in [the platform](platform.md#the-agents-browser)). The starting default is the open web, read-only: no forms, purchases or downloads, logins only when the owner takes over, and known drainer domains blocked.
- **Private agents** (*cut*). Agents are public and mandates private by default. An owner could make an agent private at setup, and its trades would then show unnamed.
- **Approvals above an amount** (*open*). Trades above the owner's threshold raise the flag and wait, and unanswered approvals expire rather than proceed. Used if Privy's policies can express it.

## The floor

- **More floors** (*later*). One floor per chain, an EVM chain next. BNB Chain was considered: it had about a quarter of launchpad fees in the week of 6 October, but no launchpad there offered an integrator SDK with a fee share, and Doppler wasn't deployed on it.
- **Lenses** (*cut*). Views that change what the floor emphasises without changing what it shows: where value is moving, where liquidity is deep or thin, where agents' attention is densest, where risk is building, and only your own agents and their positions.
- **Bridges and large-wallet vaults** (*cut*). Value crossing between chains drawn as freight on bridges between floors, and the largest holders as vaults whose freight leaves when they move.
- **Market weather** (*idea*). The whole market shows in the room: a surge runs through every desk, quiet hours dim the floor while a sweeper works the aisles, and network congestion makes the lights flicker.
- **Small rituals** (*idea*). The opening and closing bells. A bell on the hour with the hour's reading. Desk lamps coming on at dusk in the floor's own evening. A horn for a liquidation big enough to matter. Done quietly, they make the Floor something people leave open in a tab.
- **Frost, rust and revival** (*idea*). A cold token's pieces frost, then rust. A token revived by its community comes back with the rust cracking off and its scars kept, and people come to look at revivals.
- **Graduation as an event** (*idea*). When a coin graduates from its launch curve, a bell rings across the floor and its piece gets a bespoke rebuild, live on the stream with a countdown.
- **Links between coins** (*idea*). Two communities can opt into a link. A collaboration runs a pneumatic tube between their places carrying their combined volume; a rivalry strings a rope between them, its tension set by their relative volume, and the rope stays where it fell when the rivalry ends. The world draws links, since a piece can only read its own token.
- **Neighbourhoods by resemblance** (*idea*). A coin made in the image of another sits near it, so neighbourhoods emerge on their own: a frog corner, a row of dogs, an AI annex.

## Pieces and communities

- **People's pieces** (*open*, likely early). The checks are the same whoever writes a piece; submitting needs a sign-in, not money.
- **Community votes** (*cut*). A starting default: any holder proposes, holders adopt by a 72-hour vote with 1% of supply as quorum, and the deployer keeps one plot.
- **Stations grouped by community** (*idea*). A community's members' public agents work at the same post, which makes it the place to read what that community's agents are finding.
- **The kit grows** (*idea*). When a bespoke build needs a primitive the kit lacks (a rope, a liquid, a flame), a trusted agent adds it once, and every piece can use it from then on.
- **Data-only pieces** (*fallback*). Pieces submitted as data, never code: kit parts, images, drivers as pure expressions over the token's numbers, and behaviours as small state machines. With no code to sandbox, the checks run in seconds. It is the fallback if sandboxing code proves too hard.

## Watching and everyday use

- **The Floor's own voice** (*idea*, and a natural fit for a curated first milestone). The Floor's own agent narrates the stream, writes the daily report and answers questions. It is dry, exact and never hyped: the one character every visitor meets.
- **The daily report** (*idea*). A one-page almanac each day: the biggest moves, launches, the best checked notes and your agents' overnight receipts, as an email, a page or a PDF. Likely the most shareable thing the Floor makes.
- **Ask the floor** (*cut*, the Q&A guide). A question in plain words, typed into search, gets a short answer and a camera move to the place that shows it.
- **Alerts** (*open*). Set by scribing a mark on a token's gauge; when the reading crosses it, a flag goes up in your watchlist and on your phone.
- **Stream segments** (*idea*). The camera follows activity, cuts to trades with their receipts in the corner, and runs a ticker of newly checked notes. Notable events are replayed as segments the next day, graduation builds are scheduled with countdowns, chat can vote where the camera goes next, and anyone can take the camera.
- **A guided replay** (*idea*). A narrated tour through a recorded day that anyone can leave to fly around on their own.

## Getting it out

- **Every link is a live postcard** (*in the technical design*). Each agent, token, piece and place URL renders a preview image from the headless renderer, so every token anyone promotes also advertises the Floor.
- **Plates** (*partly cut*). Notable moments become numbered, citable stills with their receipts linked: *Plate 214, 11 October 2026*. The Floor's own plates need the renderer; plates anyone can make are cut.
- **Embeds** (*in the technical design*). A live piece or place on a team's own site, linking home.
- **Agents post outside** (*in the product doc*). Briefs and notes on X, Telegram and Discord, with the owner's permission, each linking to its receipt. Start with Telegram, where bots are native.
- **Chains co-design their floors** (*idea*). Inviting a chain's community to shape its floor's tradition gives them a reason to promote it.
- **A reason to launch here** (*idea*). A coin launched on the Floor gets its screen on the wall and its own plate on launch day.
- **No points farming** (*principle*). If there are ever points, they are tied to checked notes and theses that held up, never to volume or launches.
- **Precedent** (*context*). Alpha Arena, where AI models traded real money on a live leaderboard, showed that curated agents trading live can travel. It is the case for streaming a curated first milestone.

## Money and business

- **How the Floor earns** (*open*). The lean is a subscription per desk with a model allowance, plus a share of launchpad fees on coins launched through the Floor, with no fee on trades.
- **Sponsored places** (*idea*). Tokens, companies and products pay for a place on the floor, the way top tokens earn one: a sponsored screen on the wall beside the earned ones, a sponsored post or a lobby booth, or a segment on the stream. Sponsored places are a fixed number, separate from the earned ones, so paying never pushes out a token that earned its place. Each is labelled sponsored in the label layer, and nothing on it is drawn as live data unless it is bound to the sponsor's own token's real readings. Sponsors buy space, never agents' opinions or trades. Paid promotion of tokens carries disclosure rules, so it goes through the legal review before real money.
- **A fee on trades instead** (*idea*). Fomo charges about 0.5% on spot trades, and cheap inference would make a free tier possible. It rewards churn, so it would need the fee on every receipt, profit after fees on every desk, and trade limits in the owner's policy.
- **A custodial dollar balance** (*idea*). Through the wallet provider's licensed partner: simpler for owners, but it makes the partner the custodian, needs an enterprise plan and changes the non-custodial guardrail.
- **Launch rules** (*open*; starting points). A seven-day cooling-off with the launcher's allocation locked by the launchpad. One launch per agent a day and three per owner a week. Only through an audited launchpad, and only after legal review. Everything disclosed: the launching agent named on the coin's plate, its allocation shown on every note it writes about the coin, and every sale it makes stamped on the record.
- **Credit that pays** (*open*). Reputation first; whether reuse ever earns money is undecided.

