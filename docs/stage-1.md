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
| Missing values and time | Nullable wire fields decode to `Option`; real calendar timestamps use UTC ISO with exactly millisecond precision and four-digit years, decoding to UTC `DateTime` | Absence is explicit inside the domain. Locale-dependent and normalized impossible dates cannot change replay between engines |
| Money | Canonical plain decimal strings with at most 30 integer and 18 fractional digits; branded nonnegative or positive `BigDecimal` dollars internally; slippage and position caps are fractions from 0 to 1 | No exponent, redundant leading or trailing zeroes, or plus sign crosses the wire. Internal coefficients and scales are bounded before normalization/formatting, preventing exponent-sized allocation |
| Owners | Privy identity, wallet records, verified account or bank destinations, and either an observed Privy balance or an unavailable result | No unavailable balance becomes zero. Destination records carry owner, verification time and evidence; service code must verify that evidence |
| Agents | Owner, emblem, mandate with enabled capabilities, one wallet per chain, signer reference, policy, shared browsing/model budget, desk and activity state | Makes ownership and the single budget explicit without putting provider SDK objects in the contract |
| Policies | Separate draft and confirmed variants; each confirmed limit pairs its value with the Privy policy ID enforcing it, and confirmation carries the owner's signature | A loose list of provider IDs cannot imply enforcement of every limit. Optional stateful limits remain absent until supported and confirmed by Privy |
| Withdrawals | The intent references a destination ID. The signer's resolved result pairs the intent with a verified destination and checks matching ID, owner and account chain; the intent checks its asset chain independently | The agent cannot supply its own account or verification record. The signer must resolve the ID from its trusted registry; this stage defines that boundary but does not implement the signer |
| Launches | Launchpad reference and a basic name, symbol, description, metadata digest and optional initial buy | Describes intent without deciding a launch mechanism or accepting calldata; launch implementation remains pending its product decision |
| Receipts | Settled, refused and unknown variants, each with action, nonempty causes and policy evidence; settled outcomes require both transaction and checkpoint | Evidence stays attached to the outcome. Unknown submission outcomes cannot acquire a settled status or imply that retrying is safe |
| Commons | Agent-authored, versioned items with HTTP(S) web/dataset links, sources and publication time; notes/theses disclose positions, tools carry code and digest, datasets carry location and digest, briefs have owner/public visibility and public briefs carry authorization evidence | Preserves authorship and provenance without claiming that claims or external content have been verified |
| Reuse | Separate citation, tool-run and fork credit events, with actor, author, versioned references and time | Credit describes a recorded action rather than an unexplained score |
| Board | Topic, token and project channels; posts with optional reply and directed recipient, sources and publication time | Directed posts remain public; a post cannot reply to itself. Moderation and rate limits require Stage 4 services |
| Live readings | Typed reading variants; available or unavailable observations with source and checkpoint; replay retains its original chain/provider source | Count/range checks apply to each measurement. The contract has no synthetic live source, and missing readings cannot become measured zeros |
| Piece ownership | Agent or owner author, positive version and an embedded plot descriptor | Both agents and people can author a piece. A submission's declared plot token can be checked before a registry lookup |
| Piece output | Indexed triangle geometry with at most 65,536 vertices and 65,536 triangles per part, parts with surface IDs, texture content digests/dimensions, sockets and budget counters derived from output; `animatedNodes` counts animated scene parts | The viewer receives data; indices and resource figures are checked before a renderer sees them. Plot-specific limits and palette membership still belong to the later kit/sandbox checks |
| Piece drivers | At most 128 nodes in a topologically ordered graph of constants, time, declared readings and allowed arithmetic/helpers | The representation excludes cycles, arbitrary calls and external inputs; it does not evaluate contributor code |
| Piece behaviours | Named states with token-event transitions, exactly one destination per state/event pair | The same state and event have one successor; tokenless pieces cannot declare token behaviours |
| Brass and sockets | Material variants carry a `Brass` or `Decorative` tag and a palette slot. An instrument reads only its engraved binding, and animated output must depend on that reading; local attachments name declared sockets and external attachments name piece/version/socket | Slot spelling cannot determine material semantics, and an unused reading node cannot make unrelated motion honest. The later palette resolver must preserve the material tag; registry permission and render/style checks are still required |
| Layout | Shared defaults: 10 stations per post, 40 posts per floor, 7 monitors per post and 8 lobby plots; allowed ranges 8–12, 1–128, 6–8 and 1–32 | Starts within the product's ranges, uses one definition for settings and model, and bounds generated layout state |
| Fixed positions | Square-spiral post anchors at spacing 8; radius-2 station rings stored as fixed offsets rounded to a millionth of a unit; floor origins on a grid around the lobby one footprint apart, edges before corners. `World` checks every coordinate against the shared definition | No runtime station trigonometry can differ between engines, and a snapshot cannot carry positions inconsistent with its layout. All coordinates are abstract topology units, not approved Atlas proportions or a replacement for the owner's kit-unit pick |
| Floors and blueprints | Only occupied stations exist; unused posts are blueprint records; exactly one future blueprint floor waits at the next index beside the occupied floors | Avoids invented agents/empty rendered desks and bounds future floor state |
| Multiple chains | An overflow floor keeps its chain; a newly needed floor takes the next index beside the others, without moving existing floors; an unused blueprint adopts the chain of its first arrival | Preserves positions when a second chain arrives or an existing chain fills another floor |
| Places and plots | Locations are desk, post, named floor place or lobby; a desk plot's token must match its floor's chain; lobby plots can hold any chain's token | Distinguishes an agent's permanent desk from where it is working, while keeping lobby curation chain-neutral |
| World history | World-event variants reference recorded changes and carry chain/checkpoint provenance | Replay can retain its sources; a schema-valid event alone does not prove that the referenced action happened |
| World failures | `createWorld` returns a `Result`, and state changes validate their input snapshot. Invalid layouts/worlds return `WorldValidationError` with a preserved schema cause; operation errors identify the failed destination | Invalid configuration cannot escape as an unchecked constructor exception, and error references support the action that failed |
| Settings | A tagged key fixes the value schema and scope; a recorded change carries actor and time. Fallback values live separately in configuration | Changing a fallback cannot invalidate historical events. An undecided large-trade threshold remains absent from defaults instead of inventing one |

