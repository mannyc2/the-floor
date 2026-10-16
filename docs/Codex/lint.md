# Lint and compiler requirements

The workspace keeps strict TypeScript options and all 91 explicit Effect error diagnostics. One `tsc -b` checks the project references. `prepare` applies `effect-tsgo patch --typescript --oxlint`; exact versions remain pinned in the manifest and lockfile. Runtime globals belong only to the relevant app or tooling configuration; the root has no ambient Workers types or path aliases.

Compiler diagnostics own their matching Effect checks. `.oxlintrc.json` disables only those 91 duplicate `effecttsgo` rules; lint-only Effect rules remain enabled. Scoped overrides admit native Playwright callbacks, test runtime composition and executable `runMain` boundaries. Other exceptions stay beside their boundary with a concrete reason. `@floor/api` remains the sole internal unstable-API export exception; reviewed external families stay explicitly listed in the compiler config.

`bun run lint` builds the small custom plugin, runs type-aware Oxlint with `--deny-warnings --report-unused-disable-directives`, scans HTML/CSS visual values, and checks every remaining suppression for a reason. Unused native directives fail. ESLint disable aliases are ignored and rejected. There is no per-file suppression budget to update.

## Source boundaries

Native `no-restricted-imports` overrides cover production TypeScript and JavaScript files:

- Contract imports only Effect and its own modules.
- Three.js stays in `apps/web`.
- Signer imports exclude models, providers, agents and Floor application code.
- Production excludes testing exports, fixtures, recordings and the workbench.
- Retired effect-cf, web3.js, Anchor, BN and full Meteora/Doppler SDK entry points stay out of production; the approved Doppler `/evm` edge remains allowed.
- Privy's SDK, `svix` and `@hpke/*` are development-only oracles. Privy's `/solana-kit` helper is forbidden even in tests.

Static imports, re-exports, literal dynamic imports and import-equals forms are checked by the native rule. App isolation also rejects computed or template dynamic imports, CommonJS calls and type-query imports that the native restriction cannot inspect: use a static import or string-literal `import()` instead. Fixtures run the installed Oxlint engine against positive and negative cases, including all supported source extensions.

The custom plugin contains only application isolation, feature isolation and Atlas visual literals. Application/feature checks resolve relative paths and workspace names to their owner. Production colour and pixel literals belong to Atlas. The former file-read and chain-neutral Schema scanners are retired; contract's branded CAIP Schemas carry the chain-neutral boundary.

Test helpers, Layers and fixtures live in each package's or app's `test/` folder, outside `src`, so production importers cannot reach them: the chains replay inputs, the wallets fake transport and the Floor's test Worker, scripted model and storage probe among them.

## Build and visual checks

Worker bundles keep the existing RPC branch's 64 MiB uncompressed code limit. Web source maps also exclude server-only MCP implementations.

Web bundles keep the 200 KiB initial and 180 KiB deferred gzip budgets; the deferred renderer entry remains required. Each entry's initial imports are counted once, and shared initial code is excluded from its deferred total.

Artifact checks inspect emitted JavaScript and source maps for the workbench and Privy SDK families across the web, Floor and chain builds. Emitted text catches external SDK imports; source maps identify bundled code. The general AST dependency walker, unrelated artifact policies and pinned bundler-helper hash are retired. Local source boundaries still enforce the other capability rules.

HTML/CSS checks reject visual literals outside Atlas. Atlas exports plain values and has no generated-output exemption. Its value snapshot pins colours and dimensions.

`work/`, dependencies and generated build output stay outside active source checks. Renderer source, workbench and tests remain checked. Explicit leaf test paths prevent Bun's substring discovery from running unrelated native or browser suites. Do not weaken a boundary or behavior assertion to make a check pass.
