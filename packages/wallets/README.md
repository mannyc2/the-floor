# Wallets

The wallet provider's service edge, shared by the Floor and the future signer: today, a native Privy client. It is a package rather than part of `apps/floor` because the signer will need it, and the signer may not import Floor application code.

`@floor/wallets` provides:
- `PrivyWallets`: `createWallet`, `createQuorum`, `createPolicy` and `signMessage`, over Effect's HttpClient with no Privy SDK. Inputs are closed Schemas (`WalletInput`, `QuorumInput`, `PolicyInput`). Signing takes an `Authorization`: the key that co-signs the request.
- `PrivySettings`: the app id, and the app secret as `Redacted`.
- `P256`: request authorization signatures. Each request is canonicalized (RFC 8785) and signed with P-256 through Web Crypto, and the signature is converted to the ASN.1 DER form Privy expects (`signatureDer`).
- `PrivyFailure`: one tagged error. HTTP failures keep their original cause inside `Redacted`, because the cause can carry the signature header.

`@floor/wallets/testing` holds two probes: one checks the native signing primitives with an ephemeral key, and one runs the client against a local HTTP fixture. Production must not import it.

The tests check canonical JSON ordering and rejection, DER encoding, key-import failures that stay redacted, that a co-signature covers the exact body, URL, app and idempotency header, the documented endpoint shapes, and that missing authorization or a bad wallet id fails before any request is sent. Nothing here has reached Privy's sandbox yet: wallet creation, the two-of-two quorum with the signer and policy enforcement are the open check in [the platform doc](../../docs/platform.md#wallets).

Run `bun run test` here, or the root checks.