## Verification

The initial implementation passed these local commands on 12 October 2026 with Bun 1.4.0. Raw logs remain in ignored `work/stage-1/`; lint-fence fixtures and the validation-only bundle inspection are in `work/lint-fence/`.

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

The leaf run included 109 contract tests, 11 world tests, 20 lint tests and the existing wallet regression suite. Property inputs came from Effect Schemas with fixed seeds. Dependent records were generated from their component Schemas and assembled with matching references before JSON encode/decode equivalence checks. Those boundary properties were not proof that every invariant was tested independently: the subsequent review found that 20 of 24 deliberately removed checks survived. The review corrections and fresh mutation results are recorded below. World properties cover filling posts/floors, interleaved chains, stable stations, movement, plot assignment and malformed snapshots; the explicit default-capacity check admits 401 agents.

Actual Oxlint positive and negative fixtures were also run: the neutral fixture passes and the chain-specific fixture reports four expected diagnostics. A validation-only bundle passed the signer's module fence (one emitted module, 94 mapped sources), confirming that the wallet subpath does not load transaction construction or launchpad SDK code. The lint analysis follows local Schema bindings; arbitrary generated constraints and cross-file factories still require review.

Independent reviews found and resolved duplicate wallet IDs, an invented setting default and non-web source URLs. Newline identifier regressions confirm that the existing anchored patterns already reject terminal line separators; no redundant parser was retained.

