# The Floor Atlas, as code

Oct 12, 2026

The Floor Atlas is the Floor's design system. The 11 October version is a good rulebook for what the map means and a poor guide to what it looks like in 3D. Nothing in the first build imported it, so every value it left out was invented three times over, in the kit, the renderer and the gate. This plan moves the Atlas into the repo as the code the renderer, the interface, the gate and the look tests all read. The published Atlas artifact becomes generated from that code, rather than something the code is copied from. A one-week look spike settles the rendering approach first.

## What the 11 October Atlas does and doesn't give a 3D build

**What it gives well:**
- The two laws: brass means data, and orange means value moving, with a table of what is orange in each place.
- Semantic colours in day and night, and the voice.
- The common failures, the reduced-motion rule, the tide gauge, the tiers, and the agents' states.

**What it never specifies.** Each of these was invented by the build:
- **Geometry and scale.**
  - The kit unit is used but never defined.
  - There are no proportions or silhouettes for stalls, housings, landmarks or figures, no tier envelopes, no works layout, and no district density.
  - The only ratio given, a figure at a sixth of a machine's height, came out at about a third and a half.
- **Materials.** Steel, glass, stone, brick, timber, enamel and paint are names only. No material has a four-tone ramp, and nothing says how glass is drawn.
- **Shading tested on a render.** The day side tone against the ground is 1.06:1, so the lighter side face vanishes into the page. Tops are lighter than the ground, and the whole range spans 1.74:1. Nothing says which side face takes which tone, how cylinders are banded, or what tone the land is.
- **Line.**
  - "1px hairline" never says whether it means CSS or device pixels.
  - There are no line classes (silhouette, crease, material boundary), no crease angle, no weight hierarchy, and no rule for thinning lines at distance.
- **Camera.** The pitch only. No zoom rungs in world units per pixel, no bookmarks, no flight curve.
- **Composition per zoom rung, and how impostors look.**
- **Motion.** The three kinds are named, but without durations or easing curves.
- **Reading scales.** A screen-space tick pitch that doesn't apply in 3D, and no linear, log or range rules.
- **Labels in 3D.** No halo over the drawing, no fade bands, no collision priority.
- **Night.** Only a token swap, with nothing on what lights up.
- **The screen.** There is no search field, drawer or bottom sheet.

**What pushed the build toward a dashboard.**
- All ten component previews are interface pieces: Note, Receipt, Plate, SignalFlag, Emblem, AtlasLabel, ViewCorners, a flat tide gauge, a flat engraved scale, and the Cover.
- The only drawings of the world are boxes on a slab, and the build matched them.
- The flat tide gauge became the timeline and the sparkline.
- Note and Receipt became a form-style desk page.

**How it drifted.** `tokens.json` is referenced nowhere. Its values were hand-copied into at least eight places: `packages/kit/src/index.ts`, `styles.css`, three HTML entry pages, the bench page, and two server pages.

| Where | Drift |
| --- | --- |
| Kit palette | No `blueprint`, `ink` or `engraving`, so nothing could be drawn in blueprint or engraved |
| Line opacity | 0.66 against the token's opaque day line, so lines read grey |
| Edge detection | A 22–28° edge threshold turns cylinders into barcodes |
| Paper | Used for quays and sheds, although it is reserved for drums, notes, receipts and plates |
| CSS | 26 font sizes against the tokens' 8 |

**The worst drift is the gate's material map** (`packages/gate/src/geometry.ts:24-35`):

| Design material | Rendered as |
| --- | --- |
| glass | frost |
| brick | rust, so every brick mill renders as a dead market |
| enamel-green | water, so the lily-pond stems read as liquidity |
| enamel, paint | paper |

Instruments break the laws too. The engraved scale is six brass boxes with no minor ticks, and the pour is a brass ball on a steel bar: brass on a trade, and never orange.

## Where it lives

