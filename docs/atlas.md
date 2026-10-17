# The Floor Atlas

The Atlas is the Floor's design system, written as code in `packages/atlas`. The renderer, the interface, the piece checks, plates and the look tests all read their visual values from it, and nothing copies them by hand. This doc is the plan for that code, and the home of what isn't code: the laws, the voice and the common failures.

**Where it stands.** `packages/atlas` holds plain tokens, materials, look, proportions and camera values. Approval history lives in the decision log and git; it is not part of runtime values. The remaining modules below are planned. On 13 October the owner approved corrected day material A and then night B: the shown material values, with the night line classes and flat lit lamp/screen faces. The preserved [day](../testing/reference/materials-day.png) and [night](../testing/reference/materials-night.png) frames have separate [day](../testing/look/scenes/materials-day.json) and [night](../testing/look/scenes/materials-night.json) approval scopes. The owner then picked [Roomy proportions and the kit unit](#approved-proportions-and-kit-unit--13-october-2026), approving `K = H/8` and nine ratios. Brass and engraving, figure/asset design, skin/hair/clothing materials, newly exposed or hidden material bands, final clearances, counts, physical scale and the interface remain open. Stage 0 still needs those reviews and the asset generators (see [the look](look.md) and [Stage 0](stage-0.md)). Anything marked *starting* remains a placeholder, not a decision.

The nine image-generated reference PNGs are preserved in `testing/reference/`. Their staged briefs in `testing/look/scenes/` hold the frame, image hash and available rendering inputs. Renderer-dependent fields remain tagged `Pending`; migrate the briefs to the executable `ReferenceScene` below when the picks and generators supply those fields. No placeholder camera or invented measurement stands in for missing evidence.

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
| Shading | Four tones by face direction, tops lightest. No gradients, no glow, no photographic light. Measure the 2.5:1 body range from the top to a visible side; a hidden underside cannot supply the range |
| Brass | Means live data. Only parts bound to live data are brass, and every brass part carries an engraved scale. Nothing else is brass: not trim, not lamp bases, not a statue. On a screen, a live price line is drawn in brass |
| No accent | Nothing is highlighted to mark activity |
| Scales | One tick system on every engraved scale: a major mark every fifth tick, minor marks between, and no numbers |
| Paper | One paper material, for the papers on desks, notes, receipts, ticker tape and plates, and nothing else |
| Blueprint | Proposed or unbuilt. A piece is drawn in blueprint linework until its checks pass |
| Materials | Chosen by the floor's tradition, which the owner picks first. The timber floor is its own material, separate from page ground and counter timber. Every built reference scene includes it; isolated character sheets and the tiled moments frame need that correction |
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
| Shading | Which face takes which tone, how cylinders are banded, the floor's tone, and what lights up at night (desk lamps and screens; an asleep agent's lamp is off). With quarter turns, side tones turn with the camera while tops and undersides follow world Y ([16 Oct pick](decisions.md#the-look)) |
| Line | The line classes (silhouette, crease, material boundary) as surface ids, the tone of each class (floor joints lighter than furniture), and what replaces thin lines at distant rungs, since they don't survive 64-pixel impostors |
| Camera | Pitch, the quarter-turn yaw, the cutaway for each turn, the zoom rungs in world units per CSS pixel with each rung's labels and level of detail, and the flight curve. The interaction rules are in the [technical design](technical-design.md#the-camera) |
| Composition | What each rung draws (building, floor, desk), and how impostors look. See [level of detail](technical-design.md#level-of-detail-and-targets) |
| Motion | A named curve and duration for each kind of change, with its reduced-motion variant |
| Reading scales | The tick system in world units, the smallest on-screen tick spacing, and linear, log and day-range scales |
| Labels | The type for each label level, the halo over the drawing, fade bands per rung and collision priority |
| The screen | The corners, the search field, the drawer, the phone bottom sheet and the plate frame |

**Show the world, not only the interface.** A design system that only previews interface pieces produces a dashboard. The Atlas's previews are reference scenes of the floor first, and the interface second.

## Where it lives

`packages/atlas` is imported by `apps/web` for the renderer and interface. Its package boundary keeps three.js out of the shared values; `apps/floor` will consume the same exports when the piece checks, previews and plates are built. It contains no three.js; turning its values into three.js materials is `apps/web`'s job. The world model (layout, plots and the piece kit's types) is a separate package, `packages/world`.

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
assets/<kind>/<id>/       a manifest.json beside each generated model
testing/look/scenes/      reference scene specs
testing/reference/        the owner's picked frames, per scene and theme
apps/web/workbench/       a second Vite entry, built only for development and preview stages
```

## One source for each kind of thing

| Thing | Source | Read by |
| --- | --- | --- |
| Colours, type, spacing, radius | `tokens.ts` | The renderer writes the sRGB values directly into an RGBA8 palette texture; a theme change is one uniform. Interface CSS variables arrive with the interface |
| Materials | `materials.ts` | The piece checks, which refuse any material a contributor may not assign. Brass and blueprint are set only by the world: brass when a part is bound to live data through the kit's instruments, blueprint while a piece waits on its checks. The renderer reads each part's palette slot |
| Line and shading | `look.ts` | The renderer. The workbench tunes it and turns a tuned value into a patch |
| Camera | `camera.ts` | The renderer, camera state in the URL, and the camera tests |
| Proportions | `proportions.ts` | The asset generators, the world's layout and piece budgets |
| Reading scales | The binding's scale kind in the contract; tick drawing in `scales.ts` | The piece checks and the renderer |
| Emblems and flags | `emblems.ts` and `flags.ts` | The renderer and the interface |
| Reference scenes | `testing/look/scenes/` | The workbench and the look tests |
| Reference frames | `testing/reference/` | The look tests, and the side-by-side image for the owner's pick |
| Assets | The manifest beside each model | The budget and socket checks. The renderer attaches instruments, logos, name plates and desk pieces to sockets |
| The screen | Foldkit components in `apps/web`, using Atlas values | The workbench's screen scenes |

## Starting values

The approved drawing values are recorded in the [day](../testing/look/scenes/materials-day.json) and [night](../testing/look/scenes/materials-night.json) material approval briefs. The table distinguishes those values from provisional brass/engraving and the unpicked interface and blueprint seeds. The picks do not approve an interface or any unshown material face.

| Token | Day | Night | Used for |
| --- | --- | --- | --- |
| `ground` | `#F1DFC4` — approved | `#0D0F10` — approved | The page behind everything |
| `line` | `#080808` — approved | `#C2CDD7`, opaque — approved ordinary class | Ordinary outlines. Not for text |
| Dark line classes | Day uses its approved near-black line | `#080808`, opaque — approved surface and instrument-contour classes | Paper/light-face edges and complete instrument contours; engraving itself remains provisional |
| `ink` | `#2B2E33` — proposed | Unpicked; separate light-on-ground and dark-on-paper values required | Text on its own ground, paper or label halo; never a constraint on wordless materials |
| `ink-muted` | `#505050` — proposed | Unpicked; each actual text background needs its own check | Secondary text, on `ground` and `paper` only; the day proposal passes on the approved surfaces |
| `paper` | `#EBD9BC` — approved | `#AFA79B` — approved | The paper material, compared with the floor and countertops it lies on, with a hairline edge |
| `brass` | `#FED683` — provisional dial top | `#9F8655` — provisional dial top | Live data, and nothing else; final colour waits for real instrument geometry |
| `engraving` | `#080808` — provisional | `#080808` — provisional | Marks cut into brass. Dark in both themes; approved line treatments do not approve engraving on real instruments |
| `blueprint` | `#2A5FD8` — starting | `#3B7BFF` — starting | Proposed and unbuilt things, as linework only |

- **Text surfaces.** `ink` reaches at least 7:1 on ground, paper and the actual opaque label halo. Text never sits directly on a material tone. A name plate is its own surface and must reach 7:1 against its own ink. `ink-muted` keeps 5.4:1 on ground and paper only. Text is never brass or blueprint. These checks do not force timber, steel, glass, brass or clothing to become text backgrounds.
- **Visible outlines.** A near-black day line reaches at least 3:1 against ground, paper and every visible material face, using the final composited colour. The underside is exempt only while hidden; if a view exposes it, it must pass. A lighter floor-joint line is permitted only if it still reaches 3:1 on the floor; weight stays one CSS pixel. A token pick does not prove a new material or view passes; check every visible face in the rendered scene.
- **Tone structure.** The body ramp keeps at least 2.5:1 from top to darkest visible side, each visible side keeps at least 1.25:1 against page ground, and tops remain darker than paper. Each material has its own directional slots; this does not demand a 2.5:1 range inside a sheet of paper or a flat glass screen. Record the scope and measured visible faces of every candidate.
- **Paper on its support.** Paper is lighter than the actual timber floor and each countertop it lies on, and always has a hairline edge. There is no paper-versus-page-ground brightness requirement. A failing support pair is corrected in that pair, rather than by bleaching every material.
- **Brass separation — provisional working threshold.** Brass reaches at least 1.5:1 luminance contrast against every actual mounting or adjoining support face, including glass behind a price line, and retains its near-black outline. Engraving reaches at least 4.2:1 on the brass face that carries it. Check pairs in the scene, not just brass against the page ground; an outline alone does not pass separation. A new mounting material needs a new pair check. Use 1.5:1 as the working material-separation floor while developing the real instruments. The owner approved the other shown day and night materials but left brass and engraving provisional; this is not final approval of their colours, appearance or the threshold on unseen instrument geometry. The value is not a text-accessibility standard.
- **Day and night are separate picks.** Corrected day A and the subsequently selected night B are approved within their recorded scopes. The night options came from those same material identities: lights down, with desk lamps and screens lit, without a generated night reference. Their renderer evidence and the owner’s top-row choice are recorded separately. The Atlas defines both themes, and no value from one theme is hard-coded into the other.

**Approved night treatment.** The owner picked night B from two derived options, both of which keep the existing day values unchanged. Dark room materials use a pale outline, while paper, lamp/screen light faces, brass and engraving use an authored dark stroke class at the same one-CSS-pixel weight. Paper and light faces keep their stroke on the current face, so their dark line does not spread onto a dim neighbour. A separate instrument contour class keeps brass and engraved ticks dark along the complete outline, including its edge pixels on the verified mounting face. That adjoining face must also meet 3:1 against the dark stroke; new instrument geometry needs a fresh boundary check. Flat lamp and screen faces represent emitted light with solid colours, without gradients, glow or light pools; they are not raised material bodies required to supply a 2.5:1 ramp. The ordinary material bodies, visible sphere band, paper supports and provisional brass mounts retain their numerical checks.

Night paper is light enough to admit dark text at 7:1. The dark page ground needs a separate light ink treatment; a single shared night ink cannot satisfy both surfaces. Any future surface-specific ink and muted-ink variants must meet the existing 7:1 and 5.4:1 thresholds on their actual backgrounds. These studies show no interface text, halos or name plates and approve none of those values. The owner approved the shown night material values, line-class treatment and light-source colours; the approved day reference remains exact. Brass and engraving remain provisional, and this material pick does not approve geometry or the interface.

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

## Reference colour audit — 13 October 2026

All nine owner-picked PNGs were inspected, including cropped views of every retained sample. `bun work/look/tones/rules-003/audit.ts` reproduces the coordinate-labelled patch medians, linear-sRGB luminance ratios and image hashes in `work/look/tones/rules-003/reference-samples.json`; `crops.ts` renders the inspection sheets. The full reasoning is retained in `work/look/tones/rules-003/rule-audit.md`. These are observations of textured reference pixels, not recovered palette tokens, authored line layers or an approval. The original day-image audit contains no interface, live-binding or night evidence and cannot establish every orientation. The later night renderer pick is recorded separately below.

The post's sampled ground is `#F1E0C4`, floor `#B48450` and counter top `#BF8D57`: three different surfaces. Its paper is slightly darker than page ground but lighter than its supports. The confirmed gauge/support pair is only 1.010:1, supporting a correction under the proposed 1.5:1 brass rule. Its dark glass can reach only about 1.67:1 even against black, so the retained 3:1 visible-line rule requires lifting that glass. The timber's top-to-darkest-visible-side range is 2.933:1; a second lighter side at 1.867:1 does not invalidate the range. Other deficient ramps remain corrections below.

### Every colour rule has a disposition

| Existing rule | What the references support or contradict | Disposition |
| --- | --- | --- |
| Four tones by face direction, tops lightest | Directional shading is clear; clean four-value bands are not recoverable. Moods and moments casing pairs lack 2.5 range. Some local exterior stone samples are not top-lightest. | Retain. Correct source ramps on renderer; do not claim exact four-tone source compliance. |
| No gradients, photographic light or glow | All frames have textured/light-varying regions. Lobby's gold globe has Y=.694 highlight and .083 shadow; post lamp pools and lobby directory glow are obvious. | Retain. Remove modeled gradients, reflections and glow in asset/render translation. Flat face bands only. |
| Visible range >=2.5; each side >=1.25 ground; top darker than paper | Post visible timber range2.933 passes; verified post/moods sides clear ground. Some sampled steel/desk pairs fail2.5. Sampled paper-bearing tops are darker than paper. | Retain; reference corrections for deficient ramps, and each actual rendered face tested. No scene-wide pass from incomplete orientation evidence. |
| Line >=3 on every tone/ground/paper | Source black glass and several dark timber/steel/jacket faces cannot reach3 even against black; image line alpha is unknown. | Retain near-black visible-face floor. Lift deficient faces; truly occluded undersides only exempt. |
| Line tone varies by class; floor joints lighter than objects | Timber joints generally appear weaker than furniture contours, but no clean line layer permits an exact automated source certification. | Retain; test classified renderer line pixels. Do not infer from arbitrary dark source pixels. |
| Ink >=7 on any tone | Directly conflicts with picked dark material values; text is generally absent from world bodies. | Change to designated label surfaces; nameplate has its own surface and ink. |
| Ink-muted >=5.4 on ground/paper only | No true secondary-text interface is present in the images. Four corners in screen are placeholder strokes, not text. | Retain; verify token pairs separately. Source evidence unavailable. |
| Text never brass or blueprint | Picked world screens/papers have writing in post/agents/screen/cast/moments; no compliant interface typography proof. | Retain; remove world text except logos/nameplates and put text on allowed label surfaces. |
| Receipt Approve button ink fill with paper text | Not represented. This also conflicts with the new text-on-ground/paper/halo restriction. | Changed to paper with ink text and a stronger ink border; Decline is an outline on paper. |
| Brass only live data, every brass part engraved | Post has a recognisable engraved gauge. Frames contain decorative gold rails, elevator surrounds, directory, globe, drawer handle, bell stands or golden badges. A still cannot prove a live data binding. | Retain; strip decorative brass. Bind intended instruments and supply engraved scales. Mechanical appearance is not evidence of live data. |
| Every brass part has line outline | Broadly visible, but source lacks line layer and exact width/alpha. | Retain; verify renderer outline on each visible adjacent material. |
| Engraving >=4.2 on brass, dark in both themes | One gauge tick pixel gives5.633 locally; other scales absent or illegible. No night references. | Retain; measure encoded renderer pair, require visible ticks. No universal source pass. |
| Brass separates from every material it is mounted on | Post gauge/support local pair1.010 fails the new proposal. Gold elevator against dark shaft4.398 passes locally but binding unknown. | New >=1.5 pairwise rule, recorded source correction. |
| Live price line is brass; faint scale | Floor has white price lines; post has green/red price lines; agents and screen have colored rows; several monitors are blank. | Retain. Replace with brass single-line/scale instrument after binding; fixed emblems remain allowed non-data color. |
| No accent color for activity | No still frame proves activity changes; colored jackets/logos alone are not activity accents. Glow and colored data rows nevertheless conflict with their own explicit rules. | Retain. No blanket condemnation of clothing color; inspect dynamic states later. |
| One paper material, paper on notes/receipts/tape/plates and nothing else | Source papers are various whites/creams and contain writing/texture. Page ground is not literal world paper. | Retain one semantic material and outline; translate texture/print. Do not recolor floor into paper. |
| Paper barely lifts off ground | Post paper is slightly darker than ground while properly brighter than its floor/counter. | Replace with comparison to its actual physical support. |
| Blueprint only proposed/unbuilt, linework only | Building top stories show blue lines plus pale filled volumes. Unbuilt intent is visible from context but binding/state still needs code. | Retain linework-only; remove apparent opaque fills in realized blueprint rendering. |
| No jacket color near brass; emblem ink, not gold | Post band#BE8635 vs yellow jacket#BE883B is1.019 by luminance and very close hue. Gold badges on all character sheets are explicit. | Retain existing recorded corrections. Replace yellow/ochre brass-like jackets with separated colors; ink emblems. No unrequested numerical hue threshold invented. |
| Varied jacket colors, natural head tones | Present across crowd/cast/moments; moods intentionally repeats one person. | Retain. No requirement that a repeated mood sheet vary its one character's jacket. |
| Focus/hover/selection/disabled color semantics; waiting flag two-color palette | Stills do not show interactive transitions or actual controls; flag colors alone do not prove states. | Retain; unavailable reference evidence, test real interface behavior later. |
| Day/night token pairs; night lights only screens/lamps | The nine image-generated day frames contain no night evidence. | Retain a separate renderer pick derived from the approved day materials. The subsequent night B pick supplies that scoped approval; none is inferred from the day frames. |
| Orange forbidden in historical prompt avoid block | Warm timber and terracotta clothing coexist with that broad prompt guidance; red-orange screen logos also appear. | Historical prompts remain provenance, not additional unseen palette acceptance tests. Current no-activity-accent and no-brass-like-jacket semantics govern. |

### Corrections carried by the nine picks

| Picked frame | Timber/floor finding | Recorded color corrections or limits |
| --- | --- | --- |
| floor-day | Clear timber; paper/floor2.146 | White price lines become brass; bell/rails decorative gold corrected; dark glass and deep jackets lifted for near-black lines; gold-like jackets separated. Exact four tones/engraving not recoverable. |
| post-day | Clear timber; paper/floor2.526, counter2.147 | Gauge/timber1.010 must separate; dark glass, steel/deep timber and jackets lifted; green/red price lines become brass; lamp glow, gradients, writing and gold-like jacket removed/corrected. Visible timber range2.933 already supported locally. |
| agents-at-work-day | Clear timber; paper/floor2.511 | Colored numerical screen rows become brass line+scale; timber sampled pair1.989 needs revised visible ramp or additional honest orientation evidence; dark faces lifted; remove written papers and light gradients. |
| lobby-day | Timber in rear trading room; stone in foreground lobby | Timber floor required for new realized study; decorative gold directory, doors, globe and ornaments corrected; reflections/directory glow removed; dark glass/steel lifted; no proof blank monitor is bound data. |
| building-day | Timber on occupied exchange stories; tiled lobby | Lobby floor correction, pale filled blueprint volumes become linework; decorative elevator/door gold corrected; current narrow frame cannot certify engraved scales or every material ramp. Paper/floor locally1.602. |
| screen-day | Timber foreground/interior | Colored numerical display rows become brass instruments; decorative drawer handle corrected; drawer is a paper interface surface rather than literal wood furniture; text remains interface; background mock caption strokes are not an ink/muted contrast test. Paper/floor1.947. |
| characters-cast-day | No modelled floor: page ground only | Add timber support when realized, not a claimed source sample. Gold emblems and yellow/brass-like jacket corrected; darkest jacket/timber faces lifted; smooth shadows/gradient texture simplified; station writing removed. |
| characters-moods-day | No modelled floor: page ground only | Add timber support when realized. Gold emblems corrected; desk visible range about2.05 and monitor1.760 need stronger ramps; dark jacket lifted; no screen-front glass evidence in this sheet. |
| characters-moments-day | Pale tiled floor, not timber | Replace with intended timber; gold badges and brass-like jackets corrected; decorative bell stand corrected; monitor range1.790 strengthened; screen glass here is lighter and can clear near-black3, unlike post; writing/gradients removed. Paper/floor1.100 is a valid brighter-than-support pair, not a failed invented threshold. |

## Approved day materials and provisional instruments — 13 October 2026

The owner selected material A, the bottom row of the blind comparison, then approved its correction. The tracked [approval brief](../testing/look/scenes/materials-day.json) records that choice, the exact values and source hashes. The correction preserved its hues and floor while lifting the timber top toward the reference’s `#DDB185` to about 1.2:1 against the floor. Approval covers the shown timber and floor faces, ground, paper, line, steel, glass and jacket colours. The exact frame is preserved at [materials-day.png](../testing/reference/materials-day.png).

Only two day entries change from selected A: timber top `#D39A5D` → `#DAAB7C`, and brass dial top `#F9C361` → `#FED683`. The floor stays `#CC9B61`; every other day and night slot, and line opacity, is unchanged. The timber/floor ratio rises from 1.014:1 to **1.198:1**. Raising timber reduces its separation from the original brass, so the modest brass lift is needed to retain the provisional 1.5:1 working mounting floor. Brass now measures **1.501:1 on timber, 1.815:1 on steel and 1.839:1 on glass**. All visible fills retain at least **3.077:1** against the near-black line; the brass top remains below paper in luminance, and engraving reaches **14.458:1**.

The tracked [day brief](../testing/look/scenes/materials-day.json) separates approved visible values, provisional instruments and unreviewed source slots. These values describe the shown day material study. The 2.5:1 body range is checked on the raised timber, steel, glass and jacket probes; this does not claim a 2.5 range for flat paper, thin brass dials or the floor slab. Only the three horizontal brass faces are demonstrated; new instrument sides and mounting pairs still require their own checks. The owner left brass and engraving provisional because the dial top still reads as painted rather than metal. Revisit their appearance and pair checks on real instrument geometry; the shown yellow dials are not final brass approval. The approved near-black outline remains distinct from the provisional use of that colour for engraving. Hidden faces, proportions, exact instrument geometry and interface approval remain separate. Night was picked separately as recorded below.

## Approved night materials — 13 October 2026

The owner chose the top blind row, **night B**, as recorded in the tracked [approval brief](../testing/look/scenes/materials-night.json). That brief and the exact [night frame](../testing/reference/materials-night.png) preserve the shown material values, pale ordinary outlines, dark surface and instrument contours, and flat lit lamp/screen faces. The night pick keeps the same material families as corrected day A; all 44 pre-existing day entries and day opacity remain unchanged.

These are the shown directional night values, not approval of hidden downward slots or arbitrary new views:

| Material | Dark side | Light side | Top |
| --- | --- | --- | --- |
| Counter timber | `#392416` | `#66462C` | `#7F664E` |
| Timber floor | `#342618` | `#55412C` | `#735A3E` |
| Steel | `#292928` | `#494846` | `#696865` |
| Glass | `#212A32` | `#3E4D58` | `#576B7C` |
| Blue jacket | `#202938` | `#39485F` | `#556A89` |
| Red jacket | `#3F201E` | `#6A3A36` | `#995650` |
| Green jacket | `#222B23` | `#3D4B3E` | `#5A6E5B` |

The visible lower glass-sphere band also uses `#212A32`; the unshown steel underside is not approved. Ground is `#0D0F10`, flat paper `#AFA79B`, the opaque ordinary line `#C2CDD7`, and the opaque surface-dark and instrument-contour lines `#080808`. The shown lit lamp faces are flat `#D2C2A8`, and lit screen faces are flat `#8BAAC2`. Those light faces do not turn steel housings or lamp bases into brass and introduce no glow, gradient or light pool. Their dormant day palette entries and the unused prototype aliases are outside this approval.

The independent audit measures night B’s minimum raised-body top/visible-side range at **2.613:1**, visible-side/page-ground separation at **1.314:1**, and authored visible-fill/line contrast at **3.324:1**. Paper is brighter than the counter and floor. A possible `#080808` paper ink reaches **8.415:1**, but no text, label halo, name plate or interface value was shown or approved; dark ground needs a separate light ink treatment.

Brass top `#9F8655` and engraving `#080808` remain **provisional pending real instrument review**. Their measured pairs are **1.537:1 on timber, 1.596:1 on steel and 1.583:1 on glass**, with **5.737:1** for dark engraving against brass. The approved dark instrument contour treatment does not approve the engraving design or its final material appearance. This night material pick does not approve geometry, lamp design, proportions, the kit unit, actual instruments or the interface. The [Stage 0 record](stage-0.md#night-material-study-and-approved-b) retains the numeric and pixel checks, rejected attempts, contour corrections and owner decision.

## Approved proportions and kit unit — 13 October 2026

The owner picked **Option 1, Roomy**, from two independently shortlisted dimension packages, saying “it looks better height-wise.” Approval is limited to **`K = H/8` and the nine Roomy ratios below**, as recorded in the tracked [selected post brief](../testing/look/scenes/proportions-post-day.json). `H` is the canonical nominal standing figure height, so `H = 8K`; posed limbs, shoes and hair retain their own silhouette bounds. The unit is dimensionless, with no metre conversion. These values now live in `packages/atlas/src/proportions.ts`. Compact is retained here only to document the alternative shown with the same materials, camera and pose assignments.

| Parameter, relative to `H` | Compact — not selected | Roomy — approved |
| --- | --- | --- |
| Head ellipsoid height, before hair and pose | 0.190 | 0.175 |
| Nominal shoulder/torso width parameter | 0.285 | 0.270 |
| Working surface height | 0.500 | 0.540 |
| Outer counter-lip radius | 1.150 | 1.320 |
| Nominal station frontage chord | 0.800 | 0.900 |
| Nominal station radial depth | 0.350 | 0.400 |
| Station figure stance radius | 1.320 | 1.490 |
| Neighbouring post-centre pitch | 3.550 | 4.250 |
| Monitor crown top height | 1.500 | 1.500 |

The width parameter places paired radial support-frame centre lines whose projected chord at the outer lip has the stated width; the actual clear space is smaller by frame thickness. Nominal depth reaches the inner counter-body boundary, and the worktop extends another `0.035H` inward. The shoulder parameter precedes build variation, the shaped jacket and sleeve/gesture bounds. These distinctions prevent nominal construction values from masquerading as measured clearances. The retained neutral occupied-ring estimate excludes spillover traders and is not a collision or aisle guarantee; generated figure, chair and station bounds must be reviewed separately.

The historical local observations in `work/look/proportions/round-001/candidate-recipes.json` name pixel coordinates, PNG hashes and uncertainty; the tracked [selected post brief](../testing/look/scenes/proportions-post-day.json) is the source for approved ratios and their scope. Three cast silhouettes suggest head/hair spans around `0.15–0.17` of standing height, but independent manual ranges extend from `0.13` to `0.22` across builds, poses and obscured jaws. The moods cabinets suggest a lower worktop than the picked post, so the proposed `0.50H` and selected `0.54H` were explicit post-based design choices. Hair, leaning bodies, occlusion and inconsistent generated perspective prevent recovery of a unique physical dimension. The floor supplies evidence of crowded, uneven rings and circulation, not an exact post pitch inferred from monitor crowns.

Each isolated post has eight station occupants. The floor comparison has three posts with 24 station occupants and 12 additional traders, distributed `2/4/6` in pairs; both packages use the same assignments. These are controlled comparison counts, not approved population or density targets. Close and native 40-CSS-pixel views include standing front/back, phone, reading, seated, asleep, walking and throwing poses; seated and asleep figures have chairs and working surfaces. A nominal standing figure defines the small-view scale, so slumped figures and raised hands retain their different projected bounds. Emblems are omitted pending asset implementation; this study gives no badge approval.

The shared provisional skin hue comes from a labelled cheek patch in the picked cast frame, then changes luminance to satisfy the drawing rules. Its day ramp is `#7A5B42`, `#7A5B42`, `#A77E5C`, `#D9A579`; night is `#33261D`, `#33261D`, `#584436`, `#7E634F`. This is one diagnostic hue, not a completed cast skin range. Hair/trousers provisionally reuse steel and shirt openings reuse glass; those semantic uses are unapproved. Curved figures expose steel and jacket downward bands that the approved material studies hid, so four previously unapproved bands copy their corresponding approved dark sides in both themes. All approved visible day and night values remain byte-identical. `skin-proposal.json` records these eight scoped assignments and their numeric checks; it does not expand the material approvals.

The five preserved frames witness the selected package; they do not approve every depicted material, asset or construction dimension:

| Selected view | Scoped approval brief |
| --- | --- |
| [Day post](../testing/reference/proportions-post-day.png) | [Post](../testing/look/scenes/proportions-post-day.json) |
| [Day floor](../testing/reference/proportions-floor-day.png) | [Floor](../testing/look/scenes/proportions-floor-day.json) |
| [Day cast](../testing/reference/proportions-cast-day.png) | [Cast](../testing/look/scenes/proportions-cast-day.json) |
| [Day native readability](../testing/reference/proportions-readability-day.png) | [Readability](../testing/look/scenes/proportions-readability-day.json) |
| [Night post](../testing/reference/proportions-post-night.png) | [Night post](../testing/look/scenes/proportions-post-night.json) |

The [Stage 0 evidence](stage-0.md#proportion-study-and-approved-roomy) separates numerical preflight, rendered review and the subsequent owner choice. Both packages passed the independent shortlist; the owner's pick sets the approval. Skin, hair and clothing materials, newly exposed underside bands, figure and asset design, eight stations per post, the 36-figure population, physical units, brass, final clearances and additional construction dimensions remain unapproved. The asset generators and remaining Atlas modules are unfinished. Raw candidate and review statuses are retained as historical evidence, not rewritten as approval.

## The interface

- **Colour.** Text is `ink` on ground, paper or an opaque label halo, at least 7:1 against that surface. A name plate has its own surface and ink at 7:1. Secondary text is `ink-muted`, on ground or paper only. Text is never brass or blueprint. Notes, receipts and plates sit on paper with a hairline edge. Blueprint is used only for proposed or unbuilt things, and only as linework.
- **Corners.** Every view keeps the four corners of an engraved plate, inset by `space-4`:
  - top left, the place: the floor, or a place on it;
  - top right, the path back up the zoom ladder, in `ui-label`: Floor › Solana › post 12;
  - bottom left, one hint;
  - bottom right, the live readout, which changes in place and is never animated like a counter.

  There is no fifth corner element, logo or toolbar.
- **The centre is for the drawing.** The drawer slides in from an edge beside whatever is selected, and never covers it.
- **Labels** float in the atlas layer, one level at a time by zoom, fading as the next level comes in. They sit in clear ground beside what they name, or on an opaque contrast-checked halo if the drawing lies behind them, with no leader lines. A token keeps its own spelling in small caps, without the `$` prefix.
- **Focus and states.** Keyboard focus is a solid 2 px `ink` outline, offset 2 px. Hover underlines a label and never changes a colour, since every colour carries a meaning. Selection draws a second hairline outline 2 px outside the first. Disabled controls drop to `ink-muted` and lose their outline.
- **Iconography.** There is no icon font and no emoji: just the two sets of geometric marks below, drawn as SVG in the palette. The Floor has no logo yet, so its name is set in plain small caps until it has one. Tokens' logos belong to their owners and are printed as supplied, never redrawn.

## Components

The interface components, and what each is on the floor:

| Component | On the floor |
| --- | --- |
| Note | One claim, with its sources and the author's position. The agent's words are in the notes face; everything the Floor adds is in the interface faces. In the drawing, notes are papers on the desks of the agents working from them, and are filed in the file room. Board messages are cards pinned to the whiteboards |
| Receipt | An action, its cause, the policy result with the limits it was checked against, and its transaction. In the drawing, a receipt prints on its agent's ticker tape, and the trade lands on its post's screens. A decision waiting for the owner shows the waiting flag, the reason and Approve and Decline: Approve uses a paper surface, `ink` text and a strong `ink` border, and Decline is a hairline outline on paper. Waiting decisions expire rather than proceed, with the time left in `ink-muted`. Nothing on it is highlighted |
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

There is no Blender for the MVP. Every asset is made as code, following the same conventions a Blender asset would, so modelled assets can join later without changes. The live trader is the one exception: its bodies, hair and motion capture are CC0 sources under `assets/traders/source`, converted, dressed and baked by code in `apps/web/kit/traders` at build time.
- **Code makes it.** three.js generators, and SVG profiles that are lathed, extruded or swept. Generators live in the web asset kit, because three.js may only be imported in `apps/web`.
- **Code runs where its input is.** Parts that follow live data, the brass instruments, are built in the renderer. The post and station generators and the picked Roomy figure live in `apps/web/src/map/_lib/assets/`, which the workbench builds directly; the live viewer draws its own provisional floor kit and room kit from the same folder, and its trader from the baked trader kit. Models and manifests under `assets/<kind>/<id>/` arrive with the first modelled asset ([decision](decisions.md#the-look)).
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
| `reference` | The day and night frame paths, image hashes and dimensions; absent captures stay pending |

## Plain values and the fences

Five source modules export plain values. Palette names and decoding schemas remain alongside the material values; the renderer writes their sRGB bytes directly to its texture. There are no generated palettes, stylesheets, token exports or manifests. One snapshot pins the values and dimensions without carrying approval metadata into the application.

`atlas-literals` in `scripts/lint/plugin.ts` rejects colour and pixel literals in production source outside `packages/atlas/src`. `scripts/lint/styles.ts` applies the same boundary to application HTML and CSS. Interface CSS variables will arrive with their first consumer.

The planned Atlas page shows swatches, material spheres, reference scenes beside their frames, and the asset catalogue. Asset and interface approval scopes remain in the decision log.

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

The development-only `/look/` adapter drives the real renderer with a fixed capture configuration. Browser suites retain the camera, picking, replay, ownership, streaming and phone-profile checks. Completed tone/proportion studies and the 360-capture matrix are retired. The `approved` Playwright project reproduces the seven picked renderer frames through screenshots at zero tolerance and reads the top, dark-side and light-side pixels of the material scene at all four corners; reference images require a new owner pick before they change. `bun run preflight:assets` checks the generated post and stations against the face rules at every corner by day and night, and the `assets` project renders their post, floor and desk views.

`bun test ./packages/atlas/test` pins the plain values. Scene briefs contain rendering inputs, while the decision log records the owner’s picks and their scope. New asset comparisons still check tone structure, silhouettes, line density, instrument masks and tick spacing as applicable. Synthetic scenes cannot reach the live world.

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
