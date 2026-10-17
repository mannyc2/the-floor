# The look

How the floor gets drawn, how art is approved, and the steps left to finish the look. The rules the drawing follows are in the [product doc](the-floor.md#the-look). The renderer that applies them is in the [technical design](technical-design.md#rendering-and-the-look).

**Where it stands.** The line technique, the tradition (a 1980s exchange floor), the reference frames, character references and shown corrected day A and night B materials are approved (see the [decision log](decisions.md#the-look)). The owner also picked [Roomy proportions and the kit unit](atlas.md#approved-proportions-and-kit-unit--13-october-2026): `K = H/8` and nine dimension ratios. The night pick includes the shown pale ordinary outlines, dark surface and instrument contours, and flat lit lamp/screen faces. Brass and engraving remain provisional until real instrument geometry is reviewed. The Atlas now owns the recorded values. On 16 October the owner picked camera-relative side tones: tops and undersides follow world Y, and the dark side stays on the same screen side at every quarter turn, so every corner passes the 2.5:1 body range ([decision](decisions.md#the-look)). The post and station generators exist but are unpicked; remaining Atlas modules and their design/material reviews are unfinished. The image-generation rounds are finished, except the gesture round for agents talking up close (prompt 8), which has no pick yet.

The nine picked image-generation references are preserved byte-exact under `testing/reference/`, with provenance and staged scene briefs in `testing/look/scenes/`. The briefs leave camera values, asset placements, numeric comparison thresholds and night frames explicitly pending. They are not executable reference scenes or approved renderer baselines. The separately scoped day/night material and Roomy proportion picks bring the preserved set to sixteen frames, each with its own brief; they do not fill the original scenes’ pending geometry or night fields. The tracked [briefs](../testing/look/scenes/README.md) preserve each approval; [Stage 0](stage-0.md#proportion-study-and-approved-roomy) records the historical local preservation commands and results.

The previous day/night tone shortlist is superseded without an owner pick. On 13 October the owner removed the requirement for ink on every material tone, required a separate timber floor and paper checks against its actual supports, and asked for brass separation against each mounting material. The corrected [colour rules](atlas.md#starting-values) keep the body range, side separation and visible-face line thresholds. The [tracked day brief](../testing/look/scenes/materials-day.json) records the selection from two independently shortlisted day options, with sampled timber, floor, paper, steel, glass and brass, engraved brass instruments, scattered papers and jacket-colour blocks on the same provisional post. The owner picked the bottom row, material A, with one correction: keep its hues and floor, and lift the timber top toward the reference’s `#DDB185` to about 1.2:1 against the floor. The owner approved the single corrected comparison preserved in that brief, including the shown timber and floor faces, ground, paper, line, steel, glass and jacket colours. The exact [day frame](../testing/reference/materials-day.png) and [approval brief](../testing/look/scenes/materials-day.json) preserve that scope. Brass and engraving remain provisional: the dial top looks paint-like, and their final appearance needs real instrument geometry. The day material pick does not approve hidden faces, proportions or an unseen interface. See [the results](stage-0.md#day-material-study-and-colour-audit).

The owner then chose the top blind row, night B, as recorded in the tracked [night brief](../testing/look/scenes/materials-night.json). The [night frame](../testing/reference/materials-night.png) and [approval brief](../testing/look/scenes/materials-night.json) preserve the shown material values, line classes and flat lit lamp/screen faces. The room is dimmer while the material families carry over from day; no generated night reference, glow or gradients were used. The material pick does not approve the blockout, lamp design, proportions, kit unit, real instruments or the unseen interface. Brass and engraving remain provisional. The [night evidence](stage-0.md#night-material-study-and-approved-b) retains the rejected attempts and passing retakes.

The owner chose **Option 1, Roomy**, from the two independently shortlisted [proportion packages](atlas.md#approved-proportions-and-kit-unit--13-october-2026), saying “it looks better height-wise.” Approval covers only `K = H/8` and the nine Roomy ratios. The selected day post, floor, cast and native-readability frames, plus the night post, are preserved with scoped briefs. The comparison used an occupied post, three posts with the same 36 figures in uneven groups, and close and native 40-CSS-pixel posture probes. These controlled counts, figure and asset design, skin/hair/clothing materials, newly exposed underside assignments, physical scale, brass and final clearances remain unapproved. The tracked [selected post brief](../testing/look/scenes/proportions-post-day.json) records the exact ratios, parameter meanings and exclusions. The source observations, recipes and blind review sheets are historical local evidence; generated bitmaps do not supply exact surveyed dimensions. Raw candidate and review records keep their pre-selection status; the [decision](decisions.md#the-look) and preserved briefs record the later owner pick.

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
4. **Tones and materials.** First audit every colour rule against all nine picked frames: a failure gets a recorded build correction or a changed rule, never an assumed pass. Under the corrected [Atlas rules](atlas.md#starting-values), sample two or three day sets with separate timber, timber floor, paper, steel, glass and brass. Keep the top-to-visible-side body range at least 2.5:1, side faces at least 1.25:1 against ground, tops darker than paper, and a near-black line at least 3:1 on visible faces; a hidden underside is exempt. Paper is checked on floor and countertop, text on its own surfaces, and brass on each actual mount. Render the same blockout in technique B with an engraved brass instrument, papers on the floor and counter, and a few jacket-colour blocks. The other agent shortlists, and the owner picks blind beside the reference, with “none” allowed. The corrected day option is approved within its recorded scope. The owner then picked night B, the top of two blind options derived from those same material identities, with lights down and desk lamps and screens lit; no generated night reference was used. Its shown line classes and flat light-source faces are approved with the materials. Brass and engraving remain provisional until real instruments are reviewed. The completed day work was committed on its branch without pushing before night design and implementation began, as the owner requested.
5. **Proportions and the kit unit.** The owner picked [Roomy](atlas.md#approved-proportions-and-kit-unit--13-october-2026) from two independently shortlisted packages: `K = H/8` and the nine recorded ratios are approved. The study derives its proposals from the picked frames and checks them in the renderer. Physical units, station/population counts, final clearances and production asset design remain open; the selected values now live in `packages/atlas`.
6. **Assets.** Make the trading post with its stations, one figure and one token screen, both as a three.js generator and from SVG profiles. These are real assets for the web asset kit, so write them to the repository's standards. Compare each route against the picked frames using the tone histogram, edge density, silhouette overlap with the reference's main forms, whether a post, the wall of screens and a lobby piece are told apart as 64-pixel thumbnails, the budgets and sockets, and the effort. The owner picks only where the routes differ visibly.
7. **The newcomer test.** Show the floor render to someone who hasn't seen the Floor, and ask what is going on and which agent is doing what. Record their answers as observations, separate from the metrics.

**Recording it.** Each pick is a decision-log row with the date, the options shown, the pick and the owner's note. Picked frames go in `testing/reference/` with a scene spec each. Candidates and contact sheets stay in `work/`. For Stage 0, the look is done when the tradition, frames, tones, proportions, kit unit, line spec and figure ratio are picked and `packages/atlas` holds them, step 6's post with its stations, one figure and one token screen are picked at all four quarter turns, and step 7 is run or recorded as not run ([decision](decisions.md#the-look)).

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

**8. Talking up close**

Agents talk in two ways. Far apart, they use paper: a paper plane to the other's desk or a card pinned on the board, as frames 3 and 7c show. Close by, within a few steps, they use their bodies: arms, legs, stance, where they point and where the head turns, and the listener answers the same way. An agent that means its owner points up out of the picture at the camera, where the people watching are. A figure is about 40 CSS pixels tall at native zoom, so a gesture has to read in silhouette: arms clear of the body, a step, a lean, a turn. Finger signals, like the pit's counting, only read zoomed in.

8a to 8i are sheets and use the style block without the cutaway sentence. 8j is a floor frame and uses the whole style block and the tradition line. All ten insert the character line and then the gesture line. Add section 7's avoid additions and: *speech bubbles, thought bubbles, symbols or icons over heads, emoji, question or exclamation marks, sign-language charts, labels, captions, numbered panels, rude or obscene gestures, thumbs-down, a flat hand raised high on a straight arm, pointing like a gun, shoving, fighting.*

**Gesture line** (insert after the character line in 8a to 8j):

```text
Traders close to each other talk without paper, using only their bodies: big arm movements held clear of the torso, a step in or a step back, a lean, a weight shift, a turn of the shoulders, where a hand points and where a head turns. Whoever listens answers with its body too: turning to face the speaker, holding still, tilting its head, mirroring a stance. Each gesture is one clear, committed shape that still reads as a silhouette at a glance. The viewer looks down on the scene from above, and when a trader means the person it works for, it points up out of the picture straight at the viewer, index finger out and elbow a little bent, head tipped back toward the viewer.
```

**8a. The owner**

```text
A character reference sheet on warm paper, seen from above like the trading floor, so the viewer looks down on the figures: eight pairs of traders in two rows, and in each pair one trader brings up the person it works for by pointing or reaching up out of the picture toward the viewer while its partner reacts. Top row: one points up at the viewer with one hand and gestures to its partner with the other, passing on what it was asked; one jerks a thumb up over its shoulder toward the viewer, half-turned to its partner; one holds a slip up toward the viewer at full stretch, showing it; one opens both arms up toward the viewer with palms up, asking, and its partner looks up too. Bottom row: one points at its partner with one hand and up at the viewer with the other, and the partner's head follows; both point up at the viewer at once, in agreement; one shrugs at its partner and tips its head up toward the viewer, the decision not its own; one taps the emblem on its own chest and points up at the viewer while its partner steps back to give it room.
```

**8b. Ask and answer**

```text
A character reference sheet on warm paper: eight short exchanges between two traders a step apart, in two rows, each told only by their bodies beside a corner of a station. Top row: a question, one trader leans in with both palms turned up and its head tilted while the other turns to listen; yes, the listener steps in and offers an open hand, the two stances mirrored; no, the listener steps back with arms folded, shoulders turned half away; not sure, the listener shrugs high, palms up, weight on its back foot. Bottom row: wait, one trader holds a flat hand at chest height toward the other, its phone still at its ear; listening, one stands perfectly still, head tilted, hand on chin, while the other talks with both hands; you and me, one taps its own emblem with a thumb and points at the other with its free hand; cutting in, a third trader steps in from the side with one hand raised at shoulder height.
```

**8c. Working together**

```text
A character reference sheet on warm paper: eight moments of two traders working something out close together, in two rows, each told by their bodies. Top row: a proposal, one steps forward offering an open palm while the other leans back to weigh it; a review, both lean over one slip held between them, one pointing at a spot on it; a handoff, one passes a fan of slips at arm's length while already turning to go, the other reaching to take them; splitting the work, one chops the flat of its hand down the middle of a stack of papers while its partner reaches for half. Bottom row: over there, one throws its whole arm out toward a trading post off the sheet and its partner pivots to look; come with me, one beckons with a wide sweep of the arm, mid-stride away, the other a step behind; calling someone over, one waves an arm high over its head toward someone off the sheet; well done, one claps the other on the shoulder.
```

**8d. The pit's signals**

```text
A character reference sheet on warm paper: eight pairs of traders facing each other across a corner of a trading post's counter, in two rows, using the hand signals of a 1980s trading pit, arms high so they carry over a crowd. Top row: buying, an arm raised with the palm turned in toward its own head; selling, an arm pushed out with the palm turned out toward the other trader; how many, fingers held upright against the chin; a bigger number, fingers held against the forehead. Bottom row: at what price, fingers held out sideways at arm's length; a deal, both traders point at each other at once; writing it up, each scribbles on a slip, one holding its slip up to show the other; no trade, both forearms crossed in front of the chest and swept apart.
```

**8e. Legs and the whole body**

```text
A character reference sheet on warm paper: eight moments in two rows where the legs and the whole body do the talking between two traders close together. Top row: eager, one rises onto its toes and leans in; doubtful, one rocks back on its heels with arms folded; insisting, one plants its feet wide and leans over a counter toward the other; impatient, one taps a foot with hands on hips while the other talks on the phone. Bottom row: done talking, one turns its back and walks off, a hand lifted loosely over its shoulder; agreed, the two stand side by side in the same stance, mirrored; explaining, one crouches beside a seated trader at its station and points at the screen; excited, one bounces on bent knees, both arms pumping.
```

**8f. Huddles**

```text
Four small moments on a 1980s exchange floor, as vignettes on warm paper in a two-by-two grid, each a huddle of three to five faceless traders talking close together with their bodies, with a corner of a trading post, its monitors and scattered order slips around them. The briefing: one trader in the middle points each of the others off in a different direction, splitting up the work, and they are already turning to go. The debate: two traders lean toward each other with open hands while the rest turn their heads from one to the other. The owner: the whole huddle turns and points up out of the picture at the viewer at once. The win: two traders slap hands high overhead while the others throw their arms up around them.
```

**8g. Four beats**

```text
Two comic strips on warm paper with no words, one above the other, four panels each, the same two traders throughout each strip, seen from above like the trading floor. The first strip: a trader walks over to a neighbour's station and taps the counter; it throws an arm out toward a trading post across the floor while the neighbour turns to look; it points up out of the picture at the viewer, its other hand toward the neighbour; the two shake hands. The second strip: a trader holds up a slip to the other; the other leans in to look, then steps back with arms folded; the first opens both arms up toward the viewer, asking; the two split a stack of slips and walk off in opposite directions.
```

**8h. Near and far**

```text
A sheet on warm paper in four rows, each row the same message sent two ways between the same two traders. On the left, the two stand a step apart and say it with their bodies. On the right, they are far apart at stations across the floor, and it goes on paper. A request: arms open with palms up, beside a paper plane arcing toward a distant station. A deal: the two point at each other, beside a paper plane landing on the partner's desk as the partner raises a slip. Splitting the work: a hand chopping down the middle of a stack, beside cards pinned in two columns on a whiteboard. A warning: one taps the other's shoulder and points hard at a monitor, beside a card pinned on a whiteboard while traders across the floor look up from their stations.
```

**8i. Small and readable**

```text
A readability sheet on warm paper: sixteen pairs of faceless traders in four rows, each pair drawn tiny, at the size figures appear on a crowded trading floor seen whole, with clear space around each pair. Pointing up at the viewer; asking, palms up; agreeing, stances mirrored; refusing, a step back with arms folded; a shrug; wait, a flat hand at chest height; over there, a whole arm thrown out; come with me, mid-stride with a beckoning arm; a handoff of slips; a deal, pointing at each other; a clap on the shoulder; a back turned, walking off; leaning in together over a slip; a chopping split; calling someone over, an arm waved overhead; a crouch beside a seated trader. Each is one bold silhouette with the arms well clear of the body, so it reads at a glance even that small.
```

**8j. On the floor**

```text
Two trading posts seen from above, mid-session, busy and loud, with faceless figures in traders' jackets of varied colours, and all over the floor agents talk in two ways. Pairs and small huddles standing close talk with their bodies: one points up out of the picture straight at the viewer while its partner looks up; one throws an arm out toward the other post while its partner pivots to look; two point at each other to close a deal; one steps back with arms folded; one crouches beside a seated trader, pointing at its screen; one claps another on the shoulder. Between agents far apart, paper flies: paper planes arc from one post to the other, and a trader pins a card on a whiteboard on the wall.
```
