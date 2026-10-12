# Public export and first push · attempt 003

The reviewed integrated source `3dc2327ca56aac9ac949d33cfc797b90748206ac` was published as [`b606b0224b50ebbf86846ca78968e97057551604`](https://github.com/mannyc2/the-floor/commit/b606b0224b50ebbf86846ca78968e97057551604). Root reported the successful initial push at **18:08 UTC on 12 October 2026**. A separate read-only remote check at **2026-10-12T18:11:44.927460+00:00** confirms all five branch tips:

| Public ref | Observed commit |
| --- | --- |
| `refs/heads/main` | `b606b0224b50ebbf86846ca78968e97057551604` |
| `refs/heads/spike/look-a` | `a4f8d28446d531280b3173f0e3c3211c7f499ff6` |
| `refs/heads/spike/look-b` | `04b916cd298fc131a4451c2b3ce17a1669f6704f` |
| `refs/heads/spike/platform` | `8fa188b70935ef18688c6da867e08d77962ca424` |
| `refs/heads/stage-0` | `b606b0224b50ebbf86846ca78968e97057551604` |

The [original export result](export-result.json) is preserved byte-for-byte with its historical `verified-unpublished` status. This new record adds the subsequent push observation. Public `main` intentionally points to the reviewed Stage0 result; the export result's separate `filteredRefs.main` remains the historical mapping of local `main`.

Independent comparison covered **54 mapped commits and 22,900 tree entries**, retaining **1,204 unique blobs**. Every mapped tree matches its source after removing only `reference/cafe-reference/`; all71 café blob IDs are absent. Commit author/message metadata and mapped parent topology match for all54 commits. All84 generated image originals remain byte-identical, and the existing source refs and worktree heads are unchanged. The original local repository remains intact. The exporter also recorded unchanged source configuration during export; that earlier configuration comparison was not reconstructed after the push.

The retained [commit map](commit-map.txt), [source refs](source-refs.json), [image inventory](look-b-originals.json), [tool sources](tooling/export.ts) and [independent verification](independent-verification.json) establish the mapping. Tool hashes match the captured exporter result. The guard's ten saved scenarios passed, including rejection of unreviewed updates, excluded paths, renamed excluded blobs and contaminated refs. A fresh read-only guard invocation in the approved publication checkout passed for the five reviewed updates and54 clean commits. The separate mirror still rejects updates under its default empty approval policy; no policy was changed by this audit.

The first HTTPS upload failed with HTTP400 and zero remote refs, according to the root operator's contemporaneous observation. Retrying with HTTP/1.1 and an increased `http.postBuffer` succeeded **without force**. The raw transport output and exact buffer value were not retained here; the resulting refs were independently confirmed. [Push observations](push-observation.json) distinguish those reported transport facts from the remote read.

**No CI pass is claimed.** Root observed no CI/check suite at initial branch creation. Later proof-PR checks belong in separate CI evidence. This audit made no push, source-history change or commit; only this evidence folder and the requested review bookkeeping in attempt002 were prepared for root's next evidence commit.
