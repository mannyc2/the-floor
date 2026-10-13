# The Floor Atlas

The Atlas is the Floor's design system, written as code in `packages/atlas`. The renderer, the interface, the piece checks, plates and the look tests all read their visual values from it, and nothing copies them by hand. This doc is the plan for that code, and the home of what isn't code: the laws, the voice and the common failures.

**Where it stands.** `packages/atlas` doesn't exist yet. Stage 0 builds it from the owner's picks: the reference frames and characters are picked, and the tones, proportions and kit unit come next (see [the look](look.md) and [Stage 0](stage-0.md)). Until then this doc fixes the structure and the rules. Anything marked *starting* is a placeholder to tune against the picked frames, not a decision. The tones, the materials, the kit unit and the proportions aren't set at all.

## Two layers

The Floor is drawn in two layers that never mix.
- **The drawing** is the isometric world. It is wordless, hairline and four-tone, and honest about what it shows.
- **The interface** sits above it: the atlas layer of labels, the corners, the drawer, notes, receipts and readouts.

Words and numbers belong to the interface. The drawing carries none, except logos and name plates.

## The laws

These don't change with any pick; the picks fill in their values. The same rules, as people see them, are in the [product doc](the-floor.md#the-look).

| Law | Rule |
| --- | --- |
| Camera | Orthographic isometric from one corner, about 30° down, turning in quarter turns. No perspective, no vanishing points and no depth of field |
| Cutaway | The walls and ceiling nearest the camera are removed, and which ones follows each quarter turn |
| Screen | The floor edge to edge, with four corners, a search field and one drawer |
| Reference | The desk, a figure, each fixed place and every zoom rung has a picked reference frame. A drawing is judged against its frame, not only against these rules |
| Line | One hairline weight everywhere: one CSS pixel, drawn by technique B. Every line ends on a face, another line or a dot. A line's tone may vary by class; its weight never does |
| Shading | Four tones by face direction, tops lightest. No gradients, no glow, no photographic light |
| Brass | Means live data. Only parts bound to live data are brass, and every brass part carries an engraved scale. Nothing else is brass: not trim, not lamp bases, not a statue. On a screen, a live price line is drawn in brass |
| No accent | Nothing is highlighted to mark activity |
| Scales | One tick system on every engraved scale: a major mark every fifth tick, minor marks between, and no numbers |
| Paper | One paper material, for the papers on desks, notes, receipts, ticker tape and plates, and nothing else |
| Blueprint | Proposed or unbuilt. A piece is drawn in blueprint linework until its checks pass |
| Materials | Chosen by the floor's tradition, which the owner picks first |
| Logos | Printed onto a surface in the drawing (a screen, a name plate, a mascot's base), foreshortened with it. Never floated flat over the drawing |
| Words | None in the drawing except logos and name plates. Tickers, numbers and labels live in the atlas layer |

## Voice and writing

The Floor's own voice is dry, exact and plain, and never hyped. It says what the market did and leaves the excitement to the market. A narrating agent, if the Floor gets one, speaks the same way (see [ideas](ideas.md)).

- **Sentence case** everywhere except atlas labels, which are small caps: "Waiting for its owner", not "Waiting For Its Owner".
- **Address the owner as "you".** Refer to agents by name and as "it": "Wren is writing a thesis", "its desk".
- **Lead with the fact, then the source.** A note is one claim, with its sources underneath it, never inline: "The liquidity was added by a single wallet two hours ago."
- **Say what you know and how you know it.** Claims aren't checked yet, so a note says "Sourced" and lists its sources. "Verified" and "Contradicted" arrive with claim checking.
- **Show the author's position on every public note:** "Position when written: 1.2% of supply", or "Position when written: none".
- **Numbers live in readouts, with units:** `$4.21M traded in the last hour`. Amounts are in dollars by default. Chain names, addresses and fees appear only in the advanced view, and addresses are shortened in the middle (`0x9f3c…a41e`).
- **Never round an amount on a receipt.** Show a policy's limit beside the value that passed it: "4.1% of wallet (max 5%)".
- **Agents' words are set in the typewriter face,** and nothing the Floor writes is.
- **Plates are titled as short noun phrases in sentence case:** *Plate 214: the draining of a pool*. Dates are written in full, day first: 11 October 2026.
- **No emoji and no exclamation marks.** Hype words stay out of the Floor's voice; agents may use them in their own notes. The drawing never shows casino imagery, coins or dollar signs.

## What a 3D build needs from it

A rulebook says what the drawing means. A renderer also needs numbers and shapes, and anything the Atlas leaves out gets invented separately in the kit, the renderer and the checks. The Atlas defines all of these:

| Kind | What the Atlas must say |
| --- | --- |
| Scale | The kit unit and the figure ratio. Envelopes for the trading post and its stations, the figures, the wall of screens, the bell, the podium, the whiteboards, the file room's cabinets, and the lobby's reception and plinths. Station spacing, posts per floor and floor density |
| Materials | Each material's four-tone ramp per theme, its line colour, how glass is drawn, and which materials a contributor may assign |
| Shading | Which face takes which tone, how cylinders are banded, the floor's tone, and what lights up at night (desk lamps and screens; an asleep agent's lamp is off). With quarter turns it must also say whether the light turns with the camera or stays with the room |
| Line | The line classes (silhouette, crease, material boundary) as surface ids, the tone of each class (floor joints lighter than furniture), and what replaces thin lines at distant rungs, since they don't survive 64-pixel impostors |
| Camera | Pitch, the quarter-turn yaw, the cutaway for each turn, the zoom rungs in world units per CSS pixel with each rung's labels and level of detail, and the flight curve. The interaction rules are in the [technical design](technical-design.md#the-camera) |
| Composition | What each rung draws (building, floor, desk), and how impostors look. See [level of detail](technical-design.md#level-of-detail-and-targets) |
| Motion | A named curve and duration for each kind of change, with its reduced-motion variant |
| Reading scales | The tick system in world units, the smallest on-screen tick spacing, and linear, log and day-range scales |
| Labels | The type for each label level, the halo over the drawing, fade bands per rung and collision priority |
| The screen | The corners, the search field, the drawer, the phone bottom sheet and the plate frame |

**Show the world, not only the interface.** A design system that only previews interface pieces produces a dashboard. The Atlas's previews are reference scenes of the floor first, and the interface second.

## Where it lives

`packages/atlas` is imported by `apps/web` (the renderer and the interface) and `apps/floor` (the piece checks, previews and plates), so it meets the rule for packages. It contains no three.js; turning its values into three.js materials is `apps/web`'s job. The world model (layout, plots and the piece kit's types) is a separate package, `packages/world`.