On 13 October 2026 floors moved from stacked levels to side-by-side indices around the lobby (see the [decision log](decisions.md#product)). Each floor now carries an index and a fixed origin. The first four floors share an edge with the lobby, later floors fill each ring edges before corners, and every floor shares an edge with the lobby or an earlier floor. Origins are whole multiples of a footprint sized to hold a full floor of posts with one spacing of aisle, so they involve no trigonometry and no two footprints overlap. `format:check`, `typecheck`, `lint`, `build` and `test:native` passed again. `test:leaf` passed 234 tests with 10,590 assertions; the two new world tests cover the plan and the footprint for every post count from 1 to 128. In `test:flow` the shell flow passed and 49 of 52 renderer tests passed. The machine was under heavy concurrent browser load (load average about 20), and three timing checks failed. The workbench bundle the renderer tests serve is byte-identical to the previous commit's, since the web app imports neither changed package, and that unchanged code also failed the flight-timing check under the same load. Rerun the renderer suite on an idle machine before merging.

## 13 October review corrections

The side-by-side floor change was reviewed and retained. The corrections above tighten wire formats, authority references, piece bindings and spatial validation. Departure behavior, multi-chain desk policy, public receipt causes, self-credit and budget overshoot were left unchanged. `LobbyPlot` now uses `index` for its layout position, keeping numeric chain slots out of the shared contract.

The original 24 invariant-removal probes now all fail their intended assertions. Eleven additional contract mutations cover engraved-binding reachability, material tags, each clamp input, the triangle cap, texture uniqueness and signer-resolved withdrawal references. Twelve world mutations cover canonical positions, input validation, layout errors and error references. All **47 mutations were caught**, against passing baselines; failures were inspected for assertion evidence, not merely process exit. One loaded run also timed out in an unrelated test; rerunning that mutation alone produced only its expected assertion failure. Reproduction commands are `bun work/stage-1-review/mutate.ts`, `bun work/stage-1-review/mutate.ts M06` and `python3 work/review-world/mutations.py`; their isolated package copies, scripts and raw logs remain under those ignored directories.

The real Oxlint parser and scope engine now run in the leaf suite. Separate fixtures cover numeric `slot`, `blockNumber` variants, `sats`, filter bodies and regular expressions reached through literal, computed and nested members. Positive fixtures cover `10x`, `1920x1080`, `block`, moderation flags, harmless members and adapter-only encodings. The newly caught test RPC schema moved to the Solana adapter as `QuoteAccountRpcReply`; production still checks nonnegative slots and the legacy SPL owner, while replay construction remains behind `./testing`.

The reviewed source passed the following local checks with Bun 1.4.0. Raw logs are in `work/stage-1-review/`.

| Command | Review result |
| --- | --- |
| `bun install --frozen-lockfile` | Passed; no dependency changes |
| `bun run format:check` | Passed |
| `bun run typecheck` | Passed |
| `bun run lint` | Passed; 152 reasoned directives, including the new scoped lint-test runner boundary |
| `bun run test:leaf` | 302 passed, 0 failed; 11,123 assertions across 22 files |
| `bun run build` | Passed production web, Worker, chain bundles and fences |
| `bun run test:native` | All 3 native tests passed |
| `bun run test:flow` | Passed on the complete rerun: shell flow and all 52 renderer checks, including look and phone measurements (`test-flow-repeat.log`) |

The first full browser run passed the shell and 50 of 52 renderer checks; fast-glide observation and the flight's intermediate-zoom observation failed. Its captures and traces remain under `work/stage-1-review/renderer-full-attempt-1/` and `shell-full-attempt-1/`. The machine's observed load averages ranged from about 27 to 32. Both failed cases then passed unchanged under `bun run test:renderer --grep 'fast release glides|flight has zoom-out arc'` (`timing-isolated.log`), followed by the successful complete `bun run test:flow` rerun. The successful captures remain under `renderer-full-passed/` and `shell-full-passed/` in the same review directory. No renderer source or test thresholds changed.

Coordinate serialization matched byte for byte between Bun 1.4.0 and Node 22.13.1 for **22,912 cases** (`work/review-world/coordinate-comparison.txt`). Station offsets use fixed-point addition before division. Frozen-input probes and a maximum-layout overflow probe with 1,537 agents also passed; the latter took 28.6 seconds on the loaded host and is not a performance acceptance result. Snapshot checks establish consistency with the current layout; historical configuration immutability still requires the recording/service boundary. Instrument checks establish graph reachability, not mathematical sensitivity to an input.

No hosted deployment, provider call, real-money action, art approval or Stage 0 completion is implied by these checks. The new contracts and world model are not yet wired into the production app; the local browser flow checks the existing synthetic shell and renderer, whose source is unchanged. Its retained shell screenshot was inspected and shows the labelled synthetic scene connected to the local Worker. Palette membership, external socket permissions, registry fit, driver evaluation and sandbox containment remain checks for later stages.

## 13 October follow-up: independent swap sides

A completion review found one remaining negative-test gap: swaps already checked both assets against their declared chain, but the tests and mutation probe only broke the buy-side chain check. A new seeded property leaves the buy valid and changes only the sell to a foreign chain. Production behavior is unchanged.

`bun test ./packages/contract/test/economics.test.ts` passed all 17 tests with 74 assertions. `bun work/stage-1-review/sell-chain-mutation.ts` passed its unchanged baseline, then removing only the sell-chain predicate failed the new named assertion. The proof uses an isolated package copy and restores it afterward; prior mutation evidence is retained. This adds one verified mutation to the earlier 47. Logs and the reproduction script remain in `work/stage-1-review/sell-chain-check/`, `sell-chain-check-economics.log` and `sell-chain-mutation.ts`.

Fresh `bun install --frozen-lockfile`, `bun run format:check`, `bun run typecheck`, `bun run lint`, `bun run test:leaf`, `bun run build` and `bun run test:native` passed. The leaf suite now has 303 passing tests and 11,124 assertions; all three native tests pass. Logs are retained in `work/stage-1-followup/`.

The first follow-up `bun run test:flow` passed health and 51 of 52 renderer checks. The flight test had already observed an extent above 21, then failed a second read after the moving camera fell below 21. `bun run test:renderer --grep 'flight has zoom-out arc'` reproduced that race alone. The test now retains the exact numeric sample that crosses the threshold in the browser. Its zoom threshold, polling interval, timeout, 600–1,200 ms timing and final camera assertion remain unchanged. An independent review checked those guarantees, and `bun run test:renderer --grep 'flight has zoom-out arc' --repeat-each 5` passed all five repetitions. Failed captures and the focused passing captures remain separately labelled in `work/stage-1-followup/`; production renderer source is unchanged.

After the sampling fix, the complete required sequence passed again: formatting, types, lint, all 303 leaf tests, production build, all three native tests, and `bun run test:flow` with health and all 52 renderer checks. Final logs are under `work/stage-1-followup/final-checks/`; passing browser artifacts are retained separately in `renderer-full-passed/` and `shell-full-passed/` under the follow-up directory. The shell capture matches the previously inspected synthetic health scene byte for byte. These results do not approve Stage 0 or authorize integration.