The Atlas becomes `packages/atlas`. It is imported by `apps/web` (the renderer and the interface) and `apps/floor` (the gate's material and budget checks, previews and plates), so it meets the rule for packages. It contains no three.js; building three.js materials from it is `apps/web`'s job. The map model the technical design called `atlas` is renamed `packages/map`.

```
packages/atlas/src/
  tokens.ts       semantic colours per theme, type ramp, spacing
  materials.ts    each material's four-tone ramp per theme, line colour, the traditions it belongs to,
                  and whether a designer may assign it
  look.ts         line (CSS pixels, crease angle, line classes), which face takes which tone,
                  cylinder bands, land tone, what glows at night
  camera.ts       pitch and yaw; zoom rungs in world units per CSS pixel, with their label level and LOD;
                  the flight curve
  motion.ts       named curves and durations: settle, glide, flight, pour, stamp, flag, held beat
  scales.ts       the tick system in world units, the smallest on-screen spacing, linear, log and day-range scales
  proportions.ts  the kit unit, tier envelopes, figure ratio, stall footprint, district density
  chrome.ts       corners, search, drawer (at most 360 px), bottom sheet
  schema/         AssetManifest and ReferenceScene (below)
  docs/           the laws, the voice, the common failures
scripts/build-atlas.ts   generates atlas.css, the palette lookup texture, and a DTCG tokens.json
assets/<kind>/<id>/      manifest.json for every asset, with model.blend and model.glb, or the generator that writes model.glb
testing/look/scenes/     reference scene specs (*.scene.json)
testing/reference/       approved frames per scene and theme, with who approved them
apps/web/workbench/      a second Vite entry, built only for development and preview stages
```

## One source for each kind of thing

| Thing | Source | Read by |
| --- | --- | --- |
| Colours, tones, type, spacing | `tokens.ts` | The interface, through the generated `atlas.css` only; lint bans hex colours and pixel font sizes anywhere else. The renderer, through a palette lookup texture (material × tone × theme in linear space), so a theme change is one uniform |
| Materials | `materials.ts` | The gate refuses any material a designer may not assign. Brass, water, accent, frost, rust and blueprint are set only by the world. The renderer reads the palette slot |
| Line and shading | `look.ts` | The renderer; the workbench tunes it and turns a tuned value into a pull request |
| Camera rungs and flights | `camera.ts` | The renderer, bookmarks, the camera tests |
| Reference scenes | `testing/look/scenes` | The workbench and the look tests |
| Reference frames | `testing/reference` | The look tests, and the side-by-side image on every pull request |
| Assets | A manifest beside each `.glb` | The gate checks budgets and sockets; the renderer attaches instruments, logos and name plates to sockets |
| Reading scales | The scale kind in the contract's reading contract; tick drawing in `scales.ts` | The gate and the renderer |
| The screen | Foldkit components in `apps/web/src/chrome`, styled only by `atlas.css` | The workbench's screen scenes |

**Publishing.** `bun run atlas:publish` renders the Atlas from the repo and pushes the result to the published Floor Atlas artifact:

- swatches and material spheres;
- every reference scene beside its frame, in day and night;
- the screen at 1440×900 and 390×844;
- the asset catalogue with 64-pixel thumbnails and budgets.

The artifact is output only, changed through pull requests, and the hand-made HTML previews are retired.

## Assets

- **Blender, code, or both.** The commitment is to glTF, a manifest and the Atlas's conventions, not to a tool, so each asset is made whichever way suits it.
  - **Code** makes anything whose shape follows data or layout: instruments, a rack with one tray per liquidity band, coastlines, terraces, quays, paving, bridges, threads and district ground.
  - **Blender** makes anything whose quality is in its silhouette: figures and their gear, landmarks, desks, the pieces of each island's tradition, and organic props.
  - **Both** for hand-modelled modules that code assembles: a works compound or a market hall laid out from modelled pieces, and stall variants from parameters over modelled parts. Geometry Nodes can do the same inside Blender.
- **Code runs where its input is.** Code that reads live data runs in the renderer. Code that only makes variety runs at build time and writes glTF, so its output is cached, budget-checked and shown in the workbench exactly like a modelled asset.
- **Both routes follow the same conventions.**
  - Code-made geometry sets the same `_SURFACE` edge ids and `_MAT` palette slots that an artist paints in Blender.
  - It uses the same kit unit.
  - It puts sockets where the manifest says.
- **Blender stays reproducible.** `.blend` files are exported headlessly in CI (`blender --background --python export.py`), so a `.glb` never drifts from its source.
- **Export conventions:**
  - Custom properties become glTF `extras` and then `userData` in three.js.
  - Socket names are empties named in `[a-z0-9_]`, because three.js rewrites other characters.
  - Custom vertex attributes start with an underscore (`_SURFACE` for edge ids, `_MAT` for palette slots), because Blender exports only those.
  - Meshes are compressed with meshopt and quantized, and checked with gltf-transform plus a budget script against the manifest.
- **Generated models play a supporting role.** Image-to-3D tools (Meshy 6, Rodin Gen-2, Tripo, Hunyuan3D, TRELLIS.2) suit blockouts, organic props such as reeds, lily pads and statues, and exploring variants. They are weakest at exactly what this look depends on: planar faces and crisp creases. Their output gets retopologised before it ships.
- **No textures** beyond logo decals.

```ts
const Vec3 = Schema.Tuple([Schema.Finite, Schema.Finite, Schema.Finite])

export const AssetManifest = Schema.Struct({
  id: Schema.String,                                   // "stall/canal-brick"
  kind: Schema.Literals(["stall", "housing", "landmark", "figure", "prop", "desk"]),
  tradition: Schema.Literals(["any", "harbour-glass-steel", "canal-brick", "shipyard-timber"]),
  source: Schema.Union([
    Schema.TaggedStruct("Modelled", { blend: Schema.String, glb: Schema.String }),
    Schema.TaggedStruct("Generated", { generator: Schema.String, params: Schema.Record(Schema.String, Schema.Union([Schema.Finite, Schema.String, Schema.Boolean])) }),
  ]),                                                  // Blender or code; the renderer only ever sees the glb
  envelope: Vec3,                                      // kit units; checked against the glb's bounds
  materials: Schema.Array(AssignableMaterialId),       // the _MAT slots
  variants: Schema.Array(Schema.Struct({ id: Schema.String, node: Schema.String })),
  sockets: Schema.Array(Schema.Struct({
    node: Schema.String,                               // an empty in the glb
    kind: Schema.Literals(["instrument", "logo", "nameplate", "tide-gauge", "figure", "desk"]),
    accepts: Schema.Array(InstrumentKind),
    maxSize: Vec3,
  })),
  idle: Schema.optional(Schema.Struct({ clip: Schema.String, periodMs: Schema.Int })),
  budget: Schema.Struct({
    triangles: Schema.Int, drawCalls: Schema.Int, animatedNodes: Schema.Int, textureBytes: Schema.Int,
  }),
  lod: Schema.Struct({ impostorFrom: Rung }),
  reference: Schema.String,                            // the reference scene that shows it
})

export const ReferenceScene = Schema.Struct({
  id: Schema.String,
  keyFrame: Schema.optional(Schema.Int),               // the product doc's key frame it realises
  rung: Rung,
  camera: Schema.Struct({
    center: Vec3, worldUnitsPerCssPx: Schema.Finite,
    viewport: Schema.Tuple([Schema.Int, Schema.Int]), dpr: Schema.Literals([1, 2, 3]),
  }),
  themes: Schema.Array(Schema.Literals(["day", "night"])),
  clock: Schema.Struct({ seconds: Schema.Finite, seed: Schema.Int }),
  placements: Schema.Array(Schema.Struct({
    asset: Schema.String, variant: Schema.String, at: Vec3,
    readings: Schema.optional(Schema.Record(Schema.String, Schema.Finite)),
  })),
  source: Schema.Literal("synthetic"),                 // scenes can never reach the live map
  expect: Schema.Struct({
    accentPart: Schema.OptionFromNullOr(Schema.String), brassParts: Schema.Array(Schema.String),
    labels: Schema.Array(Schema.String), minTickSpacingPx: Schema.Finite,
    toneHistogramMax: Schema.Finite, silhouetteIoUMin: Schema.Finite,
  }),
  reference: Schema.Struct({
    day: Schema.String, night: Schema.String, approvedBy: Schema.OptionFromNullOr(Schema.String),
  }),
})
```

## The workbench

The workbench is a development-only entry in `apps/web` that uses the real Renderer service, so what is tuned is what ships. A bundle check asserts the production build contains no workbench chunk. It holds:

- A scene picker with day and night, rung bookmarks, a frozen clock with a scrubber, and pixel ratios 1, 2 and 3.
- Reference comparison: flicker between the render and its frame, onion skin, and a difference view.
- Buffer views: tone, surface id, depth, edges alone, and the orange and brass masks.
- A Tweakpane bound to `look.ts`, which outputs its changes as a patch.
- An asset viewer: variants, sockets drawn in place, the 64-pixel thumbnail, and the budget readout.
- An instrument gallery at fractions 0, 0.5 and 1 on linear and log scales.
- Draw calls, triangles and frame time.

## Look tests

**Making renders deterministic:**
- Chrome runs with `--use-angle=swiftshader-webgl --enable-unsafe-swiftshader`, and the test asserts the renderer string. Since Chrome 139 there is no automatic fallback, and a silent one still produces a screenshot.
- Device pixel ratio and canvas size are fixed.
- Fonts are awaited.
- Time and `requestAnimationFrame` come from Playwright's `page.clock`, with `pauseAt` and `runFor`.
- Randomness is seeded.

**For each scene, theme and pixel ratio:**
- A tight pixel diff against the last approved render, at about 0.1–0.5% of pixels.
- Metrics against the painted reference, read from the id buffer:
  - the tone histogram;
  - line density per tile;
  - silhouette overlap;
  - exactly one orange part;
  - brass only inside instrument masks;
  - the smallest tick spacing in pixels.
- The side-by-side image posted to the pull request for sign-off.

## The look spike

This runs for about a week, before the new Atlas is written and in parallel with the platform spike. It settles the line technique, the tone values, the kit unit and proportions, and whether generated models are usable.

**Inputs.**
- From day 1, an artist paints over key frame 4 (the depth rack), one stall and a patch of district, in day and night.
- Hand-modelled: one stall with three variants, the depth-rack housing and one figure, with `_SURFACE`, `_MAT` and socket empties.
- Generated by code: the rack's trays and float, and a patch of paving and quay, writing the same attributes, so both routes are judged by the same frames.
- The same stall from Meshy or Rodin, retopologised.
- A small scene: twelve stalls in a hall, the rack with its float and tide gauge, two figures, paving and labels.

**The matrix.**
- **Three line techniques:**
  - A: a normal-and-depth edge pass, with smooth normals on cylinders.
  - B: a surface-id-and-depth edge pass. The artist decides which edges draw, and a cylinder is one surface, so it draws no stripes.
  - C: hard edges plus conditional silhouette lines as fixed one-CSS-pixel `LineSegments2`.

  A Blender Line Art render from the same orthographic camera is the ideal line target.
- **Three tone sets:**
  - the current tokens;
  - a darker set (range at least 2.5:1, each side face at least 1.25:1 against the ground, tops below paper);
  - a set with a distinct land tone.
- **The rest:** two themes, three rungs (district, works, machine), and pixel ratios 1, 2 and 3.

**What to measure.**
- **Art direction.** A blind ranking against the painted reference, and the newcomer test.
- **Line accuracy:**
  - an edge F-score against Line Art and the painting's line layer;
  - lines per 100 pixels on cylinders;
  - stroke width across pixel ratio and zoom, with a target of 1 CSS pixel ± 0.25.
- **Tones.** Lightness steps between adjacent faces and against the ground, and whether a stall, a works and a machine can be told apart as 64-pixel thumbnails.
- **Cost:**
  - GPU and CPU milliseconds per frame on the phone profile and one real phone;
  - draw calls with a thousand instanced stalls;
  - render-target memory;
  - whether lines survive in impostors.
- **Pipeline.** Hours per stall variant by hand versus generated and cleaned up.
- **Determinism.** Twenty SwiftShader runs per scene and their largest pixel difference.
- **Backend.** WebGL against WebGPU: conditional lines are WebGL-only, and `Line2` has a separate WebGPU material.

**Exit.** Pick the technique, and fix the tone values, the kit unit, the line spec and the figure ratio. These become the first contents of `packages/atlas` and the first approved reference frames.

## Sources

- [Design Tokens Format 2025.10](https://www.w3.org/community/reports/design-tokens/CG-FINAL-format-20251028/), W3C Community Group, the first stable DTCG format
- [Better outline rendering using surface ids](https://omar-shehata.medium.com/better-outline-rendering-using-surface-ids-with-webgl-e13cdab1fd94), Omar Shehata
- [LDrawConditionalLineMaterial](https://threejs.org/docs/pages/LDrawConditionalLineMaterial.html) and [LineMaterial](https://threejs.org/docs/pages/LineMaterial.html), three.js docs
- [three-edge-projection](https://github.com/gkjohnson/three-edge-projection), for vector plates and ground-truth line maps
- [three.js end-to-end screenshot harness](https://github.com/mrdoob/three.js/blob/dev/test/e2e/puppeteer.js)
- [Clock](https://playwright.dev/docs/clock), Playwright docs
- [SwiftShader](https://chromium.googlesource.com/chromium/src/+/da170c2267b2201954efe1c8fa5d2d89ab09f7bf/docs/gpu/swiftshader.md), Chromium docs
- [gltf-transform CLI](https://gltf-transform.dev/cli)