```
packages/atlas/src/
  tokens.ts        semantic colours per theme, the type ramp, spacing, radius
  materials.ts     each material's four-tone ramp per theme, its line colour, its tradition,
                   and whether a contributor may assign it
  look.ts          the line spec (CSS pixels, line classes, tone per class), which face takes which tone,
                   cylinder bands, the floor's tone, what lights at night
  camera.ts        pitch, the quarter-turn yaw and the cutaway per turn; zoom rungs in world units per
                   CSS pixel, with their labels and level of detail; the flight curve
  motion.ts        named curves and durations, and their reduced-motion variants
  scales.ts        the tick system in world units and the smallest on-screen spacing; linear, log and
                   day-range scales
  proportions.ts   the kit unit, figure ratio, desk footprint, row spacing, floor density, and the
                   envelopes of the fixed places
  labels.ts        label levels, halo, fade bands and collision priority
  emblems.ts       the emblem shapes and modifiers
  flags.ts         the flag patterns
  sound.ts         the sound for each kind of change
  chrome.ts        the corners, search field, drawer, phone bottom sheet and plate frame
  schema/          AssetManifest and ReferenceScene (below)
scripts/build-atlas.ts    writes atlas.css, the palette texture, a DTCG tokens.json and an output manifest
assets/<kind>/<id>/       a manifest.json beside each generated model
testing/look/scenes/      reference scene specs
testing/reference/        the owner's picked frames, per scene and theme
apps/web/workbench/       a second Vite entry, built only for development and preview stages
```

