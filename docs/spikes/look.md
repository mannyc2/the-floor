# Look spike handoff

Status: **Part A done; the owner picked technique B on WebGL on 12 October 2026. Part B starts now.** Tones, proportions, the kit unit and reference frames are not picked yet.

The spike settles how the map is drawn before Stage 0 writes the Floor Atlas. It runs in two parts:

- **Part A, the rendering technique.** It needs no art inputs.
- **Part B, references and the look.** Agents make the reference images and assets, a different agent reviews them, and the owner picks between shortlisted options.

## Who does what

There is no human artist or art director. The roles the revised docs gave to people are filled like this:

| Role | Who | Notes |
| --- | --- | --- |
| Reference images | Codex's image generation | Generated from the product doc's key frames, with its style and avoid blocks |
| Assets | Claude and Codex, as code | three.js generators, and SVG profiles lathed or extruded into geometry. No Blender for the MVP (see the decision log) |
| Review | The agent that didn't make the thing | It checks against the Atlas laws and common failures, then shortlists. It filters; it doesn't approve |
| Approval | The owner, by picking | The owner sees a short set of options and picks one, or says "none, because…". Nobody asks the owner to draw, model or tune values |
| Newcomer test | Someone the owner asks who hasn't seen the Floor | If nobody is available, it is recorded as not run, not as passed |

An agent never approves its own output, and a review by the other agent is not an approval.

## Read first

1. The [retrospective](../floor-docs-2026-10-12/retrospective.md), findings 1–3 and "Changes the Floor Atlas needs", on why the first build's screenshots are anti-references.
2. The [product doc](../floor-docs-2026-10-12/the-floor.md): the map-first screen, the Atlas foundations, key frames 4, 6 and 8, the camera, and the brass and orange laws.
3. The [technical design](../floor-docs-2026-10-12/technical-design.md): the look as acceptance, the Floor Atlas in the repo, assets, the renderer, the camera and the targets.
4. The [Floor Atlas plan](../floor-docs-2026-10-12/floor-atlas-plan.md) for asset conventions, the workbench and deterministic tests. Where it says an artist paints or models, read this handoff instead (see the [decision log](../decisions.md)).
5. The [Effect cookbook](../floor-docs-2026-10-12/effect-4-cookbook.md) and the workspace conventions, before writing code. Inspect installed APIs rather than guessing them.

Don't copy the first build's renderer, kit, gate geometry or dashboard into the experiment. Scratch output goes in `work/spikes/look/`. Evidence goes in [`docs/spikes/evidence/look/`](evidence/README.md), one record per attempt from the [template](evidence/record.template.json).

## Part A: the rendering technique

Part A settles which line technique survives on accuracy, repeatability and cost. It doesn't choose tones or approve frames.

**The stand-in scene, all built by code:**
- **Stalls.** Twelve stalls in a hall, from one parametric stall generator with three variants.
- **The rack.** The depth-rack housing with its trays, float and tide gauge.
- **Figures.** Two figures, lathed or extruded from SVG profiles.
- **Ground.** Paving and a quay, plus atlas labels.
- **Attributes.** Every mesh carries the Atlas conventions: `_SURFACE` edge ids, `_MAT` palette slots and the kit unit.

Build the stall both as a three.js generator and from SVG profiles, so both code routes face the same measurements.

