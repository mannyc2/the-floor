# Spike evidence

Evidence from the platform and look spikes is committed here, so the owner can review it and agents in other worktrees or in the cloud can read it. Scratch output stays in `work/`, which git ignores.

## Layout

```
docs/spikes/evidence/
  platform/<check_id>/<attempt>/record.json   one record per attempt, plus its small artifacts
  look/<check_id>/<attempt>/record.json
  platform/report.md, look/report.md          each spike's result report, linking its records
```

`check_id` is a stable kebab-case name, such as `agent-do-browser` or `technique-matrix`. `attempt` counts from `001`, and a new attempt never overwrites an old one: a failed attempt is evidence too.

A record is for something that ran. When the environment stops a spike before anything runs (a full disk, a missing account or key), say so in a sentence in the report and stop: no attempt records, matrices of `not_run` cells or reviews of blocked evidence.

## What a record holds

Copy `record.template.json`. The fields are the ones defined under "Evidence record" in the platform handoff. Look records also fill the `look` block, which covers technique, tone set, theme, rung, pixel ratio, camera, backend, renderer string, metrics, picks and approvals. A field that doesn't apply is `"n/a"` with a reason, never left out. An unknown value, such as cost, is `"unknown"`, never zero.

## What gets committed, and what doesn't

| Commit | Keep in `work/spikes/<spike>/<check_id>/<attempt>/`, outside git |
| --- | --- |
| `record.json`, always | Full render matrices, the twenty-run determinism sets, browser traces, videos, raw captures |
| Trimmed logs and the exact commands | Anything larger than 1 MB, or more than 10 MB per attempt in total |
| Contact sheets: downscaled side-by-sides of renders against references, at most 2048 px wide | Intermediate builds and caches |
| Frames presented to the owner for a pick, and the picked frames, at full size | |
| Measurement tables (CSV or JSON) | |

Every artifact kept outside git is still listed in the record's `artifacts`, with its path, size, SHA-256 and the command that regenerates it. Anything the owner needs to see to make a decision is committed, even if it is large; nothing else large is.

## Never

These never go in a record, an artifact or a commit:

- secret values, API keys, cookies or session tokens;
- private wallet keys or authorization headers;
- browser live-view URLs, which are private;
- private mandate text.

A record redacts these at the source; it doesn't store them and promise to delete them later.

Two more rules:

- **Results are not approvals.** A passing automated metric, an agent's recommendation or a reviewer's shortlist is not an approval. Only the owner's recorded pick is (see the look handoff).
- **Old screenshots are not evidence.** `reference/first-build/testing/e2e/*.png` and the first build's other screenshots are anti-references, never evidence for this workspace.