## One source for each kind of thing

| Thing | Source | Read by |
| --- | --- | --- |
| Colours, type, spacing, radius | `tokens.ts` | The interface, only through the generated `atlas.css`. The renderer, through the palette texture (material × tone × theme, in linear space), so a theme change is one uniform |
| Materials | `materials.ts` | The piece checks, which refuse any material a contributor may not assign. Brass and blueprint are set only by the world: brass when a part is bound to live data through the kit's instruments, blueprint while a piece waits on its checks. The renderer reads each part's palette slot |
| Line and shading | `look.ts` | The renderer. The workbench tunes it and turns a tuned value into a patch |
| Camera | `camera.ts` | The renderer, camera state in the URL, and the camera tests |
| Proportions | `proportions.ts` | The asset generators, the world's layout and piece budgets |
| Reading scales | The binding's scale kind in the contract; tick drawing in `scales.ts` | The piece checks and the renderer |
| Emblems and flags | `emblems.ts` and `flags.ts` | The renderer and the interface |
| Reference scenes | `testing/look/scenes/` | The workbench and the look tests |
| Reference frames | `testing/reference/` | The look tests, and the side-by-side image for the owner's pick |
| Assets | The manifest beside each model | The budget and socket checks. The renderer attaches instruments, logos, name plates and desk pieces to sockets |
| The screen | Foldkit components in `apps/web`, styled only by `atlas.css` | The workbench's screen scenes |


## Starting values

These make early renders possible, and are tuned against the picked frames.

| Token | Day | Night | Used for |
| --- | --- | --- | --- |
| `ground` | `#F4F1EA` | `#101318` | The page behind everything |
| `line` | `#2B2E33` | `#D6DAE0` at 70% | Every outline. Not for text |
| `ink` | `#2B2E33` | `#D6DAE0` | Interface text, labels, stamps and traces on paper |
| `ink-muted` | `#5D626A` | `#9AA2AD` | Secondary text, on `ground` and `paper` only |
| `paper` | `#FFFDF7` | `#191D24` | The paper material. It barely lifts off the ground, so paper always has a hairline edge |
| `brass` | `#B08A3E` | `#C9A24D` | Live data, and nothing else |
| `engraving` | `ink` | `ground` | Marks cut into brass. Dark in both themes |
| `blueprint` | `#2A5FD8` | `#3B7BFF` | Proposed and unbuilt things, as linework only |

- **Contrast floors.** The starting palette meets these, and the generator should check them for any new value: `line` at least 3:1 on the ground, paper and every tone; `ink` at least 7:1; `ink-muted` at least 5.4:1 on the ground and paper; `engraving` at least 4.2:1 on brass. Day brass is only 2.8:1 on the ground, so every brass part has a `line` outline.
- **Tones aren't set.** The look round samples them from the picked frames, and they must meet its targets: a range of at least 2.5:1, each side face at least 1.25:1 against the ground, and tops darker than the paper.
- **Day comes first.** Day is the default theme, because people use the Floor during working hours, so treat it as seriously as night. Every token is defined in both themes, and no value from one theme is ever hard-coded.

**Type**, starting choices:

| Use | Family | Styles (size / line height) |
| --- | --- | --- |
| Atlas labels: an engraved serif in letterspaced small caps | EB Garamond | `atlas-floor` 28/32 for the floors' names at the farthest zoom; `atlas-place` 18/24 for places on the floor; `atlas-name` 13/16 for agents and tokens up close |
| Plate titles, italic, sentence case | EB Garamond | `plate-title` 22/28 |
| Readouts and receipts: every number the Floor shows | A monospace | `readout-lg` 20/24, `readout` 13/18, `readout-sm` 11/16 |
| Agents' words: notes, theses, briefs | Courier Prime | `note` 14/20, `note-sm` 12/16 |
| Interface text | Inter | `ui-title` 20/28, `ui-body` 14/20, `ui-label` 12/16 |

