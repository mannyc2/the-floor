# Kit construction: local technical pass

The final Alchemy Worker run passed 18 assertions. Kit 8.4.0 constructed two identical unsigned 1,025-byte Meteora config-plus-pool transactions, with three required signers and zero attached signatures. Their bytes and account roles match the official SDK oracle. The actual Worker fixture counter advanced from 0 to 2 across the two constructions. An undeclared RPC shape was rejected with HTTP 500; the expected Schema error remains in the log.

Doppler constructed identical 2,020-byte Airlock calldata twice with zero construction transport requests; its deliberate forbidden-RPC control was rejected. Intended sender is recorded separately from the absent required-signer information. No signing, simulation, submission or chain execution occurred.

The native-bigint helpers match 940 official-SDK vectors with zero mismatches and reject all ten negative-input controls. The current math source exactly matches the oracle checksum. The Worker passed eleven representative arithmetic/error checks. This is a bounded set of fee and base/quote delta operations, not the whole pricing or curve builder.

Web Crypto passed SHA-256 empty/abc vectors, 32 distinct UUIDv4 samples and typed rejection of negative random-byte size. The runtime reports Bun absent and process present. Default Alchemy flags therefore do not establish a bare no-Node environment.

Independent construction review passed 44 checks against the final source and responses. The reachable emitted bundle has 13 JavaScript files and 12 source maps. Its Solana modules are 8.4.0; no web3.js, Anchor, BN.js, legacy Meteora SDK or Kit 6 module appears in that graph. Node-related Alchemy support remains present. The audit follows literal imports using Bun's parser and excludes stale cached chunks; computed nonliteral imports remain outside its scope.

Formatting, strict types and type-aware lint passed against the frozen source. All 91 Effect diagnostics remain enabled. Exact source is committed and also retained in a small archive without dependencies. A corrupt installed workerd executable initially caused ENOEXEC; the final run used the same-version official binary, verified against the registry archive's SHA-512 and recorded executable SHA-256. This does not establish why the cache became corrupt.

The earlier exploratory bare startup failed with timeout/502 and lacks a complete original source snapshot; attempt 001 preserves that diagnostic without a causal compatibility claim. Hosted execution, wallets, arbitrary token ordering, Token-2022, complete program coverage and production economics remain unverified. No hosted spend or Stage 0 approval is implied.
