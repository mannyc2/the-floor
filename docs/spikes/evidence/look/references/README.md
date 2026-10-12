# Part B reference generation · attempt 001

This attempt contains 84 independent generated originals: 12 candidates in each of seven groups. Every original, including rejected candidates, is retained unchanged with its exact prompt, output hash and tool provenance. Automatic screening flagged 83 of the 84 candidates; only screen-day candidate 08 had no automatic flags. That is not an approval or a selection. These are unshortlisted reference contact sheets. Claude review and owner picks are pending; this batch chooses no tones, proportions, kit unit or assets.

| Frame | Contact sheet | Evidence |
| --- | --- | --- |
| Key frame 4: rack, day | [PNG](rack-day/001/contact-sheet.png) · [linked sheet](rack-day/001/contact-sheet.html) | [record](rack-day/001/record.json) |
| Key frame 4: rack, night | [PNG](rack-night/001/contact-sheet.png) · [linked sheet](rack-night/001/contact-sheet.html) | [record](rack-night/001/record.json) |
| One stall, day | [PNG](stall-day/001/contact-sheet.png) · [linked sheet](stall-day/001/contact-sheet.html) | [record](stall-day/001/record.json) |
| One stall, night | [PNG](stall-night/001/contact-sheet.png) · [linked sheet](stall-night/001/contact-sheet.html) | [record](stall-night/001/record.json) |
| Key frame 6: district, day | [PNG](district-day/001/contact-sheet.png) · [linked sheet](district-day/001/contact-sheet.html) | [record](district-day/001/record.json) |
| Key frame 6: district, night | [PNG](district-night/001/contact-sheet.png) · [linked sheet](district-night/001/contact-sheet.html) | [record](district-night/001/record.json) |
| Key frame 8: screen, day | [PNG](screen-day/001/contact-sheet.png) · [linked sheet](screen-day/001/contact-sheet.html) | [record](screen-day/001/record.json) |

The screen source explicitly describes daylight, so there is no invented night-screen group. It also explicitly removes “text, letters” from its avoid block while requesting blank type strokes; that exception is preserved. The other six groups preserve the complete style and avoid blocks. The source revision is `4e0c2ca1a72166a6517cb7ca30f911e726189ece`; the source hash and verbatim shared blocks are in [prompt provenance](prompt-provenance.json). Per-group `prompts.json` files contain the full actual tool inputs and their SHA-256 hashes. Each candidate is a separate built-in image-generation call with no input image. No generated montage stands in for independent candidates.

[Summary](summary.json) gives counts by frame; [candidate inventory](candidates.csv) lists every original and its flags. All seven records use the normal evidence template. Their `status` describes the aggregate automatic screen: any flagged candidate makes that batch status `fail`. Generation completion, an automatic screen result, Claude's review and the owner's approval are distinct states. None of them is silently substituted for another.

## What the automatic screen establishes

- **P: convergence.** Canny edges and a probabilistic Hough transform find long segments. Three broad angle bands collect construction-edge families. Within each family, a length-weighted fit measures how edge angle changes across the image. A family is flagged when it has at least six segments, covers at least 18% of the image diagonal, has a fitted angular swing of at least 4 degrees, and a weighted fit score of at least 0.60. This is a convergence heuristic, not camera calibration. Differently oriented forms can create false positives; limited coverage can miss real perspective. Fewer than two usable families without a convergence flag is explicitly inconclusive.
- **O: orange regions.** The mask uses Euclidean CIELAB distance at most 45 from the product's starting accent (`#F0640A` day, `#FF7A1A` night), hue at most 36 degrees and saturation at least 0.60. A 7×7 closing bridges hairline gaps; eight-connected components smaller than the greater of 24 pixels or 0.002% of the image are ignored. Exactly one component is expected. Shadows and occlusion can split a single physical part into several components; nearby warm materials can merge. Counts are reproducible mask results, not semantic judgments about which object owns orange. These screening colours do not select a Part B tone set.
- **T: OCR glyphs.** Tesseract runs English OCR in sparse-text and uniform-block modes (PSM 11 and 6). Tokens containing two alphanumeric characters are flagged at confidence 70 or higher; single-character detections require 90. Geometric emblems and engraved marks can be mistaken for letters. The saved detections are not verified transcriptions. Readable glyphs are still flagged on the screen frame because its intended captions are blank strokes.
- **A: transparency.** Any non-opaque alpha pixels are flagged because these prompts request complete backgrounds. The original pixels are preserved; unexpected transparency is not painted over or cropped away.

