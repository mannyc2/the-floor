Unpublished origin-tracking regression test

This run used reviewed source stage-0 commit 8210d54599e6bc0487a654e3177b3512e3ea23ed. It is a validation export only. Root will create a separate export from the final reviewed source revision. No push was attempted and both copied repositories retain default-deny publication guards.

Only five canonical local branches are admitted: main, stage-0, spike/look-a, spike/look-b and spike/platform. The only permitted non-branch refs are their five exact refs/remotes/origin/ counterparts. Every present tracking ref must exactly match the corresponding live public branch observed directly from the approved GitHub URL. Unknown refs, including origin/HEAD, are rejected for explicit review.

The exporter never fetches into, deletes from or rewrites the original repository. It snapshots all original refs, validates the cloned mirror against that complete snapshot, removes the validated tracking refs only from the isolated mirror using their expected old object IDs, and computes original history from the frozen canonical head object IDs. The exclusion recipe and original-ref/config/worktree integrity checks remain unchanged.

Strict tracking equality intentionally rejects stale tracking refs after a later publication. A future export requires explicit review and an explicitly authorized refresh of those original tracking refs before retrying; the exporter does not perform that refresh or infer ancestry-based approval.

origin-tracking-test-results.json in the parent tooling directory records 15 pure positive/negative policy checks. result.json and excluded-origin-tracking-refs.json record the live observation and export. regression-result.json compares every shared mapping against both the first published export and next-6efcd61 and records fsck results for mirror and checkout.
