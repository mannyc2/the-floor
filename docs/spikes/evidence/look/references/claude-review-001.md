# Part B references, attempt 001: Claude's review

Reviewed on 12 October 2026, from the uncommitted attempt 001 in `work/look-b` (84 candidates, 12 per frame, generated from `4e0c2ca`). I judged each candidate at full size against the product doc's common failures and each frame's brief. The shortlist below went to the owner, who picks one per frame or answers "none, because…". The picks are recorded in the [decision log](../../../../decisions.md); nothing here is a pick.

## Shortlist

The lean is my suggestion to the owner, not an approval. The images are listed in the order the owner saw them.

| Frame | Shortlist | Lean | Main weakness of the lean |
| --- | --- | --- | --- |
| rack-day | 06, 03, 01, 09, 12 | 06: arched brick plinth, blue enamel gauge housing, the clearest tonal structure | Only five trays |
| rack-night | 01, 06, 03, 12, 09 | 01: warm brick against navy, the best night contrast | Glossy water and brass |
| stall-day | 10, 09, 05, 02, 12 | 10: slate roof, enamel counter, and the pour lands in the gauge | The striped awning is outside the palette |
| stall-night | 03, 02, 04, 09, 01 | 03: the simplest silhouette, with the pour falling straight into the gauge | Neighbours need variants to differ |
| district-day | 09, 02, 05, 10, 11 | 09: water wheels, tiers and a glass-vault hall, the most canal-town | The whole compound is orange, not just its machine |
| district-night | 03, 10, 02, 11, 04 | 03: the only one with brick compounds and a water wheel | The hall's stalls form a busy grid |
| screen-day | 10, 01, 08, 06 | 10: a glass hall at the centre, with the pour beside the drawer | The corner captions are heavier than fine blank lines |

Weaknesses across the batch, for the tones and asset work:
- **Shading.** Every candidate has textured shading (stone grain, water ripples) instead of flat tones. The renderer decides this, so it doesn't rule a reference out.
- **Pale districts.** The districts use pale stone on pale paper, the bleaching problem the handoff warns about, so the derived tones will need darker tops than these images show.
- **Orange on the building.** Most districts paint the whole busiest compound orange. The orange accent has since been deleted (decision log), so read these as the place's own colour, not a highlight.
- **The drawer.** Every screen draws the drawer as a wooden cabinet door instead of a slim paper drawer. The interface sets the drawer, not the reference.

## Excluded, and why

- **Real perspective:** rack-day 04 and 07, and rack-night 07 (a tilted rack and converging trays).
- **Front-on, not isometric:** stall-day 04 and 11.
- **Transparent, half-white background:** stall-night 12.
- **Weaker versions of shortlisted images:** the other 44.

## The automatic screen

The automatic screen rejected 83 of 84 images, which makes it a poor filter for this batch:
- **Perspective.** Vertical edges in every rack and stall image swing by at most 0.7°, so there is no vertical convergence. The flagged band mixes two axis directions, which is what reads as convergence.
- **OCR.** The detections are brick and wave textures ("SS", "Ge", "Ba").
- **Orange count.** It splits one part wherever a shadow or brass rail crosses it.

Don't tune it further: the laws are checked on the Floor's renders, where geometry is known.

## For Codex

- **Commit by the [evidence rules](../../README.md).** Commit the 34 shortlisted originals at full size, because the owner was shown them. Keep the other 50 in `work/`, listed with their SHA-256 hashes in `candidates.csv`. Save the contact sheets as JPEG. This replaces the earlier "commit every candidate", which would have added about 290 MB to the repository's history.
- **Trim the attempt README** to the method, the thresholds and the results. One statement of each limit is enough.
- **Wait for the picks** in the decision log. Then go on to tones and proportions (look handoff, steps 2 and 3).
- **If the owner answers "none" for a frame,** add these to the next round's prompts while keeping the style and avoid blocks unchanged:
  - brick and canal-town material for districts;
  - top faces darker than the paper ground.
