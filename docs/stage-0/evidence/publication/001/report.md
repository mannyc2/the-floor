# Bounded public-release audit · attempt 001

The frozen repository should not be published unchanged: `reference/cafe-reference/` has no located redistribution grant. This is the only omission path identified by this audit. A separate public export may omit that folder throughout history while preserving the complete local repository. No actual credential was found in the scanned material. This report does not approve the later integrated commit or an export that has not yet been checked.

## Exact boundary

Read-only audit interval: **2026-10-12T17:53:11.544493+00:00 to 2026-10-12T17:56:59.001881+00:00**. The scope is **five branch heads and their 49 reachable commits**, not 47 refs. Earlier progress notes counted 47 reachable commits; this frozen repeat supersedes that preliminary count. [Snapshot](snapshot.json) lists every audited commit.

| Ref at freeze | Audited head |
| --- | --- |
| `refs/heads/main` | `fb9082651bf02a7f71b6a66e4fe024c2845b2828` |
| `refs/heads/spike/look-a` | `70ec773dc2ef3d4eeec143d99d89c3896713741c` |
| `refs/heads/spike/look-b` | `6cb8c198c6bc48bb418a83f9cc11f70cdbf96a1b` |
| `refs/heads/spike/platform` | `986ad53a100e5cd4e208fe38d3dc8526f580e01a` |
| `refs/heads/stage-0` | `8afbfa77aec975a3d5256d7dd07c0ca431584b76` |

The scan covered 1,828 Git objects, 1,257 blobs and 2,443 decoded text bodies, including 50 ZIP members, 1,398 tar/tgz members, two archived PDFs (51 pages), and 146 PNG metadata inventories. Processed volume was 334,790,552 bytes, counting archives and decoded contents separately. The 96 initially non-text members were 163-byte AppleDouble sidecars; their metadata key was `com.apple.provenance`, and a raw-byte credential-pattern check found no matches. Full counts, pattern families and exceptions are in [findings](findings.json).

## Provenance and permission finding

The café copy came from [Effect-TS/cafe at `24b11ca`](https://github.com/Effect-TS/cafe/tree/24b11ca81ff476386c5b428d425ad2ee50cb4c66), confirmed from its original local Git remote and commit. The pinned upstream tree contains no LICENSE/COPYING/NOTICE file, its manifests and tracked text contain no applicable grant, and the current GitHub repository API reports `license: null`. GitHub distinguishes public viewing/forking from a general license to reproduce or distribute. See [GitHub's licensing guidance](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository).

Omitting `reference/cafe-reference/` only from the tip would leave it in history. The publication path therefore requires omitting it from every exported commit, or obtaining an applicable grant. This audit made no history changes. The separate export must also explain reference provenance and avoid links that claim the omitted source is included.

No café blob was aliased elsewhere in any of the 49 audited commits. No exact café file of at least 100 bytes was copied elsewhere among the reachable blobs or archived members. Against the frozen Stage0 active source, 45 café source files were compared with 147 active files. There were no identical blocks of at least four nonblank lines and 100 characters. Token-normalized overlap was confined to Alchemy imports/provider-stack setup in `stacks/github.ts` (up to 41 tokens) and a standard HTML doctype/meta header in `apps/web/index.html` (48 tokens). No café-specific chat/UI copied block was identified; this matching does not prove independent authorship.

The vendored Yielded source includes its MIT notice at `vendor/yielded/0adbcff-effect-4.0.3/LICENSE` (copyright 2026 Daniel van der Merwe), with upstream revision `0adbcff4c7d4b1a32a3edb1fe1bc92e245a01968` recorded in provenance. Meteora inputs include the MIT notice at `packages/chains/METEORA-LICENSE` (copyright 2026 Meteora); the recorded SDK/IDL revision is `a28b7239e71899eb52ff7aacac4dec90441885c4`. Preserve those notices. Their exact hashes and provenance are recorded in the findings.

## Credential and artifact checks

Three pattern matches were reviewed and classified as fixtures: a negative URL-permission test in `reference/first-build/packages/agents/test/agents.test.ts:70`; an isolated signer fixture in `testing/flows/_fixtures/financial-floor.ts:28`; and a recorded-provider fixture in `testing/flows/_fixtures/recorded-research.ts:136` (both latter paths beneath `reference/first-build/`). The evidence contains no matched literal values. The archived PDFs' extracted text and metadata had no credential-pattern matches.

The 84 LookB originals were independently generated with no input reference images. Their metadata/provenance establishes tool origin and retained bytes; it is not an exclusive-copyright finding. None of those PNGs contains textual or EXIF metadata. All 84 originals and seven contact sheets remain retained under the user's instruction. Local username/workspace/tool-output paths occur in 113 scanned text bodies; these are provenance locations, not credential values.

## Limits and final incremental review

The scope excludes uncommitted, ignored, unreachable/reflog-only and later-committed material. Common credential patterns and examined false positives cannot cover every possible encoding. PNG metadata was checked; this was not a fresh OCR/content audit of every historical screenshot. License findings establish which notices and grants were located, not a legal determination of every right.

While the audit ran, `spike/platform` advanced from `986ad53` to `af4285b`, and `stage-0` advanced from `8afbfa7` to `b1ea74b`. Those later commits were observed but **not admitted by this frozen record**. After final integration, compare the resulting commit with these five audited heads, inspect newly reachable/changed material and verify the separate export's all-history café omission. [The machine record](record.json) and findings keep that incremental review pending. No push was performed by this audit.

For the same object/text/archive/PNG/PDF scan, run the saved [scanner](scan.py) with Python and `pypdf` available:

```sh
python3 docs/stage-0/evidence/publication/001/scan.py /absolute/path/to/the-floor docs/stage-0/evidence/publication/001/snapshot.json work/public-audit/repeated-scan.json
```

The scanner reads only the frozen revisions; the reported manual fixture classifications, source-overlap interpretation and upstream license checks must accompany its raw matches.
