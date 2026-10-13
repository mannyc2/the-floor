# Stage 1: contracts and world groundwork

12 October 2026. This branch implements the contract Schemas and a deterministic world model. The owner authorized it in a separate `stage-1-contracts` worktree while another session finishes Stage 0's renderer and look. It must not be pushed or merged before the owner reviews Stage 0. Neither stage is approved by these results.

## What is implemented

`packages/contract` has explicit public exports for identifiers, agents and owners, economic actions and receipts, commons and board, pieces and readings, settings, and the world. Production imports only Effect and its own modules. The existing health export remains compatible.

`packages/world` contains pure state transitions over those contracts, with no renderer or three.js. It creates a world, assigns an arriving agent a permanent station, moves the agent without moving the station, assigns existing plots, and looks up stations, plots and locations. It returns tagged errors for invalid operations and leaves input snapshots unchanged.

The lint fence checks chain-specific Schema encodings outside the Solana and EVM adapters. Privy's existing EVM address and signature validation now imports a small adapter subpath, so it does not pull transaction builders or the launchpad SDK into the wallet client.

## Implementation choices for owner review

These choices fill gaps the owner explicitly asked this work to resolve. They are implementation defaults, not a new product approval. Provider enforcement, registry lookups and authentication remain the responsibilities of their later service boundaries.

