# Picked reference scenes

The nine image `ReferenceBrief` specs preserve the owner's 12 October 2026 image picks from [the decision log](../../../docs/decisions.md#the-look). The day PNGs in [`testing/reference`](../../reference/) are byte-exact copies of the selected candidates. Their hashes and original generation paths are in each spec. No pixels have been corrected or regenerated.

The briefs are the first stage of the [Atlas reference scenes](../../../docs/atlas.md#assets), **not executable `ReferenceScene` instances or renderer targets**. They name the frame each future scene realises, its intended zoom rung, visible composition and the corrections that the build must make. The `rung` is an intended view category, not an approved camera scale. All paths in the JSON are repository-relative.

`OwnerApproved` applies only to the selected image and its composition, density, silhouettes and mood. It does not approve the generated projection, text, materials, brass decoration or other slips. The decision log and Atlas laws still govern, and every scene containing traders inherits the five recorded figure corrections: a non-gold emblem, no jacket close to brass, a curled wrist for a plane throw, no mouth in the shouting pose, and a somewhat larger head for readability at 40 pixels. The character sheets include those corrections explicitly. No 40-pixel readability measurement is claimed here.

Camera values, clock, asset placements and numeric expectations use `{ "_tag": "Pending", "reason": "…" }` until the tone and proportion picks, kit unit and generators make them concrete. `themes` names both intended themes; `reference.night` is pending because the owner dropped generated night rounds. Night will be rendered by the Floor. Pending fields must never be interpreted as zero, an empty successful test, an executable scene or a passed comparison.

The current [look harness](../README.md) still captures its labelled synthetic scene and compares it to independent CPU line targets. Generated reference images have no clean line layer and must not replace those targets. Once the real reference scenes exist, migrate these briefs into the Atlas `ReferenceScene` schema, retaining each image hash, source and owner decision, and record renderer baselines separately from image picks.

The original nine-image preservation evidence remains in ignored `work/look/reference-preservation-001/`. The current `bun work/look/reference-preservation-002/verify.ts` checks the exact ten-brief/ten-image set, retains the original nine strict assertions, and separately validates the approved material brief. It checks byte-exact image copies, dimensions, SHA-256 hashes and the recorded approval boundaries. The first nine briefs still leave renderer fields and night references pending.

The [13 October colour audit](../../../docs/atlas.md#reference-colour-audit--13-october-2026) checked every colour rule against all nine images. Its per-frame build corrections are appended to the briefs. No reference PNG was altered. The owner subsequently approved corrected day material A, with brass and engraving provisional until real instrument geometry exists; night remains a separate pick.

## Approved day material study

`materials-day.json` is a separate `MaterialReferenceBrief`, not an image-generation `ReferenceBrief` or an executable look-test target. Its byte-exact `testing/reference/materials-day.png` preserves the owner's corrected A choice from 13 October. `approvedVisibleDayValues` stores only the shown day material colours; `lineOpacity` is recorded separately, and brass and engraving live under `provisionalDayInstrument`. Unshown support slots are explicitly unreviewed, and no placeholder night values or obsolete diagnostic aliases are promoted.

The brief records the real capture configuration and hashes for reproduction. That metadata does not approve the camera scale, blockout proportions, instrument geometry, kit unit, interface or renderer acceptance. The owner requested a separate night pick derived from the approved day materials, with the lights down and desk lamps and screens lit.
