# World layout proposal

**Unadopted.** The square spiral and grid remain the production layout. The [14 October decision](decisions.md#stage-1-groundwork) asks for seeded, irregular growth and for the owner to review it before adoption; this proposal is that candidate. Its generator is `packages/world/src/proposal.ts`, behind `@floor/world/proposal`, and `proposalLayout` implements the same `WorldLayout` seam as the square spiral. Nothing in production imports it, and the [development world](#flying-it) is the only place it is drawn.

One versioned, seeded integer plan fixes rooms, their shared doors, post anchors, named-place reservations and lobby plots. A room's footprint, posts, stations, reservations and incoming door are fixed when its blueprint is created; occupancy only reveals them. Each new room docks on the existing exterior by a finite, deterministic candidate search.

## Flying it

`bun run dev:world` builds the production viewer with a development-only layout switch, starts the local world test Worker on `FLOOR_WORKER_PORT` (default 19740) with a labelled synthetic world, and prints two URLs for the same world. Flags: `--floors N` occupied floors beside one blueprint (1–10, default 4), `--seed S` (default `20261014`) and `--layout proposal|grid`, which only chooses the URL printed first. One agent per occupied floor walks a named place, another post, a desk there and home every three seconds, so Follow has something to follow. Ctrl-C removes the Worker and its state.

A strip at the top of the page names the layout and links to the others; following a link reloads the same world without restarting it. The `scale` links set how H becomes viewer units:

- **pitch** (default) draws the 4.25H minimum post distance at the grid's 8-unit post pitch, so both layouts share one post density and the camera's rungs.
- **figure** draws one H at the Atlas figure height of 8 units, the conversion this proposal's renderer study used. Rooms are then about four times the grid's floors.

The viewer draws the proposal like the grid, with the provisional live floor: the kit's posts and stations and Roomy figures on timber room slabs, a paper lobby with low plinths for its plots, and paper footprints for unopened posts and the blueprint room. Built rooms and the lobby have low timber walls, cut away on the camera's side; shared walls open at each door over a steel sill. The five named places are simple furniture in existing slots (a steel wall of screens, a bell on a timber stand, a podium, file cabinets, a pinned board) backing onto the wing's outer wall. Agents at a named place stand at its reservation's centre facing it, so a walk to the board is visible; under the grid the drawer says the layout does not position it.

## What must remain true

- Every existing floor, post, station, plot and doorway keeps its identity and coordinates as agents and chains arrive.
- Each occupied room belongs to one floor and chain. Interleaved arrivals fill an existing room for their chain before opening the next. The next blueprint's geometry does not depend on the chain that later occupies it.
- Room interiors do not overlap. Every room has a doorway to the lobby or an earlier room and a reserved walkable route from it into its hall. Posts, reservations and lobby plots keep clear of those routes.
- Only occupied stations become station records, and exactly one future floor remains a blueprint.
- Coordinates are integers of a millionth of H. Construction, collision checks, ordering and serialization agree across engines; no clock, runtime randomness, renderer state or provider participates.
- Every search has a finite candidate set and explicit bounds.

## Audit against the picked frames

The floor, lobby and building frames are compositional evidence, not surveyed plans. The floor shows unequal post offsets, a stepped edge, an enclosed file area and a long screen edge; the lobby an entrance hall with an offset side area and several doors; the building dense rooms and unfinished space (its stacking and elevators are excluded by later decisions).

| Current rule | Disposition |
| --- | --- |
| Post anchors on a square spiral at pitch 8 | Replaced by seeded exterior growth with a minimum separation; indexed anchors and unchanged prefixes kept. The picked floor's posts do not stand in rows |
| One square footprint per floor on a grid | Replaced by a hall and side wing placed against actual existing walls |
| First four floors on the lobby, later ones edges before corners | First four direct lobby doors kept; later rooms dock where the exchange stays smallest. This replaces the 13 October grid order and needs the owner's review |
| Adjacency implies access | Replaced by a stored door on a shared wall segment with clear passages on both sides |
| Radius-2 station rings | Kept as indexed ring tables, scaled to the approved 1.49H stance |
| A full future post set from floor creation, one blueprint floor, chains reuse their floors | Kept |
| Lobby plots and named places have no positions | Each gets a reserved footprint outside the routes |

## The plan

- **Posts.** Post 0 is the room's origin. Each new anchor is chosen from twelve seeded displacements per existing anchor (four cardinal, eight others in the same annulus) keyed by their indices, so a rejected candidate never shifts later randomness. A candidate must lie outside the current hull and at least 4.25H from every anchor; the smallest resulting extent wins, then a seeded tie key, then the indices. The positive-x step from the anchor of greatest x always qualifies, so the search cannot run dry.
- **Rooms.** A hall encloses every 2H post reservation plus a 1H perimeter route. One seeded side wing, 3–6H deep and 5–9H long, holds the wall of screens, bell, podium, file room and board inside its own route. Half-bridges join the hall and wing routes.
- **Lobby.** Sized once from the first four room shapes and all 32 plot positions, so arrivals never resize it: a square hall and a side area. Plots are 1H footprints at least 1.75H apart; a world reveals a prefix.
- **Growth.** Rooms 0–3 dock on the lobby's four sides. Later rooms try every pair of exterior edges at least a door plus a wall long, aligning midpoints; the smallest exchange extent wins, then total extent, then distance from the lobby, then a seeded key and indices. A room docked on the exchange's greatest-x edge always fits, so growth cannot stall. Each door is 2H wide with clear passages on both sides.

## Scale and approvals

The approved Roomy values include a 1.49H station stance and a 4.25H neighbouring post pitch; the abstract world uses radius 2 and pitch 8, and no single scale maps both pairs. This proposal keeps the stance and reads 4.25H as a minimum post distance rather than a repeated pitch, which needs the owner's confirmation. The 2H post envelope, 1H routes, 2H doors, 0.12H walls and reservation sizes are provisional, not asset sizes or ergonomic clearances. Atlas values and the seven approved frames are unchanged.

## Trade-offs to look at

Figures are for seed `20261014` with the default 40 posts of 10 stations.

- **The lobby is large and empty.** It is sized for the four largest initial rooms and all 32 plots before anyone arrives: about 59H square, 3,542H², against about 1,400H² per room. Eight plots sit in its middle.
- **Spacing sits at the minimum.** Nearest neighbours are 4.25–5.33H apart, 4.53H on average, so a 40-post room reads as a loose, irregular crowd rather than rows, but also rather than the clusters of the floor frame.
- **Rooms are near-square at 40 posts.** Halls come out about 37H square with a 4–6H by 6–9H wing, so the irregularity is in the posts more than the outlines. Fewer posts per floor give more varied rooms.
- **Scale.** At the figure scale a room is about 295 units across against the grid's 72; at the pitch scale four floors and a blueprint span about 274 by 252 units.
- **Viewer limits.** Level of detail is Stage 2: far rungs fade each thing's inner outlines and keep silhouettes. The walls and place furniture are provisional blockout, and the lobby is a large empty paper floor.

## Adopting it

Adoption would replace the square spiral and grid together: `canonicalLayout` becomes this layout, the `World` contract's canonical coordinate checks follow it, the seed becomes part of a world's immutable layout input, and Stage 1, the technical design and the decision log change with it. Stored worlds cannot migrate silently; a recorded-format change needs its own decision. The cross-engine byte comparison is rerun on the adopted code.
