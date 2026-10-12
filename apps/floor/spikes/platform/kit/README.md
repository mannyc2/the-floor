# Local launch-construction probe

This isolated spike package builds an Alchemy Worker using Kit 8.4.0, a narrow Codama-generated Meteora client, native `bigint` arithmetic and Doppler's `/evm` entry. It contains controlled test inputs. It is not a production chain package or a signer.

From this directory, run `bun install --frozen-lockfile`, `bun run format:check`, `bun run typecheck`, `bun run lint`, then `bun run build`. Build uses Alchemy's supported `Test.make({ dev: true, sidecar: false })` harness: it bundles the Worker, executes the local assertions and destroys the local resource. It creates no hosted stage. The host transport preload rejects non-loopback fetches and telemetry is disabled. The test-owned Worker listens on port 19735 while the test runs.

The pinned Alchemy beta.80 package carries Yielded PR 557's patch. The Worker uses compatibility date 2026-08-18 with the default flags. The evidence records the resolved workerd version and actual Node compatibility behavior. Every active consumer uses Effect 4.0.3, including the separately packaged native Alchemy-agent probe.

## What runs

- `/launch` constructs the same fixed unsigned config-plus-pool transaction twice. Three public identities, a zero blockhash and a synthetic quote-mint owner are explicit inputs. An Effect `HttpClient` request to the same local Worker's `/rpc` endpoint supplies the owner, decoded by Schema. Only the declared request shape is accepted. There is no live chain checkpoint or signing key.
- `/evm` builds fixed Doppler Airlock multicurve calldata twice through `viem`. A rejecting transport counts the negative control and proves that construction itself makes no RPC request.
- `/crypto` checks SHA-256 empty/abc vectors, 32 sampled UUIDv4 values and typed rejection of negative random-byte size through the browser crypto layer.
- `/math` checks representative fee and curve-delta arithmetic and typed invalid-input behavior. The four pure computations are also compared with the official Meteora SDK as a development oracle. They are not a complete pool quote or curve-construction implementation.

The construction test requires the known full serialized digests, expected lengths, no attached signatures, repeated equality, the EVM transport counts, a successful math probe and rejection of an undeclared RPC. Results from the real local Worker are retained in the evidence directory, with exact source and dependency hashes.

Kit's unconstrained generic `RpcTransport` promises a caller-selected response type from unknown JSON. This bounded example instead places Schema decoding directly at the Effect HTTP edge and uses Kit for addresses, PDAs, codecs and transaction serialization. It avoids a type assertion at that trust boundary. A generalized Kit RPC adapter remains future work.

## Regeneration and limits

Meteora-derived IDL and arithmetic retain the upstream MIT terms in `METEORA-LICENSE`. `source.json` pins the Meteora Anchor IDL's upstream commit and SHA-256. `bun run generate` runs Codama and then `bounded-client.py`. That script retains twelve binary codec modules and derives only the two required instruction builders from the IDL. It emits direct codec imports to avoid barrel cycles. Full generic Codama output stays in ignored `client/`; the selected output has no casts, non-null assertions or `any`. Run formatting and all checks after regeneration. `config.ts` is a labelled fixed oracle fixture, not a live quote or a port of the SDK's entire configuration builder.

The SDK and its web3.js/Anchor/BN dependencies are not dependencies of this package. The bundle audit also checks that Doppler's unused Kit 6 dependency does not enter the reachable Worker graph. Oracle output and driver provenance are retained separately as development evidence.

Nine reasoned lint suppression lines cover ten rule occurrences: Alchemy's plan-time module filename, two Alchemy test lifecycle hooks, four standalone/test Layer boundaries, Viem's required rejected-Promise callback, and the native host-transport guard's two rules. The guard also has one compiler diagnostic annotation for that same native-fetch boundary. Strict compiler options, all 91 Effect diagnostics and the remaining lint rules stay enabled. The test driver additionally reviews the external `effect/FileSystem` module family; there is no internal unstable-API exception.

No result proves sandbox co-signing, simulation, broadcast, graduation, migration, vesting, allocations, hosted compatibility or Stage 0 readiness.