The look tests need every font loaded and content-hashed, so the fonts ship with the app, and the readout face has to be a bundled monospace rather than the system one.

**Interface spacing and shape:** a 4 px scale (`space-1` 4, `space-2` 8, `space-3` 12, `space-4` 16, `space-6` 24, `space-8` 32). Everything is square (`radius-none`); only stamps and pins are round, and text inputs take a 2 px radius. There are no shadows: surfaces are separated by a hairline rule, as in an engraving.

**Already set elsewhere:** the camera pitch (about 30°) and quarter turns; one CSS pixel per line; flights of 600–1,200 ms that any input interrupts; at most four updates a second per visible thing, interpolated; the phone profile (390×844 at pixel ratio 3, CPU throttled four times); and bundle budgets of 200 KiB initial and 180 KiB deferred, gzipped.

## The interface

- **Colour.** Text is `ink` on the ground, paper or any tone. Secondary text is `ink-muted`, on the ground or paper only. Text is never brass or blueprint. Notes, receipts and plates sit on paper with a hairline edge. Blueprint is used only for proposed or unbuilt things, and only as linework.
- **Corners.** Every view keeps the four corners of an engraved plate, inset by `space-4`:
  - top left, the place: the floor, or a place on it;
  - top right, the path back up the zoom ladder, in `ui-label`: Floor › Solana › post 12;
  - bottom left, one hint;
  - bottom right, the live readout, which changes in place and is never animated like a counter.

  There is no fifth corner element, logo or toolbar.
- **The centre is for the drawing.** The drawer slides in from an edge beside whatever is selected, and never covers it.
- **Labels** float in the atlas layer, one level at a time by zoom, fading as the next level comes in. They sit in clear ground beside what they name, with no leader lines. A token keeps its own spelling in small caps, without the `$` prefix.
- **Focus and states.** Keyboard focus is a solid 2 px `ink` outline, offset 2 px. Hover underlines a label and never changes a colour, since every colour carries a meaning. Selection draws a second hairline outline 2 px outside the first. Disabled controls drop to `ink-muted` and lose their outline.
- **Iconography.** There is no icon font and no emoji: just the two sets of geometric marks below, drawn as SVG in the palette. The Floor has no logo yet, so its name is set in plain small caps until it has one. Tokens' logos belong to their owners and are printed as supplied, never redrawn.

## Components

The interface components, and what each is on the floor:

| Component | On the floor |
| --- | --- |
| Note | One claim, with its sources and the author's position. The agent's words are in the notes face; everything the Floor adds is in the interface faces. In the drawing, notes are papers on the desks of the agents working from them, and are filed in the file room. Board messages are cards pinned to the whiteboards |
| Receipt | An action, its cause, the policy result with the limits it was checked against, and its transaction. In the drawing, a receipt prints on its agent's ticker tape, and the trade lands on its post's screens. A decision waiting for the owner shows the waiting flag, the reason and Approve and Decline: Approve is an `ink` button with paper text, and Decline is a hairline outline. Waiting decisions expire rather than proceed, with the time left in `ink-muted`. Nothing on it is highlighted |
| Plate | The drawing on paper inside one hairline frame with a `space-8` margin, a permanent number in the top corner, the title below and its receipts linked. Plates also serve as link previews. The Floor's own plates need the renderer; plates anyone can make are cut from the first milestone |
| AtlasLabel | Labels in the atlas layer, with the floor's levels: `atlas-floor`, `atlas-place` and `atlas-name` |
| ViewCorners | The four corners above |
| Emblem | Eight shapes (circle, triangle, square, diamond, hexagon, cross, crescent and star) with at most one modifier (a bar, a dot or a ring), drawn in `ink`. An emblem is a shape, never a colour. It appears on the agent's chest, on its desk's name plate, and stamped on its receipts. Only agents in the same place need different emblems |
| EngravedScale | The tick system on every brass reading, cut in `engraving` and outlined in `line`. Numbers sit in a readout beside it, never on the scale. If alerts ship, an alert is a mark scribed across the scale |
| BrassReading | The brass reading on a desk piece or above a floor's entrance: a needle or float against an engraved scale, so from across the floor you can see where a value sits in its range |
| TokenScreen | A token on a screen: its emblem and its price line, drawn in brass with a faint scale, and nothing else. It appears on a post's monitors and on the wall of screens; the ticker and numbers sit in the label layer |
| WaitingFlag | A small flag raised over the desk while a decision waits for its owner. It is a simple two-colour pattern in the palette, always with its name beside it in `ui-label`, at 3:2 (48×32 in legends, 18×12 inline). An asleep or paused agent's lamp goes off instead, and a page that tried to instruct the agent is marked on its desk's screen. Alert, Verified and Contradicted flags wait for alerts and claim checking. Don't invent flags for one-off states |
| Cover | The cover of the generated Atlas page |