Every automatic exclusion remains in the sheets. Original images are never edited to clear a flag. A result without flags is only “not flagged by automatic screen,” never “approved.” Raw OCR TSVs and orange masks are kept in `work/spikes/look/references/screening/`; each record inventories their paths, sizes, hashes and regeneration command.

The [broad synthetic controls](screening-controls.json) show parallel lines remaining unflagged, broadly converging lines being flagged, and zero/one/two separated orange patches being counted correctly. The [compact convergence control](screening-controls-compact-convergence.json) records a real false negative: its detected family covers about 300 pixels, below the approximately 305-pixel coverage threshold, despite a strong fitted convergence signal. That failure was retained, and the screening thresholds were not relaxed or tuned to make candidate images pass. These controls do not validate geometric truth in complex generated scenes.

## Reading the generated references

The generation shows the drift warned about in the handoff: perspective, smooth/material shading in place of strict flat face tones, and orange masks fragmented by shade or occlusion. Some OCR flags correspond to simple shapes. One stall-night image also returned unexpected transparency. These observations explain the automated evidence; they are not a shortlist or an artistic ranking.

After the first 24 rack images exposed projection and paint drift, the remaining 60 prompts gained a separate paragraph reinforcing parallel axonometric edges, equal size at depth and clean flat regions. The source style and avoid blocks remained unchanged, and the exact addition is stored with each affected prompt. Existing images were not regenerated, replaced or hidden.

The source district prompt identifies the busiest compound, with its machine mid-pour, as the orange part. The screen and stall prompts instead identify a pour; the rack identifies one drained tray. Review should use each actual source scene rather than invent a common accent object across all seven groups.

Claude's next step is to inspect the originals and automatic exclusions against the handoff's common failures, record any challenge to a false-positive flag, and shortlist four to six per frame where the evidence supports that many. If a frame lacks enough suitable candidates, record that shortage instead of promoting rejected material to fill a quota. Then the owner picks one or answers “none, because…”. Picks must record date and exact options. No provisional reference goes into `testing/reference/` before that pick.

## Reproduction and verification

Generation uses only the built-in `image_gen.imagegen` tool. For each entry in a group's `prompts.json`, pass its `prompt` once and omit both reference-image arguments. Copy the returned PNG and keep the tool's original. Seeds and exact provider model revisions are unavailable; another call cannot reproduce the same bytes. The first candidate's request/completion time was not recorded, so its provenance says unknown and preserves the later copy timestamp.

The analysis tools are committed under [`_tools/`](_tools/). Python 3.12.14, NumPy 2.5.4, OpenCV 5.0.0 (`opencv-python-headless` 5.0.0.93), Pillow 12.3.0 and Tesseract 5.5.1 were used. Isolated image-analysis dependencies live under ignored `work/`, not in application packages. Contact sheets were composed from unchanged images using Bun 1.4.0, Playwright 1.62.1 and local headless Chrome 155.0.8059.39, with network requests blocked. They are 2048 pixels wide, with 12 labelled cards in three columns. These are static evidence sheets, not Floor application screens.

From the worktree root, using the recorded Python environment and Tesseract on `PATH`:

```sh
python3 -m pip install --target work/spikes/look/references/analysis-deps -r docs/spikes/evidence/look/references/_tools/requirements.txt
python3 docs/spikes/evidence/look/references/_tools/screen.py
python3 docs/spikes/evidence/look/references/_tools/control-check.py
LOOK_PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs bun docs/spikes/evidence/look/references/_tools/contact-sheet.mjs rack-day rack-night stall-day stall-night district-day district-night screen-day
```

The optional argument `0.55` to `control-check.py` reproduces the compact-convergence control and intentionally exits nonzero for its missed detection; the default `0.75` uses the broader example. Candidate screening records all results without exiting early on a rejected image. Run `_tools/package-evidence.py` only after all images and sheets exist. It verifies original and copied image hashes, prompts, dimensions and record fields while rebuilding the inventory and records.

[Verification](verification.json) records integrity checks and exact scope. This branch adds static reference evidence and its analysis utilities. It has no application implementation or root `package.json` on its source revision, so application typecheck/lint/build are unavailable here; they are not reported as passing. Integration with Stage 0 must run the configured application checks.

The owner's explicit request to commit every candidate overrides the usual evidence-size cap for these full-resolution originals. The tool originals remain in their generated-image location, and all copied originals, including failures, are committed here. No credentials or application hosting resources were used.