**The line target.** Use [three-edge-projection](https://github.com/gkjohnson/three-edge-projection), which extracts the visible edges of the same scene from the same orthographic camera on the CPU, as the ground truth. For the primitive parts (boxes, cylinders, trays), check it against silhouettes computed directly from their geometry.

**The matrix.** 3 techniques × 2 themes × 3 rungs × 3 pixel ratios = 54 cells per backend, with every cell recorded, including failures and unsupported combinations:

| Dimension | Variants |
| --- | --- |
| Technique | A: a normal-and-depth edge pass with smooth cylinder normals. B: a surface-id-and-depth edge pass. C: hard edges plus conditional silhouette lines as `LineSegments2` |
| Theme | Day, night |
| Rung | District, works, machine |
| Pixel ratio | 1, 2, 3 |

Use the current Atlas tokens for tones. Tone choice belongs to Part B.

Start on WebGL, then record WebGPU support and cost for each technique. three.js now ships a WebGPU conditional-line material (`LDrawConditionalLineNodeMaterial`), and `Line2` needs a separate WebGPU material, so whether each technique holds a fixed CSS-pixel width on WebGPU is something to measure.

**What to measure:**
- **Line accuracy.** Edge F-score against the three-edge-projection target, and lines per 100 pixels on cylinders.
- **Stroke width** across pixel ratio and zoom; the target is 1 CSS pixel ± 0.25.
- **Repeatability.** Twenty SwiftShader runs per cell, using the Atlas plan's flags, with the renderer string asserted. Record the largest pixel difference.
- **Cost:**
  - GPU and CPU milliseconds per frame on the phone profile (390×844 at a pixel ratio of 3, CPU throttled four times);
  - on a real mid-range phone if the owner has one to hand, recorded as not run otherwise;
  - draw calls with 1,000 instanced stalls;
  - render-target memory;
  - whether lines survive in impostors.
- **Effort by route.** Agent time per asset for the three.js generator against the SVG-profile route.

**Exit.** A technique recommendation with its measurements, and one page of side-by-sides (the three techniques on the same frames) for the owner. The owner's pick, or "any of these", is recorded. A technique that fails repeatability or the phone budget isn't shown as an option.

**Result.** B, the surface-id-and-depth pass, on WebGL; A is the fallback. The owner saw no difference between A and B and took the optimal one, so the measurements decided (see the [decision log](../decisions.md)). Two findings carry into Stage 0: thin lines don't survive being baked into 64-pixel impostors, so distant rungs need their own outline pass or LOD; and no real phone has been tested. Evidence: `docs/spikes/evidence/look/report.md` on `spike/look-a`.

## Part B: references and the look

Part B makes the reference frames, then fixes tones, proportions and the kit unit against them.

### What Part B has to fix

The owner's verdict on Part A's stand-in world was "quite ugly". It was test geometry in the first build's tokens, and it shows the product doc's warning that rules aren't a target:

- **Nobody designed the forms.** Stalls are boxes with a slot cut in, the rack is a stack of identical slabs, and the figures are plain turned shapes. Every asset is designed from modules, and the stall gets the most care.
- **There is no tonal structure.** By day almost every face is white on near-white paper, so tops, sides and ground merge; the only colour is the flat blue of the trays and quay. By night everything is one grey-blue. The style block asks for four tones by face direction, tops lightest, sampled from the picked references.
- **The ground is the loudest thing in the frame.** Paving joints are drawn as heavily as buildings, so an empty grid dominates. Try a lighter line tone for ground joints: B knows which surface each edge belongs to, so the weight can stay even while the tone varies.
- **There is no density or composition.** Twelve stalls sit in a grid on an empty plaza, with no hall, signage, paths, plinths or tower. Key frame 6 is the target: a covered hall packed with dozens of tiny stalls, a ring of compounds, and one tower.
- **There is no tradition or material.** Nothing says canal town, brick or riveted steel.

The owner's next look at the Floor is the reference contact sheets, not more renders of stand-in geometry. Renders go back to the owner once assets are rebuilt against picked references.

### 1. References

- **Generate.** Start with key frame 4 (the depth rack), one stall and key frame 6 (a district in tiers), each in day and night, then key frame 8 (the screen). Use the product doc's style and avoid blocks unchanged, and make 12–20 candidates per frame.
- **Screen automatically.** Reject candidates showing perspective, text or letters, or more than one orange region. Count orange regions in a palette-distance mask, and find text with OCR.
- **Review.** Claude, which didn't generate them, shortlists 4–6 per frame against the common-failures list, with a one-line note on each candidate's weaknesses.
- **Owner picks.** The owner gets one contact sheet per frame, picks one, or answers "none, because…", which feeds the next round. Picks are recorded with the date and the options shown. Picked frames become the provisional reference frames, which Stage 0 commits to `testing/reference/`.

Image models drift on exactly what the Floor cares about: true orthographic projection, a single orange part, readable brass scales, and no text. So a reference sets the composition, density, silhouettes and tonal mood. It does not set exact geometry or readings. The laws are checked on the Floor's own renders, not on the references. Line accuracy comes from Part A's edge-projection target, because generated references have no clean line layer.

### 2. Tones

- **Candidates.** Derive two or three tone sets from the picked references by sampling the face tones in each frame. Each must meet the Atlas plan's contrast targets: a range of at least 2.5:1, each side face at least 1.25:1 against the ground, and tops below paper.
- **Render.** Render the stand-in scene with Part A's technique in each tone set.
- **Review and pick.** The other agent shortlists, then the owner picks blind, with renders unlabelled and set beside the reference.

### 3. Proportions and the kit unit

- **What to derive.** The figure ratio, stall footprint, works envelope and district density.
- **Where from.** The picked references and the product doc's stated ratios, such as a figure about a sixth of a machine's height.
- **How to decide.** Render two or three variants, then review and pick the same way as the tones.

### 4. Assets by route

Make the stall, the rack housing and one figure by both routes: a three.js generator, and SVG profiles turned into geometry. Compare each against the picked references using:
- the tone histogram;
- edge density per tile;
- silhouette overlap with the reference's main forms;
- whether a stall, a works and a machine are distinguishable as 64-pixel thumbnails;
- the manifest's budgets and sockets;
- agent effort.

The other agent reviews; the owner picks only where routes differ visibly.

### 5. The newcomer test

Show someone who hasn't seen the Floor the district render in the picked technique and tones, and ask which market is busiest and which part is the orange one. Record their answers as observations, separate from the metrics.

## What every look record holds

The template's `look` block is filled in for every record. It covers:
- **The render:** technique, tone-set revision, theme, rung, pixel ratio, camera, canvas, backend, renderer string, device profile, clock and seed.
- **The results:** the metrics, with their threshold source.
- **Review:** who made the thing (which agent and route), the cross-review (which agent, verdict and notes).
- **The owner's pick:** the options shown, what was picked, the owner's note and the date.

The rest of the record follows the platform handoff's fields.

## Exit before Stage 0

The handoff to Stage 0 is:
- the chosen line technique and backend;
- the exact tone values;
- the kit unit, line spec, figure ratio and proportions;
- the picked reference frames;
- the evidence behind each.

Every one of these carries the owner's recorded pick. Decisions go in the [decision log](../decisions.md) before implementation uses them. Stage 0 builds the Atlas package, the generated stylesheet and palette, the workbench and the look-test harness from these inputs.

Record in the result report, rather than closing by assumption:
- which technique and backend survive repeatability and the phone profile;
- which tone set and proportions were picked, against which frames;
- which asset routes met the references, at what effort;
- what remains weak at distant rungs, at each pixel ratio, or on a real phone;
- whether the newcomer test ran, and what it found.

Until the picks are recorded, the spike stays queued or in progress, and nothing in it is described as approved.
