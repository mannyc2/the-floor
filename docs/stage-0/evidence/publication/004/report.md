# Incremental publication and tracking-ref fix · attempt 004

Source `7727aff85f4ac8f5b9907f35d39284a53d05bb2a` is published on `stage-0` as [`cd5699b4c44870af9b0a1842f64e3cfbd82370fb`](https://github.com/mannyc2/the-floor/commit/cd5699b4c44870af9b0a1842f64e3cfbd82370fb). A read-only public-ref observation at **2026-10-12T19:08:48.834245+00:00** confirms this. Public `main` remains at `b606b0224b50ebbf86846ca78968e97057551604`; the three spike tips are unchanged.

The [export result](export-result.json) and [incremental check](incremental-check.json) retain their original prepublication statuses and bytes. The latter proposed updates to both main and stage-0; only stage-0 was published in this step. The export's mapped local-main commit is also not a claim about public main. [Publication observations](publication-observation.json) distinguish these states.

Independent verification covered **63 mapped commits and 30,600 tree entries**, with **1,286 unique retained blobs**. Every tree matches its source after removing only `reference/cafe-reference/`; all 71 forbidden Café blob IDs are absent. Commit metadata and mapped parent topology match for all 63 commits. All 84 original generated images remain identical. All **59 prior published mappings** from `next-6efcd61`, and all 62 mappings from the intermediate regression export, remain unchanged. `git fsck --full --strict` passed with empty logs for both final mirror and checkout.

## Why the exporter changed

An external fetch had added five `refs/remotes/origin/` refs pointing at already filtered public history. The earlier exporter rejected non-branch refs before creating a run directory. The revised exporter accepts only the five exact tracking names corresponding to `main`, `stage-0`, `spike/look-a`, `spike/look-b` and `spike/platform`, and validates each present target against a direct read of the reviewed public URL. It also limits canonical local heads to those five names; unknown refs require review.

The exporter snapshots every original ref. After cloning and checking that full snapshot, it deletes the validated tracking refs **only in the isolated mirror**, using their expected old object IDs. Rewrite input comes from the five frozen canonical head object IDs, excluding filtered tracking history. The original filter recipe, commit preservation, forbidden-blob checks and source-ref/config/worktree integrity checks remain unchanged. The captured result records five excluded tracking refs and their live validation.

The [15 policy cases](tracking-regression/origin-tracking-test-results.json) cover accepted canonical refs, matching tracking refs, and rejection of unknown namespaces, stale targets and missing branches. The retained test source and helper hashes identify the tested code. The separate `8210d54` regression was an unpublished test: 62 mappings, unchanged prior 54/59 mapping sets, and clean integrity checks. The final `7727aff` export uses identical tool bytes.

Tracking equality is intentionally strict. After a later push, stale tracking refs require explicit review and an explicitly authorized refresh before another export. The exporter never fetches into or rewrites the original repository and never automatically approves unknown refs. Both isolated repositories retain the publication guard; this audit did not change its policy or invoke a push.

## Scope

The [independent verification](independent-verification.json), complete commit map, source-ref snapshot, image inventory, exact tools and regression artifacts are retained here. Source refs, worktree heads and configuration remained unchanged during this independent audit; the captured exporter likewise records unchanged source state during export. Historical evidence retains its original source commit IDs and scope even though public commit IDs differ.

No private Cloudflare account baseline or preview resource inventory is retained. No CI, preview-flow, teardown or Stage 0 acceptance is claimed. Those results belong to separate evidence. This packaging performed no commit, head change, push or remote mutation.