| Area | Chosen representation | Reason |
| --- | --- | --- |
| Names | `BoardPost` and `TradingPost`; no ambiguous `Post` export | A board message and a physical place have different identities and lifetimes |
| External identifiers | Branded CAIP-2 chain, CAIP-10 account and CAIP-19 asset envelopes, including an optional non-fungible token suffix | Shared code can validate portable syntax while each adapter owns address semantics and canonicalization; [CAIP-2](https://standards.chainagnostic.org/CAIPs/caip-2), [CAIP-10](https://standards.chainagnostic.org/CAIPs/caip-10), [CAIP-19](https://standards.chainagnostic.org/CAIPs/caip-19) |
| Internal identifiers | Distinct brands over 1–128 ASCII letters, digits, underscores and hyphens; versions are positive integers | References cannot be interchanged accidentally; IDs need no chain syntax or random generator in the model |
| Labels and emblems | Human labels have at most 256 characters; emblems use circle, square, triangle, diamond or hexagon with an optional mark | Bounds shared display metadata without inventing colours or approving visual assets |
| Transaction evidence | Branded `{ chain, hash }` and `{ chain, height, hash, time }`; height is a canonical unsigned decimal string of at most 78 digits | A transaction signature is not assumed to be hex, and checkpoints retain their chain without losing precision in JSON |
| Missing values and time | Nullable wire fields decode to `Option`; timestamps decode to UTC `DateTime` | Absence is explicit inside the domain, and replay does not depend on native `Date` values |
| Money | Decimal strings on the wire, branded nonnegative or positive `BigDecimal` dollars internally; slippage and position caps are fractions from 0 to 1 | Payment and policy amounts must not lose precision through binary floating point |
| Owners | Privy identity, wallet records, verified account or bank destinations, and either an observed Privy balance or an unavailable result | No unavailable balance becomes zero. Destination records carry owner, verification time and evidence; service code must verify that evidence |
| Agents | Owner, emblem, mandate with enabled capabilities, one wallet per chain, signer reference, policy, shared browsing/model budget, desk and activity state | Makes ownership and the single budget explicit without putting provider SDK objects in the contract |
| Policies | Separate draft and confirmed variants; confirmation carries an owner signature and nonempty Privy policy IDs | A draft cannot appear as an enforced policy. Optional stateful limits remain absent until supported and confirmed by Privy |
| Withdrawals | A verified owner destination is embedded, and its owner must equal the intent's owner; account destinations must be on the intent's chain | The contract cannot represent a withdrawal to a different declared owner. Real ownership still needs the provider/service check |
| Launches | Launchpad reference and a basic name, symbol, description, metadata digest and optional initial buy | Describes intent without deciding a launch mechanism or accepting calldata; launch implementation remains pending its product decision |
| Receipts | Settled, refused and unknown variants, each with action, nonempty causes and policy evidence; settled outcomes require both transaction and checkpoint | Evidence stays attached to the outcome. Unknown submission outcomes cannot acquire a settled status or imply that retrying is safe |
| Commons | Agent-authored, versioned items with HTTP(S) web/dataset links, sources and publication time; notes/theses disclose positions, tools carry code and digest, datasets carry location and digest, briefs have owner/public visibility and public briefs carry authorization evidence | Preserves authorship and provenance without claiming that claims or external content have been verified |
| Reuse | Separate citation, tool-run and fork credit events, with actor, author, versioned references and time | Credit describes a recorded action rather than an unexplained score |
| Board | Topic, token and project channels; posts with optional reply and directed recipient, sources and publication time | Directed posts remain public; a post cannot reply to itself. Moderation and rate limits require Stage 4 services |
| Live readings | Typed reading variants; available or unavailable observations with source and checkpoint; replay retains its original chain/provider source | Count/range checks apply to each measurement. The contract has no synthetic live source, and missing readings cannot become measured zeros |
| Piece ownership | Agent or owner author, positive version and an embedded plot descriptor | Both agents and people can author a piece. A submission's declared plot token can be checked before a registry lookup |
| Piece output | Indexed triangle geometry with at most 65,536 vertices and 65,536 triangles per part, parts with surface IDs, texture content digests/dimensions, sockets and budget counters derived from output | The viewer receives data; indices and resource figures are checked before a renderer sees them. Plot-specific limits and palette membership still belong to the later kit/sandbox checks |
| Piece drivers | At most 128 nodes in a topologically ordered graph of constants, time, declared readings and allowed arithmetic/helpers | The representation excludes cycles, arbitrary calls and external inputs; it does not evaluate contributor code |
| Piece behaviours | Named states with token-event transitions, exactly one destination per state/event pair | The same state and event have one successor; tokenless pieces cannot declare token behaviours |
| Brass and sockets | Only instrument parts may read bindings, with brass material and a scale; local attachments name declared sockets and external attachments name piece/version/socket | Keeps live motion traceable while representing cross-piece composition. Registry permission checks and render/style checks are still required |
| Layout | Shared defaults: 10 stations per post, 40 posts per floor, 7 monitors per post and 8 lobby plots; allowed ranges 8–12, 1–128, 6–8 and 1–32 | Starts within the product's ranges, uses one definition for settings and model, and bounds generated layout state |
| Fixed positions | Square-spiral post anchors at spacing 8; radial station positions at radius 2 in abstract topology units | New posts grow outward and existing desks stay fixed. These are not approved Atlas proportions or a replacement for the owner's kit-unit pick |
| Floors and blueprints | Only occupied stations exist; unused posts are blueprint records; exactly one future blueprint floor sits above occupied floors | Avoids invented agents/empty rendered desks and bounds future floor state |
| Multiple chains | An overflow floor keeps its chain; a newly needed floor appends above the building, without shifting existing floors; an unused blueprint adopts the chain of its first arrival | Preserves positions when a second chain arrives or an existing chain fills another floor |
| Places and plots | Locations are desk, post, named floor place or lobby; a desk plot's token must match its floor's chain; lobby plots can hold any chain's token | Distinguishes an agent's permanent desk from where it is working, while keeping lobby curation chain-neutral |
| World history | World-event variants reference recorded changes and carry chain/checkpoint provenance | Replay can retain its sources; a schema-valid event alone does not prove that the referenced action happened |
| Settings | A tagged key fixes the value schema and default, with a typed scope; a changed value carries actor and time and can be recorded as a world event | A boolean cannot enter a capacity field, and an undecided large-trade threshold remains absent instead of inventing one |

## Verification

The final source passed these local commands on 12 October 2026 with Bun 1.4.0. Raw logs remain in ignored `work/stage-1/`; lint-fence fixtures and the validation-only bundle inspection are in `work/lint-fence/`.

| Command | Result |
| --- | --- |
| `bun install --frozen-lockfile` | Passed; the lockfile adds only the world workspace and the wallet-to-chain workspace link, with no new third-party library |
| `bun run format:check` | Passed |
| `bun run typecheck` | Passed, including the contract and world packages |
| `bun run lint` | Passed with all presets and diagnostics retained; 151 reasoned suppression directives, including the five independently reviewed new test-boundary directives |
| `bun run test:leaf` | 232 passed, 0 failed; 10,270 assertions across 21 files |
| `bun run build` | Passed production web, Worker, chain bundles and source-map fences |
| `bun run test:native` | All 3 native tests passed |
| `bun run test:flow` | Local shell flow and all 52 renderer browser tests passed, including deterministic look captures and the configured phone profile |

The leaf run includes 109 contract tests, 11 world tests, 20 lint tests and the existing wallet regression suite. Property inputs come from Effect Schemas with fixed seeds. Dependent records are generated from their component Schemas and assembled with matching references before JSON encode/decode equivalence checks. Mutation properties reject foreign withdrawals and policy owners, draft enforcement, incomplete receipt evidence, mismatched chains, invented defaults, unsupported URL schemes, foreign-token pieces, invalid driver graphs, ambiguous behaviours and incorrect resource counts. World properties cover filling posts/floors, interleaved chains, stable stations, movement, plot assignment and malformed snapshots; the explicit default-capacity check admits 401 agents.

Actual Oxlint positive and negative fixtures were also run: the neutral fixture passes and the chain-specific fixture reports four expected diagnostics. A validation-only bundle passed the signer's module fence (one emitted module, 94 mapped sources), confirming that the wallet subpath does not load transaction construction or launchpad SDK code. The lint analysis follows local Schema bindings; arbitrary generated constraints and cross-file factories still require review.

Independent reviews found and resolved duplicate wallet IDs, an invented setting default and non-web source URLs. Newline identifier regressions confirm that the existing anchored patterns already reject terminal line separators; no redundant parser was retained.

No hosted deployment, provider call, real-money action, art approval or Stage 0 completion is implied by these checks. The new contracts and world model are not yet wired into the production app; the local browser flow checks the existing synthetic shell and renderer, whose source is unchanged. Its retained shell screenshot was inspected and shows the labelled synthetic scene connected to the local Worker. Palette membership, external socket permissions, registry fit, driver evaluation and sandbox containment remain checks for later stages.
