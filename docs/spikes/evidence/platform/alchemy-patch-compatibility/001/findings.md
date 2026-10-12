# Exact Alchemy patch compatibility

The upstream patch applies unchanged to Alchemy beta.80. It does **not** apply
unchanged to beta.81. This is an applicability result, not a claim that beta.81
cannot support the adapter.

The tested patch is the exact file from Yielded commit
`0adbcff4c7d4b1a32a3edb1fe1bc92e245a01968`, SHA-256
`11fd30507c7cd4466f65565771e493d9da1c4bc1d2fe4a546f93f95d14d433d2`.
The upstream Bun lock pins beta.80 with that patch. Both registry tarballs
passed their published SHA-512 integrity checks; every archived original file
also matched its corresponding tar member.

| Unmodified package | Dry-run result |
| --- | --- |
| `alchemy@2.0.0-beta.80` | Exit 0; every hunk applies. |
| `alchemy@2.0.0-beta.81` | Exit 1; two of three source DurableObjectBridge hunks, one of four compiled bridge hunks, and one of three source DurableObjectStorage hunks fail. Compiled storage and package export hunks apply. |

The complete outputs are [beta80-patch-dry-run.log](beta80-patch-dry-run.log)
and [beta81-patch-dry-run.log](beta81-patch-dry-run.log). Context and formatting
changes account for at least part of the drift. No adapted patch was authored,
and no beta.81 runtime result is claimed.

Reproduce by downloading the two exact tarballs in
[source-provenance.json](source-provenance.json), verifying their recorded
SHA-512 digests, and extracting each into its own clean directory. From each
package root, use the retained patch:

```sh
patch --dry-run -p1 -i /absolute/path/to/alchemy@2.0.0-beta.80.patch
```

[original-patch-inputs.tar.gz](original-patch-inputs.tar.gz) preserves the five
original files touched by the patch from each version, including both source
and compiled modules plus package exports. The provenance file lists all ten
original file hashes. The patch covers native Durable Object RPC dispatch,
interrupted-transaction rollback, and runtime module exports. Dry-run
inspection made no cloud or provider requests and did not change either
package.

The [native agent](../../alchemy-native-agent/001/findings.md) and
[native storage](../../alchemy-native-storage/001/findings.md) runtime results
use the exact patched beta.80 graph. Product adoption still requires the
adapter and its fixes to publish or an explicit decision to carry the pinned,
unpublished build and patch.

Independent root review passed: Root independent technical review: verified the artifact hashes and repeated the exact patch dry-run against both preserved original package inputs. Beta.80 returned 0 and beta.81 returned 1 with the recorded hunk failures. This establishes applicability only, not product adoption or runtime compatibility.
