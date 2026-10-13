# Canonical JSON reference vectors

The `input/` and `output/` files are verbatim copies of all six pairs in
[`cyberphone/json-canonicalization/testdata`](https://github.com/cyberphone/json-canonicalization/tree/32a48195b9b20fe67b1795e39e4509f14d860b45/testdata),
at commit `32a48195b9b20fe67b1795e39e4509f14d860b45` (retrieved 13 October 2026).
The upstream Apache-2.0 notice is retained in `LICENSE`.

These are reference data for [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785.html),
not provider recordings. Preserve their bytes, including whitespace and lack of
trailing newlines; dprint excludes this directory and `.gitattributes` disables
Git's line-ending conversion for the upstream files. The leaf test
decodes each input and compares the native canonicalizer's UTF-8 bytes directly
with the corresponding upstream output. Expected output is never regenerated.

The upstream 100-million-number download is not vendored or claimed as tested.
The companion test adds explicit IEEE-754 boundary values and generated JSON
with fixed seeds, compared with the pinned Privy SDK's authorization formatter.