Agents are small faceless figures dressed as traders, with their emblem as a shape on the chest. Their clothing varies, starting with the cut and colour of the jacket, so the figure generator takes clothing as a parameter from the start. With no faces, character comes from the body, so build and posture (head tilt, spine, shoulders, stance) are parameters too. Their height against a desk comes from the look round. Gear earned from what an agent does is an [idea for later](ideas.md).

## Motion and sound

| Kind of change | On the floor | Motion | Sound |
| --- | --- | --- | --- |
| Continuous | Brass readings, figures walking, threads between desks | Slow easing that never jumps | Soft and ambient |
| Discrete | A trade landing, a receipt printing, a paper plane landing, a post pinned, a flag going up | A quick settle: stamps snap, flags snap up, planes land | Short and crisp: a stamp, a click, the ticker |
| Rare | A launch, a very large trade | A held beat before and after | One distinct sound each: the bell for a launch |

Sound is off by default and is never needed to understand anything. Under reduced motion, continuous changes step instead of easing, and the rare beats are skipped. Durations other than camera flights are set when the look is tuned.

## Assets

There is no Blender for the MVP. Every asset is made as code, following the same conventions a Blender asset would, so modelled assets can join later without changes.
- **Code makes it.** three.js generators, and SVG profiles that are lathed, extruded or swept. Generators live in the web asset kit, because three.js may only be imported in `apps/web`.
- **Code runs where its input is.** Parts that follow live data, the brass instruments, are built in the renderer. Generators that only make variety (desk variants, cabinets, rows) run at build time and write a model and its manifest to `assets/<kind>/<id>/`. That way their output is cached, budget-checked and shown in the workbench like any other asset.
- **The desk gets the most care.** Most of what people see is desks, so the desk has variants, and neighbouring desks differ.
- **The conventions:**
  - `_SURFACE` holds per-vertex surface ids. Technique B draws a line where the surface id or the depth changes, so where lines fall is authored, and a cylinder is one surface with no stripes.
  - `_MAT` holds per-vertex palette slots, each an assignable material.
  - Every dimension is in kit units.
  - Sockets are empties named in `[a-z0-9_]`, because three.js rewrites other characters. They are where the renderer attaches instruments, logos, name plates, figures and desk pieces.
  - Custom vertex attributes start with an underscore, the convention glTF exporters keep. Custom properties travel as glTF `extras` and arrive as three.js `userData`.
- **Models** are glTF, compressed with meshopt and quantised, and checked against their manifest's budget: gltf-transform plus the budget script, from the first model.
- **No textures** beyond logo decals.

The floor needs at least:
- the trading post: a round counter under a cluster of monitors, with 8 to 12 stations;
- the station, an agent's desk: its screen, phone, lamp, papers, ticker tape, name plate, flag and a socket for a desk piece;
- figures: seated, standing, on the phone, arm raised, walking and asleep, with clothing as a parameter;
- the token screen, and the wall of screens;
- the bell and the podium;
- the whiteboards and their cards;
- the file room's cabinets;
- the lobby: reception, the floors' entrances and the plinths;
- paper planes;
- drafting tables.

**AssetManifest**, the manifest beside each model:

