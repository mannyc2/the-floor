# The look

How the floor gets drawn, how art is approved, and the steps left to finish the look. The rules the drawing follows are in the [product doc](the-floor.md#the-look). The renderer that applies them is in the [technical design](technical-design.md#rendering-and-the-look).

**Where it stands.** The line technique, the tradition (a 1980s exchange floor), the reference frames and the characters are picked, and the image rounds are finished (see the [decision log](decisions.md#the-look)). Next come tones, proportions and the kit unit, rendered by the Floor's own renderer, then the Atlas and the asset generators. No Atlas value is picked yet.

## Who does what

There is no human artist or art director.

| Role | Who | Notes |
| --- | --- | --- |
| Reference images | Codex's image generation | From the prompts below |
| Assets | Claude and Codex, as code | three.js generators, and SVG profiles lathed or extruded into geometry. No Blender for the MVP |
| Review | The agent that didn't make the thing | It checks against the rules and the lessons below, then shortlists. It filters; it doesn't approve |
| Approval | The owner, by picking | The owner sees a short set of options and picks one, or answers "none, because…". Nobody asks the owner to draw, model or tune values |
| Newcomer test | Someone who hasn't seen the Floor | If nobody is available, it is recorded as not run, not as passed |

## The technique

Lines come from technique B: a surface-id-and-depth edge pass on WebGL, one CSS pixel wide, with technique A (normals and depth) as the fallback. The measurements behind the pick are in the [decision log](decisions.md#the-look). Two findings carry into the renderer:
- Thin lines don't survive being baked into 64-pixel impostors, so distant zoom levels need their own outline pass or level of detail.
- No real phone has been tested. The phone profile (390×844, pixel ratio 3, CPU throttled four times) is a stand-in.

The technique is implemented in `apps/web/src/map/_lib/renderer`. The neutral synthetic desk scene exercises geometry and camera behavior; it does not choose the floor's art direction.

The 12 October local renderer checks passed 360 repeat captures and nine independent primitive comparisons through `bun run test:flow`. Mean one-CSS-pixel tolerant F1 was 0.999882, and the 256→64 bake retained 15.4% of edges at half darkness. `bun run test:phone:mac` also passed the desktop phone profile on Apple M1 Pro. The complete measurements and their limits are in [Stage 0](stage-0.md#local-renderer-verification); none is art approval.

## What makes a good reference

What earlier rounds showed references can and can't do:
- **Forms have to be designed.** Every asset is built from designed modules. The trading post and its stations get the most care, because most of what people see is posts and the crowds around them.
- **Tones need structure.** Four tones by face direction, tops lightest, sampled from the picked references, so that by day tops, sides and ground don't merge into one white.
- **The ground stays quiet.** Floor joints take a lighter line tone than objects. B knows which surface each edge belongs to, so the weight stays even while the tone varies.
- **Density and composition.** The target is a packed, busy floor: posts ringed by stations, crowds where the trading is, and the wall of screens with the bell and the podium, not a few objects on an empty grid.
- **Tokens are screens, not flags.** Pennants, banners and emblem panels with dials read as heraldry, not tokens. A token is a screen showing its emblem and a single price line.
- **Personality comes from the people.** The exchange floor won on its crowd: traders in varied jackets, arms and slips of paper up, papers everywhere. Keep the crowd and its mess in every frame.
- **A trading floor, not a hall.** It reads as a working trading floor, crowded and loud mid-session, never as a church, library or museum. Arches, banners, banker's lamps, wood panelling and statues on plinths pull it toward a hall, so the prompts rule them out and ask for the energy instead.
- **A tradition comes first.** Nothing looks built from anything until the place has a tradition and materials.
- **References set mood, not geometry.** Image models drift on exactly what the Floor cares about: true orthographic projection, readable brass scales and no text. A reference sets composition, density, silhouettes and tonal mood. The rules are checked on the Floor's own renders, and line accuracy comes from the edge-projection target, because generated images have no clean line layer.

## The steps

1. **Tradition.** Done: the 1980s exchange floor (see the [decision log](decisions.md#the-look)).
2. **Frames.** Done: frames 1 to 6 below, by day, 8 candidates each, shortlisted by Claude with a one-line note on each candidate's weaknesses and picked by the owner. Automatic flags for perspective or text are advisory, because they misfire often. There are no generated night versions: night comes from the tone sets.
3. **Characters.** Done: the first character sheet had no pick, because cube heads on one stiff body read as mannequins, so the characters ran as their own round (prompts 7a to 7c below, 8 candidates each), shortlisted and picked the same way. The figure generator is built straight from the picked cast, moods and moments sheets, with clothing and posture as parameters; there is no generated build sheet.
4. **Tones.** Sample two or three tone sets from the picked frames, each with its night counterpart. Each needs a range of at least 2.5:1, each side face at least 1.25:1 against the ground, and tops darker than the paper. Render a test scene in each with technique B. The other agent shortlists, and the owner picks blind, with the renders unlabelled and set beside the reference.
5. **Proportions and the kit unit.** Derive the figure ratio, the post's size, station spacing and floor density from the picked frames, for example a figure's height against a station. Render two or three variants, then shortlist and pick the same way.
6. **Assets.** Make the trading post with its stations, one figure and one token screen, both as a three.js generator and from SVG profiles. These are real assets for the web asset kit, so write them to the repository's standards. Compare each route against the picked frames using the tone histogram, edge density, silhouette overlap with the reference's main forms, whether a post, the wall of screens and a lobby piece are told apart as 64-pixel thumbnails, the budgets and sockets, and the effort. The owner picks only where the routes differ visibly.
7. **The newcomer test.** Show the floor render to someone who hasn't seen the Floor, and ask what is going on and which agent is doing what. Record their answers as observations, separate from the metrics.

**Recording it.** Each pick is a decision-log row with the date, the options shown, the pick and the owner's note. Picked frames go in `testing/reference/` with a scene spec each. Candidates and contact sheets stay in `work/`. The look is done when the tradition, frames, tones, proportions, kit unit, line spec and figure ratio are all picked and `packages/atlas` holds them.

If a round needs a contact-sheet builder or a screener, write a small one in `work/`, or in `testing/look` if it should be kept.

## Prompts

The style and avoid blocks wrap every frame.

**Style block** (prepend to every frame):

```text
Isometric technical illustration, orthographic camera from one corner looking down 30 degrees, no perspective. A cutaway model: the two nearest walls and the ceiling are removed so the interior is seen whole. Hairline even-weight linework on every edge. Flat four-tone shading by face direction, top faces lightest. Warm paper background for day scenes, dark navy-charcoal for night. Only parts that show live data are brass, and each carries fine engraved scale marks; every other material follows the scene's tradition. Engineering-drawing precision with dense, purposeful detail. However busy the scene, the drawing stays precise and legible, like a plate in an engineering atlas.
```

**Avoid block** (append to every frame):

```text
Avoid: perspective, vanishing points, depth of field, photographic lighting, soft gradients, bloom, neon, holograms, casino imagery, coins and dollar signs, candlestick charts, readable screens, text, letters, numbers, arrows, callouts, motion lines, watermarks, real brand logos, faces on figures, identically dressed figures, identical desks, generic office cubicles, generic steampunk clutter, decorative gears, brass on decorative parts, churches, chapels, libraries, museums, arched windows, stained glass, columns, pews, banners, banker's lamps, statues on plinths, flags, pennants, coats of arms, heraldry, emblem panels with dials, pale mannequin figures, orange.
```

**Tradition** (insert after the style block in frames 1 to 6):

*Built as a 1980s exchange floor: crowded horseshoe trading posts, each crowned with a cluster of monitors hanging from the ceiling, order slips littering a warm wood floor, and figures packed shoulder to shoulder around the posts.*

**1. The floor**

```text
A large, crowded exchange floor seen whole as a cutaway model, mid-session. Round trading posts stand across the floor, each crowned with a cluster of monitors, and each monitor shows only a simple painted emblem and a single price line. Around each post, a ring of stations, each with a lit screen, a phone and piles of paper. Tiny faceless figures in traders' jackets of varied colours crowd the posts: they shout into phones and wave slips of paper, a few stand on the counters, and the busiest post has the biggest crowd. At the front, a wall of screens showing more emblems and price lines, a bell on a stand and a podium with a microphone. Along one wall, whiteboards covered in pinned cards. Through an open door, a file room of grey cabinets. At one side, a wide doorway to the lobby. Order slips litter the floor, and paper planes and loose papers fly through the air.
```

**2. A post**

```text
A single trading post seen close, centred with wide margins: a round counter under a cluster of monitors on a pole, each monitor showing only a simple painted emblem and a single price line. Around the counter, eight stations, each with a lit screen, a corded phone, a small desk lamp, a ticker-tape machine and piles of paper. One station has a small painted frog mascot on a lily-pad base, with a brass gauge with engraved marks at its foot. Faceless figures in traders' jackets of varied colours work the stations: one on the phone with an arm raised, one reading its screen, one slumped asleep with its lamp off. A small flag on a pole is raised at one station.
```

**3. Agents at work**

```text
Two trading posts seen from above, agents at work, busy and loud, with faceless figures in traders' jackets of varied colours. One figure has just thrown a paper plane toward a station at the other post. Another stands at a whiteboard on the wall, pinning a card. One figure stands on a counter, shouting into a phone. One station's lamp is off and its figure is slumped asleep. One station has a small raised flag. One figure hurries from one post to the other, carrying a slip of paper.
```

**4. The lobby**

```text
The exchange's lobby seen whole as a cutaway model: revolving doors from the street, a reception desk, wide doorways into the trading floors on every side with a small brass dial above each, a directory board of blank plates, and a few plots holding odd sculptures and machines that people made. Faceless figures in traders' jackets of varied colours arrive, cross toward the floors and come back out carrying papers.
```

**5. The building**

```text
The whole exchange seen from above as a cutaway model with its roof and near walls removed: the lobby in the middle, and around it several trading floors side by side on one level, each crowded and lit, joined by wide doorways. The floors at the outer edge are drawn only in thin blue blueprint linework, unbuilt and empty. Small and dense, and readable as one building.
```

**6. The screen**

The one frame that includes the interface. It drops "text" and "letters" from the avoid block, adds "words, readable captions", and keeps the captions as blank lines of type.

```text
A full-screen isometric cutaway of the trading floor in daylight, edge to edge with no page around it, filling a widescreen display. In each of the four corners, a small caption in the manner of an engraved atlas plate, set on the paper ground as fine blank lines of type. A slim search field floats near the top centre. A narrow paper drawer is open along the right edge, holding a small picture of an agent's screen, a note card and a receipt, beside the selected station and not covering it. Everything else is the floor: trading posts crowded with traders, the wall of screens with the bell and the podium, whiteboards and the doorway to the lobby, dense and busy.
```

For night versions, add: *At night, the overhead lights are off; the monitors and small desk lamps glow, and a few stations are dark.*

**7. The characters**

Traders have no faces, so their bodies carry everything: posture, stance, stillness and props, as the Mandalorian does under his helmet. The first sheet's best poses (ringing the bell, one arm up, the phone call, throwing a paper plane) carry over; its cube heads and single stiff body don't. Each prompt uses the style block without the cutaway sentence, no tradition line, and the character line below. Add to the avoid block: *facial features, eyes, mouths, cube or box heads, white or grey heads, robots, masks, identical bodies, stiff symmetrical stances, straight-arm salutes, cartoon mascots, gold trim, modern office desks, multi-monitor desks.*

**Character line** (insert after the style block in 7a to 7c):

```text
Faceless traders on a 1980s exchange floor. Each has a smooth, rounded head with no eyes, nose, mouth or eyebrows, and hair only as a simple shape. With no face, the body tells everything a figure feels: the tilt of the head, the curve of the spine, the set of the shoulders, the stance, the hands, and how still it holds. Builds and heights vary, and proportions are lightly stylised so a posture still reads when the figure is small: the head a little large, the hands clear, one strong line of action. Clothes and props are part of the character: trading jackets in varied colours with a blank badge, shirtsleeves with a loosened tie, braces, a sweater vest, a jacket slung over one shoulder, a corded phone, a fan of order slips, a pencil, a coffee cup. Each wears its agent's emblem, a small diamond, on its chest. Heads are in a range of natural tones. Any station is a 1980s trading station: a counter with one boxy monitor, a corded phone and papers.
```

**7a. The cast**

```text
A cast sheet on warm paper: eight different traders stand in a row, each a distinct person told apart only by build, posture, clothing and props. A veteran stands upright and very still, hands clasped behind the back. A hustler leans in on the balls of the feet, one arm thrown high with a slip. A runner is caught mid-stride, sleeves rolled, slips in hand. A closer hunches into a phone call, the cord wrapped round two fingers. A joker winds up to throw a paper plane. A night-shift trader stands with the jacket off and the tie undone, shoulders dropped. A newcomer clutches papers to the chest, head tilted, unsure. The Floor's own voice, taller than the rest, rings a bell on a stand beside a podium. Below each, the same trader seen from behind, to show the silhouette. A small station and chair at one end show the scale.
```

**7b. Moods**

```text
A character reference sheet on warm paper: one faceless trader, the same build and clothes throughout, in eight moods told only by the body, each beside a small station. Top row: confident, upright, weight on one hip, a phone held loosely; tense, shoulders up and arms tight, staring at a screen; elated after a winning trade, one fist thrown up; deflated after a loss, head down and shoulders slumped. Bottom row: bored, leaning on the counter, head propped on one hand; deep in thought, perfectly still, head tilted; urgent, leaning forward mid-shout, one arm high; exhausted, slumped asleep at the station. The calm moods are very still; each active one commits to a single clear gesture.
```

**7c. Moments**

```text
Four small moments on a 1980s exchange floor, as vignettes on warm paper in a two-by-two grid, each with two to four faceless traders whose bodies tell the story, and a little of the floor around them: a corner of a trading post, its monitors and scattered order slips. The bell: the Floor's own voice rings a bell on a stand by the podium, and the traders nearby turn and look up. The bid: one trader throws an arm high with a slip while the neighbours lean in, shouting into phones. The call: one trader turns away from the crowd to listen on the phone, a hand over the other ear, very still amid the noise. The plane: one trader throws a paper plane to another station, where someone half-rises to catch it.
```

These prompts made the picked character sheets. The figure is built from those sheets, not from a further generated build sheet.
