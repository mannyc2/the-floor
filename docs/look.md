# The look

How the floor gets drawn, how art is approved, and the next reference round. The rules the drawing follows are in the [product doc](the-floor.md#the-look). The renderer that applies them is in the [technical design](technical-design.md#rendering-and-the-look).

**Where it stands.** The line technique is picked. Next, the owner picks the floor's tradition, then its reference frames, tones, proportions and kit unit. No Atlas value is picked yet.

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
- **Forms have to be designed.** Every asset is built from designed modules. The desk gets the most care, because most of what people see is desks.
- **Tones need structure.** Four tones by face direction, tops lightest, sampled from the picked references, so that by day tops, sides and ground don't merge into one white.
- **The ground stays quiet.** Floor joints take a lighter line tone than objects. B knows which surface each edge belongs to, so the weight stays even while the tone varies.
- **Density and composition.** The target is rows packed with desks, the pit and its wall, the bell and a lobby of plinths, not a few objects on an empty grid.
- **A tradition comes first.** Nothing looks built from anything until the place has a tradition and materials.
- **References set mood, not geometry.** Image models drift on exactly what the Floor cares about: true orthographic projection, readable brass scales and no text. A reference sets composition, density, silhouettes and tonal mood. The rules are checked on the Floor's own renders, and line accuracy comes from the edge-projection target, because generated images have no clean line layer.

## The next round

1. **Tradition.** Generate frame 1 (the floor, by day) in each of the three traditions below, 6–8 candidates each. The owner picks one, or answers "none, because…".
2. **Frames.** Generate all four frames in the picked tradition, by day and by night (the screen by day only), 12–20 candidates per frame. Claude shortlists 4–6 per frame, with a one-line note on each candidate's weaknesses. Automatic flags for perspective or text are advisory, because they misfire often. The owner gets one contact sheet per frame and picks one.
3. **Tones.** Sample two or three tone sets from the picked frames. Each needs a range of at least 2.5:1, each side face at least 1.25:1 against the ground, and tops darker than the paper. Render a test scene in each with technique B. The other agent shortlists, and the owner picks blind, with the renders unlabelled and set beside the reference.
4. **Proportions and the kit unit.** Derive the figure ratio, desk footprint, row spacing and floor density from the picked frames, for example a seated figure's height against its desk. Render two or three variants, then shortlist and pick the same way.
5. **Assets.** Make the desk, one figure and one ticker-wall plate both as a three.js generator and from SVG profiles. These are real assets for the web asset kit, so write them to the repository's standards. Compare each route against the picked frames using the tone histogram, edge density, silhouette overlap with the reference's main forms, whether a desk, the pit and a lobby piece are told apart as 64-pixel thumbnails, the budgets and sockets, and the effort. The owner picks only where the routes differ visibly.
6. **The newcomer test.** Show the floor render to someone who hasn't seen the Floor, and ask what is going on and which agent is doing what. Record their answers as observations, separate from the metrics.

**Recording it.** Each pick is a decision-log row with the date, the options shown, the pick and the owner's note. Picked frames go in `testing/reference/` with a scene spec each. Candidates and contact sheets stay in `work/`. The look is done when the tradition, frames, tones, proportions, kit unit, line spec and figure ratio are all picked and `packages/atlas` holds them.

If a round needs a contact-sheet builder or a screener, write a small one in `work/`, or in `testing/look` if it should be kept.

## Prompts

The style and avoid blocks wrap every frame.

**Style block** (prepend to every frame):

```text
Isometric technical illustration, orthographic camera from one corner looking down 30 degrees, no perspective. A cutaway model: the two nearest walls and the ceiling are removed so the interior is seen whole. Hairline even-weight linework on every edge. Flat four-tone shading by face direction, top faces lightest. Warm paper background for day scenes, dark navy-charcoal for night. Only parts that show live data are brass, and each carries fine engraved scale marks; every other material follows the scene's tradition. Engineering-drawing precision with dense, purposeful detail. Calm, legible and serious, like a plate in an engineering atlas.
```

**Avoid block** (append to every frame):

```text
Avoid: perspective, vanishing points, depth of field, photographic lighting, soft gradients, bloom, neon, holograms, casino imagery, coins and dollar signs, candlestick charts, readable screens, text, letters, numbers, arrows, callouts, motion lines, watermarks, real brand logos, faces on figures, people in suits, identical desks, generic office cubicles, generic steampunk clutter, decorative gears, brass on decorative parts.
```

**Traditions** (the tradition round inserts one after the style block):

- *Built as an exchange hall of dark wood and marble, with tall arched windows, chalkboards and ticker-tape machines.*
- *Built around a sunken, stepped trading pit at the centre of a hall of desks, under a high trussed roof.*
- *Built as a modern trading floor of long rows of desks with screens, in glass, pale wood and steel.*

**1. The floor**

```text
A large trading floor seen whole as a cutaway model, filled with rows of small desks, each with a tiny faceless automaton figure, a small lit screen, a desk lamp and papers. At one end, a trading pit in front of a tall wall of plates, each a simple painted emblem over a brass gauge with engraved scale marks. A large bell on a raised stand beside the pit. Along one side wall, a row of corkboards with pinned cards. Through an open doorway, a records room of filing cabinets. At the entrance, a lobby with a few plinths holding small statues and odd machines. Plain banners with simple painted emblems hang from the rafters. A few paper planes in flight between desks.
```

**2. One desk**

```text
A single trading desk seen close, centred with wide margins. On it: a small screen showing an abstract web page, a desk lamp, a telephone, a ticker-tape machine printing a paper strip, a stack of papers and an open notebook, and a small painted frog mascot on a lily-pad base with a brass gauge with engraved marks at its foot. A faceless automaton figure with a diamond emblem on its chest sits reading the screen. A small flag on a pole is clipped to the desk's edge, lowered.
```

**3. Agents at work**

```text
Two rows of desks seen from above, agents at work. One figure has just thrown a paper plane, mid-flight toward a desk in the other row. Another stands at a corkboard on the wall, pinning a card. One desk's lamp is off and its figure is slumped asleep. One desk has a small raised flag. One figure walks down the aisle toward the pit, carrying a slip of paper.
```

**4. The screen**

The one frame that includes the interface. It drops "text" and "letters" from the avoid block, and keeps the captions as blank lines of type.

```text
A full-screen isometric cutaway of the trading floor in daylight, edge to edge with no page around it, filling a widescreen display. In each of the four corners, a small caption in the manner of an engraved atlas plate, set on the paper ground as fine blank lines of type. A slim search field floats near the top centre. A narrow paper drawer is open along the right edge, holding a small picture of an agent's screen, a note card and a receipt, beside the selected desk and not covering it. Everything else is the floor: rows of desks, the pit and its wall of plates, the bell, corkboards and the lobby, dense and varied.
```

For night versions, add: *At night, desk lamps lit, a few desks dark.*