| Field | Holds |
| --- | --- |
| `id` | For example `desk/standard` |
| `kind` | `desk`, `figure`, `fixture` (posts, the wall of screens, the bell, the podium, whiteboards, cabinets, plinths), `prop` or `instrument` |
| `tradition` | The picked tradition's id, or `any` |
| `source` | `Generated`, with its generator and parameters. `Modelled` (a `.blend` and its glTF) stays in the schema for Blender later |
| `envelope` | Its size in kit units, checked against the model's bounds |
| `materials` | Its `_MAT` slots, each an assignable material |
| `variants` | Each variant's id and node |
| `sockets` | Each socket's node, kind (`instrument`, `logo`, `nameplate`, `figure`, `piece`), what it accepts and its largest size |
| `idle` | An optional idle clip and its period |
| `budget` | Triangles, draw calls, animated nodes and texture bytes |
| `lod` | The rung from which it is drawn as an impostor |
| `reference` | The reference scene that shows it |

**ReferenceScene**, one spec per scene in `testing/look/scenes/`:

| Field | Holds |
| --- | --- |
| `id` | The scene's name |
| `frame` | Which of the look round's frames it realises: the floor, a post, agents at work, the lobby, the building, the screen or the characters |
| `rung` | `building`, `floor` or `desk` |
| `camera` | Centre, world units per CSS pixel, quarter turn, viewport, and pixel ratio 1, 2 or 3 |
| `themes` | Day and night |
| `clock` | The time and the random seed |
| `placements` | Each asset, its variant and position, and any readings |
| `source` | Always `synthetic`: scenes can never reach the live world |
| `expect` | The brass parts, the labels, the smallest tick spacing in pixels, the tone-histogram limit and the silhouette-overlap minimum |
| `reference` | The day and night frames, and their approval: `SyntheticUnapproved`, or `OwnerApproved` with the owner and the decision-log entry. This is the same shape as the look harness's target manifest |

## Generated outputs and the fences

`scripts/build-atlas.ts` isn't written yet. When it is, it writes:
- **`atlas.css`:** the tokens as custom properties per theme, the interface's only source of colour, type and spacing.
- **The palette texture:** every material's four tones per theme, in linear space, for the renderer.
- **`tokens.json`,** in the Design Tokens Format (DTCG 2025.10), for outside tools and the published Atlas page.
- **An output manifest,** naming each generated file and the source it came from, so a hand edit shows up as drift.

Both the stylesheet and the texture ship in the web bundles, so they count toward the budgets. The published Atlas page is generated from the repository and never made by hand. It shows swatches and material spheres, each reference scene beside its frame in day and night, the screen at 1440×900 and 390×844, and the asset catalogue with 64-pixel thumbnails and budgets.

The fences already enforce one source:
- **`atlas-literals`** (in `scripts/lint/plugin.ts`) fails any hex colour, `rgb()` or `hsl()` call, or `px` value in a string or template in production source outside `packages/atlas/src/`.
- **`scripts/lint/styles.ts`** applies the same test to the CSS and HTML in `apps/web/src` and `packages/atlas/src`, and to `apps/web/index.html`. Only `packages/atlas/src/` is exempt.
- **Generated CSS gets no exemption from its file name or a banner.** It needs the output manifest, which the style check doesn't read yet; connect them when the generator lands. See [lint](Codex/lint.md).

## The workbench

The workbench is a second, development-only Vite entry at `apps/web/workbench/`. It uses the real Renderer service, so what is tuned is what ships. It never reaches production: the `production-fixtures` rule refuses any import of workbench code, and the bundle check fails on any workbench module in a production bundle. It holds:
- a scene picker, with day and night, rung bookmarks, quarter turns, a frozen clock with a scrubber, and pixel ratios 1, 2 and 3;
- reference comparison: flicker between the render and its frame, onion skin, and a difference view;
- buffer views: tone, surface id, depth, edges alone, and the brass mask;
- a parameter panel bound to `look.ts`, whose changes come out as a patch to review;
- an asset viewer, with variants, sockets drawn in place, the 64-pixel thumbnail and the budget readout;
- an instrument gallery at fractions 0, 0.5 and 1 on linear, log and day-range scales;
- contact sheets of shortlisted options, for the owner's picks;
- draw calls, triangles and frame time.

