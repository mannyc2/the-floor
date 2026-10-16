# Chain construction boundary

This is unsigned construction, not a launch workflow: simulation, policy approval, signing, broadcast, vesting and pool quotation remain later work.

`@floor/chains/solana` provides `MeteoraLaunch` and its Layer. The caller supplies every identity, amount-bearing config, token metadata, recent blockhash, expiry height and RPC endpoint. Effect HttpClient reads the quote mint owner and preserves the returned slot; Kit owns address validation, PDAs, Codama codecs and serialization. The bounded path supports the tested legacy SPL base and quote token programs and fails on other owners. It orders decoded mint bytes before PDA derivation, so neither input order is a hidden precondition. Construction returns the unsigned transaction bytes, its required signers and the quote read's slot. `ConfigParametersArgs` is an explicit binary-program parameter input, not a substitute for the future venue configuration builder.

`@floor/chains/solana/programs` holds the System, Token, Token-2022 and token-metadata program ids as plain strings, so wallet policy Schemas can name them without loading Kit or construction code.

`@floor/chains/evm` provides `DopplerLaunch` and its Layer for the tested Base multicurve path, default governance and Uniswap V2 migration. Base's chain id is part of the input type. Addresses, amounts, pool curves, metadata and salt are inputs. The only Doppler import is `/evm`; its client has no wallet and a transport that rejects every RPC request. Construction returns the calldata bytes and the intended sender and destination. New chains, migrations or governance choices require their own construction evidence.

`@floor/chains/math` exposes the four promoted native-bigint computations and their tagged errors. Unbounded intermediate arithmetic matches these SDK helpers; the instruction codecs separately enforce wire field widths. Negative amounts are rejected explicitly. These helpers do not implement a complete curve quote.

## Tests

`test/_inputs.ts` holds the labelled replay inputs and the HTTP test Layer; production cannot import it. `test/fixtures/` contains the unchanged oracle JSON recorded from the official SDK 1.5.13: 940 arithmetic outcomes, ten additional negative-input controls, exact unsigned Solana instruction bytes and account roles, and the EVM calldata digest. Tests compare the implementation with these recorded results; they do not run the old probe or present replay as current chain data. The SDK source checksum is recorded in `math-oracle.json`. Meteora, Anchor, web3.js and BN are absent from this package's runtime and development dependency declarations.

Construction tests read the returned bytes back with Kit's `getTransactionDecoder` and `decompileTransactionMessage`. A compiled message keeps one role per account, so the oracle's account roles are compared as the message merges them; `instructions.test.ts` checks every instruction's own account positions, roles, fixed addresses and discriminators against the pinned IDL using distinct sentinel identities. The tests also cover all 940 oracle cases, negative inputs, the full serialized transaction digest, variable inputs and mint ordering, RPC failures and unsupported owners, and EVM calldata parity.

Run leaf tests with `bun run test` from this package. Root formatting, typecheck, lint and bundle fences also apply.

## Reproducible codecs

`idl/source.json` pins Meteora's upstream Anchor IDL commit and SHA-256, and a leaf test checks the IDL against it. `METEORA-LICENSE` preserves its MIT license, including the ported arithmetic. Codama 1.11.0, its Anchor adapter 1.5.6 and JS renderer 2.5.0 generate Kit 8.4.0 codecs. `codama.json` deletes every node except the twelve types the two instructions take, and links each type to its own file instead of a barrel. `bun run generate` renders into ignored `work/chains-promotion/client/`, copies the twelve codecs to `src/solana/_generated/` and formats them with the root formatter. Verify the resulting diff before changing any pins; lint rejects casts, assertions and `any` in the generated codecs as anywhere else.

`src/solana/instructions.ts` holds the two unsigned instruction builders. They are kept by hand; the IDL test fails if an account position, role, fixed address or discriminator drifts from the pinned IDL.

No Alchemy, Cloudflare binding or application runtime belongs here. The Solana edge supplies Effect's FetchHttpClient internally so its public service does not leak the unstable HTTP interface. The test Layer replaces the documented Fetch reference under that same HTTP/Schema path. The root bundle audit must inspect both production entry points so Doppler's unreachable Kit 6 transitive package cannot enter the signer or Floor graph.