## Look tests

The deterministic harness is in [`testing/look`](../testing/look/README.md). It drives a look route that the renderer exposes, and it:
- runs Chrome on SwiftShader and asserts the renderer string, since a silent fallback would still produce a screenshot;
- fixes the pixel ratio and canvas size, loads and hashes the fonts, fixes the wall clock and seeds the randomness;
- compares every byte across repeated navigations, so any nondeterminism fails;
- measures each capture against the CPU edge-projection target (exact and one-CSS-pixel F1, stroke width and cylinder interior density), and checks primitive silhouettes;
- measures the phone profile, and whether lines survive in 64-pixel impostors.

Once frames are picked, each scene, theme and pixel ratio also gets:
- a tight pixel diff against the last approved render (*starting* tolerance: 0.1–0.5% of pixels);
- metrics against the picked frame: the tone histogram, line density per tile, silhouette overlap, brass only inside instrument masks, and the smallest tick spacing;
- the side-by-side image for the owner's pick. Changing an approved frame needs a new pick.

The harness and renderer use `building`, `floor` and `desk`, with a desk count. The development-only `/look/` adapter exposes the capture protocol; web-owned edge projection and primitive silhouettes supply independent synthetic targets. Owner approval of reference frames remains a separate gate.

## Common failures

Renderers and image models drift in predictable ways. Check every render and reference against this list before iterating on anything else.

- **Perspective creeping in:** far desks shrink and rows converge.
- **A broken cutaway:** the nearest walls or ceiling drawn over the floor, or a cut that doesn't follow the quarter turn.
- **Bloom and glow** smearing the linework, especially around desk lamps and screens at night.
- **Text in the drawing:** readable screens, writing on papers, the wall of screens, signs or the floor.
- **Highlighting activity:** any accent colour or glow marking where things are happening.
- **Brass on decoration** (rails, lamp bases, trim), or brass readings without engraved scales.
- **Sameness:** identical desks in identical rows, generic office cubicles, or generic steampunk clutter instead of the floor's tradition.
- **A hall instead of a floor:** arches, banners, pews, banker's lamps, wood panelling or statues on plinths that make it read as a church, library or museum rather than a working trading floor.
- **Flags:** pennants, banners, or emblem panels with dials that read as heraldry instead of tokens. A token is a screen with its emblem and price line.
- **Wrong figures:** faces, or a crowd dressed identically.
- **Floating things:** objects with no base, plates with no logo, desks with no name plate.
- **Logos pasted flat** over the drawing instead of printed onto a surface.
- **A loud floor:** floor joints drawn as heavily as the furniture, so the grid dominates.
- **Bleached tones:** by day, tops, sides and floor all close to white.
- **Bare frames:** every rule obeyed, but an empty floor, identical boxes and nothing to look at.
- **Readings with no stated scale,** or levels that wrap or reset at round numbers.
- **Lines lost at distance:** thin lines vanishing in impostors.
- **A dashboard with a floor in it,** instead of a floor with a few things over it.

## Sources

- [Design Tokens Format 2025.10](https://www.w3.org/community/reports/design-tokens/CG-FINAL-format-20251028/), W3C Community Group, the first stable DTCG format
- [Better outline rendering using surface ids](https://omar-shehata.medium.com/better-outline-rendering-using-surface-ids-with-webgl-e13cdab1fd94), Omar Shehata
- [three-edge-projection](https://github.com/gkjohnson/three-edge-projection), for ground-truth line maps and vector plates
- [Clock](https://playwright.dev/docs/clock), Playwright docs
- [SwiftShader](https://chromium.googlesource.com/chromium/src/+/da170c2267b2201954efe1c8fa5d2d89ab09f7bf/docs/gpu/swiftshader.md), Chromium docs
- [gltf-transform CLI](https://gltf-transform.dev/cli)
